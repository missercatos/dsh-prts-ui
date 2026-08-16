/**
 * dsh-backed application state — everything PRTS shows comes from dsh's /api.
 * PRTS keeps no session/history/model state of its own; it mirrors dsh.
 *
 * Shapes are pinned to the current @deepseek-ai/dsh-host-apiproxy contract:
 *   workspace.list  -> { items, archivedSessionIds? }
 *   session.list    -> { items: [{ sessionId, running, blank, cwd,
 *                                  agentPreset, projections: { values } }] }
 *   session.history -> { events: [{ event, view? }], hasMore, projections? }
 *   session.models  -> { current: { provider, model, reasoningEffort? },
 *                        routable, groups: [{ id, name, models }] }
 *   session.search  -> { items: [{ sessionId, snippet }], hasMore }
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = P.dshState = {
    ready: false,
    url: 'http://127.0.0.1:3085',
    workspaces: [],
    sessions: [],       // raw session.list items (projections included)
    archivedSessionIds: [],  // workspace.list archive set (session.list does NOT filter it)
    models: [],         // provider groups: { id, name, models: [...] }
    providers: [],      // { provider, displayName, active, ... }
    currentWorkspaceId: null,
    currentSessionId: null,
    currentModel: null,     // { provider, model, reasoningEffort } (session.models.current)
    currentPreset: null,    // agent preset id of the open session
    presets: [],            // agentPreset.list
    events: [],             // raw events of the current session (recent window)
    permissions: null,      // { options: [{value,name}], currentValue } projection
    liveProjections: {},    // sessionId -> { key: value } from session/projection frames
  };

  function dshUrl() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.env && window.prts.env.dshUrl) {
        return window.prts.env.dshUrl;
      }
    } catch (e) { /* no preload */ }
    // Served from the dsh web origin (the /prts plugin route): talk to the
    // same host:port — same-origin, no CORS.
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin &&
        /^https?:$/.test(window.location.protocol)) {
        return window.location.origin;
      }
    } catch (e) { /* no window */ }
    return S.url;
  }

  async function connect(url) {
    if (url) S.url = url;
    S.url = dshUrl();
    P.dsh.connect(S.url);   // non-blocking; reconnects in the background
    return S.url;
  }

  async function listWorkspaces() {
    const r = await P.dsh.request('workspace.list', {});
    S.workspaces = (r && r.items) || [];
    // dsh keeps the archive set on workspace.list only — session.list still
    // returns archived sessions, so PRTS filters them client-side here.
    if (Array.isArray(r && r.archivedSessionIds)) S.archivedSessionIds = r.archivedSessionIds;
    return S.workspaces;
  }

  async function listSessions() {
    const r = await P.dsh.request('session.list', {});
    const archived = new Set(S.archivedSessionIds);
    S.sessions = ((r && r.items) || []).filter((s) => !archived.has(s.sessionId));
    return S.sessions;
  }

  /** Human title of a session summary: projection title → sessionId prefix. */
  function sessionTitle(s) {
    if (!s) return '';
    const proj = s.projections && s.projections.values;
    if (proj && typeof proj.title === 'string' && proj.title.trim()) return proj.title;
    const sid = String(s.sessionId || '');
    return sid.length > 8 ? sid.slice(0, 8) : sid;
  }

  /** Session summary row for a sessionId (projections included). */
  function sessionSummary(sessionId) {
    return S.sessions.find((s) => s.sessionId === sessionId) || null;
  }

  /** True when the session has not started yet (its agent preset is still
   *  switchable — `agentPreset.select` rejects started sessions with
   *  `agent-preset-locked`). */
  function isSessionBlank(sessionId) {
    const s = sessionSummary(sessionId);
    return !s || s.blank === true;
  }

  /** permission projection of one session: { options, currentValue } | null */
  function permissionState(sessionId) {
    const s = sessionSummary(sessionId);
    const p = s && s.projections && s.projections.values && s.projections.values.permissions;
    if (!p) return null;
    return {
      options: (p.options || []).map((o) => ({ value: o.value, name: o.name || o.value })),
      currentValue: p.currentValue || null,
    };
  }

  /** Merged projection values for a session: session.list snapshot overlaid
   *  with the live `session/projection` mux frames. */
  function projectionValues(sessionId) {
    const s = sessionSummary(sessionId);
    const base = (s && s.projections && s.projections.values) || {};
    const live = S.liveProjections[sessionId] || {};
    return Object.assign({}, base, live);
  }

  async function listModels() {
    const r = await P.dsh.request('llm.models', {});
    S.models = (r && r.groups) || [];
    return S.models;
  }

  async function listProviders() {
    try {
      const r = await P.dsh.request('llm.providers', {});
      S.providers = (r && r.providers) || [];
    } catch (e) { S.providers = []; }
    return S.providers;
  }

  async function listPresets() {
    try {
      const r = await P.dsh.request('agentPreset.list', {});
      S.presets = (r && r.presets) || [];
    } catch (e) { S.presets = []; }
    return S.presets;
  }

  async function refreshAll() {
    // Workspaces must load before sessions: the archive set from
    // workspace.list is what filters archived sessions out of the list.
    await listWorkspaces().catch(() => {});
    await Promise.allSettled([listSessions(), listModels(), listProviders(), listPresets()]);
  }

  /** The open session's exact model selection (session.models.current). */
  async function sessionModels(sessionId) {
    const r = await P.dsh.request('session.models', { sessionId });
    S.currentModel = (r && r.current) ? {
      provider: r.current.provider || null,
      model: r.current.model || null,
      reasoningEffort: r.current.reasoningEffort || null,
    } : null;
    if (r && Array.isArray(r.groups) && r.groups.length) S.models = r.groups;
    return S.currentModel;
  }

  // True when dsh answers a real RPC — the "connected" signal (a 404/hang means
  // the /api route is not mounted yet, which is "not ready", not "connected").
  async function ping() {
    try {
      await P.dsh.request('workspace.list', {});
      return true;
    } catch (e) { return false; }
  }

  async function createSession(workspaceId, agentPreset) {
    const payload = {};
    if (workspaceId) payload.workspaceId = workspaceId;
    if (agentPreset) payload.agentPreset = agentPreset;
    const r = await P.dsh.request('session.create', payload);
    return r && r.sessionId;
  }

  /** Page of history entries: { events: [{event, view?}], hasMore }. */
  async function history(sessionId, opts) {
    const payload = { sessionId };
    const o = opts || {};
    if (o.beforeSeq !== undefined && o.beforeSeq !== null) payload.beforeSeq = o.beforeSeq;
    if (o.maxMessages) payload.maxMessages = o.maxMessages;
    const r = await P.dsh.request('session.history', payload);
    return {
      events: (r && r.events) || [],
      hasMore: !!(r && r.hasMore),
      projections: r && r.projections,
    };
  }

  /** Send content blocks to a session. mode: 'queue' | 'steer'. */
  async function prompt(sessionId, content, mode) {
    return P.dsh.request('session.prompt', {
      sessionId,
      mode: mode || 'queue',
      content: content || [{ type: 'text', text: '' }],
    });
  }

  async function cancel(sessionId) {
    try { await P.dsh.request('session.cancel', { sessionId }); } catch (e) { /* noop */ }
  }

  async function renameSession(sessionId, title) {
    return P.dsh.request('session.rename', { sessionId, title });
  }

  async function archiveSession(sessionId) {
    // dsh has no session.delete — sessions are archived from their workspace.
    await P.dsh.request('workspace.archiveSession', { sessionId });
    // The wire session.list does not filter archived sessions, so keep the
    // archive set locally and drop the row immediately (the sidebar must
    // reflect the deletion without waiting on any other refresh).
    if (S.archivedSessionIds.indexOf(sessionId) < 0) S.archivedSessionIds.push(sessionId);
    S.sessions = S.sessions.filter((s) => s.sessionId !== sessionId);
    return S.archivedSessionIds;
  }

  /** Archive several sessions (bulk delete). Returns the first error, if any. */
  async function archiveSessions(sessionIds) {
    let firstError = null;
    for (const id of sessionIds) {
      try { await archiveSession(id); } catch (e) { if (!firstError) firstError = e; }
    }
    if (firstError) throw firstError;
  }

  async function deleteWorkspace(workspaceId) {
    await P.dsh.request('workspace.delete', { workspaceId });
  }

  async function createWorkspace(path) {
    return P.dsh.request('workspace.create', { path });
  }

  async function renameWorkspace(workspaceId, title) {
    return P.dsh.request('workspace.rename', { workspaceId, title });
  }

  async function selectModel(sessionId, provider, model, reasoningEffort) {
    const payload = { sessionId, provider, model };
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
    const r = await P.dsh.request('session.selectModel', payload);
    S.currentModel = { provider, model, reasoningEffort: reasoningEffort || null };
    return r;
  }

  /** Wire session.search; resolves null when the deployment has it disabled. */
  async function searchSessions(query) {
    try {
      const r = await P.dsh.request('session.search', { query });
      return (r && r.items) || [];
    } catch (e) { return null; }
  }

  /** Fetch one image attachment by id -> data URL (cached per session). */
  const attachmentCache = new Map();
  async function attachment(sessionId, attachmentId) {
    const key = sessionId + '::' + attachmentId;
    if (attachmentCache.has(key)) return attachmentCache.get(key);
    const r = await P.dsh.request('session.attachment', { sessionId, attachmentId });
    const ref = (r && r.attachment) || {};
    const mediaType = ref.mediaType || 'image/png';
    const url = 'data:' + mediaType + ';base64,' + (r && r.data ? r.data : '');
    attachmentCache.set(key, url);
    return url;
  }

  /** Apply a permission preset through dsh's `/permission` command. The
   *  commands/execute RPC is the same path dsh web uses; older builds without
   *  the RPC fall back to queuing the slash line as a prompt. */
  async function setPermissionPreset(sessionId, preset) {
    try {
      const out = await executeCommand(sessionId, '/permission ' + preset);
      if (out && out.admitted) return out;
    } catch (e) { /* fall back below */ }
    return P.dsh.request('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '/permission ' + preset }],
    });
  }

  async function settingsGet(ns) {
    const r = await P.dsh.request('settings.describe', { ns });
    return r;
  }
  async function settingsUpdate(ns, patch) {
    return P.dsh.request('settings.update', { ns, patch });
  }

  async function credentialsDescribe(refs) {
    const r = await P.dsh.request('credentials.describe', { refs });
    return (r && r.credentials) || {};
  }
  async function credentialsSet(ref, value) {
    return P.dsh.request('credentials.set', { ref, value });
  }
  async function credentialsUnset(ref) {
    return P.dsh.request('credentials.unset', { ref });
  }

  /** Commands known to this session. Current dsh builds expose the real
   *  command directory over the `commands/list` RPC (the same source the dsh
   *  web GUI uses — it includes every plugin-extended command). Older builds
   *  without the RPC fall back to the session's own `command/run` events plus
   *  well-known built-ins. Results are cached briefly so slash-autocomplete
   *  doesn't hammer the wire on every keystroke. */
  const KNOWN_COMMANDS = [
    { name: 'permission', description: 'permission preset (sandbox + approvals)' },
    { name: 'plan', description: 'plan mode' },
  ];
  const commandCache = new Map();   // sessionId -> { at, list }
  function buildLocalCommands(events) {
    const names = new Map();
    for (const c of KNOWN_COMMANDS) names.set(c.name, c.description || '');
    const evs = Array.isArray(events) ? events : S.events;
    for (const ev of evs) {
      const e = ev && ev.event ? ev.event : ev;
      if (e && e.type === 'command/run' && e.data && typeof e.data.name === 'string') {
        names.set(e.data.name, e.data.description || '');
      }
    }
    return [...names.entries()].map(([name, description]) => ({ name, description }));
  }
  async function commandsList(sessionId, events) {
    if (!sessionId) return buildLocalCommands(events);
    const hit = commandCache.get(sessionId);
    if (hit && Date.now() - hit.at < 4000) return hit.list;
    let list;
    try {
      const r = await P.dsh.request('commands/list', { args: { agentId: sessionId } });
      const wire = Array.isArray(r) ? r : [];
      // Merge the built-ins the harness knows but may not list yet.
      const names = new Set();
      const out = [];
      for (const c of wire) {
        if (!c || !c.name || names.has(c.name)) continue;
        names.add(c.name);
        out.push({ name: c.name, description: c.description || '' });
      }
      for (const c of buildLocalCommands(events)) {
        if (names.has(c.name)) continue;
        names.add(c.name);
        out.push(c);
      }
      list = out;
    } catch (e) {
      list = buildLocalCommands(events);
    }
    commandCache.set(sessionId, { at: Date.now(), list });
    return list;
  }
  function invalidateCommands() { commandCache.clear(); }

  /** Execute a slash line through the host command executor (the same path
   *  dsh web's composer uses). Resolves { admitted: false } when the host
   *  does not know the command (or the RPC is unavailable). */
  async function executeCommand(sessionId, line) {
    const r = await P.dsh.request('commands/execute', { args: { agentId: sessionId, line } });
    if (r === undefined || r === null) return { admitted: false };
    return { admitted: true, commandId: r.commandId || null, result: r.result || null };
  }

  /** Native directory picker (dsh web's workspace-browse path). Resolves the
   *  chosen path, or null when the user cancelled. */
  async function pickDirectory() {
    const r = await P.dsh.request('host.pickDirectory', {}, { timeoutMs: 30000 });
    return (r && r.path) || null;
  }

  /** dsh web's Session log endpoint: the ZIP archive download URL. */
  function sessionLogUrl(sessionId) {
    return S.url.replace(/\/+$/, '') + '/api/session.export?sessionId=' +
      encodeURIComponent(sessionId) + '&includeDescendants=true';
  }

  /** Product display label for a permission preset (mirrors dsh web:
   *  danger-full-access → "Full access", kebab names → Title Case). */
  function permissionDisplayName(o) {
    if (!o) return '';
    if (o.value === 'danger-full-access') return 'Full access';
    const n = String(o.name || o.value || '');
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) {
      return n.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return n;
  }

  // Host version (Settings -> Version) straight from dsh, not from PRTS.
  async function hostDescribe() {
    try {
      const r = await P.dsh.request('host.describe', {});
      return r || {};
    } catch (e) { return {}; }
  }

  // Installed plugins are the profile's own bundle dependencies — read them
  // through the Electron bridge (the harness profile package.json). With no
  // bridge (plain browser on the /prts route) the host plugin answers the
  // same query over /prts/api/profiles.
  const bridgeOr = () => {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge) return window.prts.bridge;
    } catch (e) { /* no bridge */ }
    return null;
  };

  /** HTTP helper for PRTS panel APIs (balance / github / skills). Uses the
   *  Electron main-process bridge when present (no CORS); on the plain-browser
   *  /prts route it goes through the host plugin's /prts/api/http proxy. */
  async function panelHttp(method, url, headers, body) {
    const bridge = bridgeOr();
    if (bridge && typeof bridge.http === 'function') {
      return new Promise((resolve, reject) => {
        let text = '';
        let status = 0;
        bridge.http({
          method, url, headers: headers || {}, body: body || '',
          onChunk: (c) => { text += String(c); },
          onEnd: (r) => {
            status = r ? r.status : 0;
            resolve({ status, text });
          },
        });
        setTimeout(() => { if (status === 0) reject(new Error('PRTS: http timeout')); }, 45000);
      });
    }
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
    const res = await fetch(origin + '/prts/api/http', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers: headers || {}, body: body || '' }),
    });
    return { status: res.status, text: await res.text() };
  }

  async function profilesList() {
    const bridge = bridgeOr();
    try {
      if (bridge && bridge.listProfiles) return await bridge.listProfiles();
    } catch (e) { /* no bridge */ }
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      if (origin) {
        const res = await fetch(origin + '/prts/api/profiles');
        if (res.ok) return await res.json();
      }
    } catch (e) { /* no host route */ }
    return [];
  }

  /** CLI apps from OTHER dsh profiles (one-shot plugins like givemyflag).
   *  Each becomes one visible command in the GUI command directory. */
  async function cliPlugins() {
    const profiles = await profilesList();
    return (profiles || [])
      .filter((p) => p && p.cli !== false && p.profile && p.profile !== 'prts' && p.profile !== 'web')
      .map((p) => ({
        name: p.profile,
        description: (p.description || '') + (p.usage ? ' — ' + p.usage : ''),
        usage: p.usage || '',
        cli: true,
        profile: p.profile,
        packages: p.packages || [],
      }));
  }

  /** Run a CLI profile plugin (e.g. `dsh --profile givemyflag <url>`). */
  async function runCliPlugin(profile, args) {
    const bridge = bridgeOr();
    if (bridge && bridge.runCli) return await bridge.runCli(profile, args || []);
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      if (origin) {
        const res = await fetch(origin + '/prts/api/run-cli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, args: args || [] }),
        });
        return await res.json();
      }
    } catch (e) { /* no host route */ }
    return { ok: false, error: 'run-cli unavailable in this mode' };
  }

  async function pluginsList() {
    const profiles = await profilesList();
    // Keep the legacy flat shape for existing consumers: { name, version, profile }.
    const out = [];
    for (const p of profiles || []) {
      for (const pkg of p.packages || []) {
        out.push({ name: pkg.name, version: pkg.version || '', profile: p.profile, category: pkg.category || 'plugin' });
      }
    }
    return out;
  }

  S.connect = connect;
  S.listWorkspaces = listWorkspaces;
  S.listSessions = listSessions;
  S.sessionTitle = sessionTitle;
  S.sessionSummary = sessionSummary;
  S.isSessionBlank = isSessionBlank;
  S.permissionState = permissionState;
  S.projectionValues = projectionValues;
  S.listModels = listModels;
  S.listProviders = listProviders;
  S.listPresets = listPresets;
  S.refreshAll = refreshAll;
  S.sessionModels = sessionModels;
  S.ping = ping;
  S.createSession = createSession;
  S.history = history;
  S.prompt = prompt;
  S.cancel = cancel;
  S.renameSession = renameSession;
  S.archiveSession = archiveSession;
  S.archiveSessions = archiveSessions;
  S.deleteWorkspace = deleteWorkspace;
  S.createWorkspace = createWorkspace;
  S.renameWorkspace = renameWorkspace;
  S.selectModel = selectModel;
  S.searchSessions = searchSessions;
  S.attachment = attachment;
  S.setPermissionPreset = setPermissionPreset;
  S.settingsGet = settingsGet;
  S.settingsUpdate = settingsUpdate;
  S.credentialsDescribe = credentialsDescribe;
  S.credentialsSet = credentialsSet;
  S.credentialsUnset = credentialsUnset;
  S.commandsList = commandsList;
  S.invalidateCommands = invalidateCommands;
  S.executeCommand = executeCommand;
  S.pickDirectory = pickDirectory;
  S.sessionLogUrl = sessionLogUrl;
  S.permissionDisplayName = permissionDisplayName;
  S.agentPresetSelect = function (sessionId, agentPreset) {
    return P.dsh.request('agentPreset.select', { sessionId, agentPreset });
  };
  S.hostDescribe = hostDescribe;
  S.pluginsList = pluginsList;
  S.profilesList = profilesList;
  S.cliPlugins = cliPlugins;
  S.runCliPlugin = runCliPlugin;
  S.panelHttp = panelHttp;
})(typeof globalThis !== 'undefined' ? globalThis : this);
