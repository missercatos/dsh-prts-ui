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
    return S.workspaces;
  }

  async function listSessions() {
    const r = await P.dsh.request('session.list', {});
    S.sessions = (r && r.items) || [];
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
    await Promise.allSettled([listWorkspaces(), listSessions(), listModels(), listProviders(), listPresets()]);
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

  /** Apply a permission preset through dsh's `/permission` slash command. */
  async function setPermissionPreset(sessionId, preset) {
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

  /** Commands known to this session. dsh does not expose a command-list RPC on
   *  the /api wire, so PRTS builds the directory from the session's own
   *  `command/run` events plus well-known built-ins, and refreshes it as the
   *  history grows. */
  const KNOWN_COMMANDS = [
    { name: 'permission', description: 'permission preset (sandbox + approvals)' },
    { name: 'plan', description: 'plan mode' },
  ];
  async function commandsList(sessionId, events) {
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

  // Host version (Settings -> Version) straight from dsh, not from PRTS.
  async function hostDescribe() {
    try {
      const r = await P.dsh.request('host.describe', {});
      return r || {};
    } catch (e) { return {}; }
  }

  // Installed plugins are the profile's own bundle dependencies — read them
  // through the Electron bridge (the harness profile package.json).
  async function pluginsList() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge && window.prts.bridge.pluginsList) {
        return await window.prts.bridge.pluginsList();
      }
    } catch (e) { /* no bridge */ }
    return [];
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
  S.agentPresetSelect = function (sessionId, agentPreset) {
    return P.dsh.request('agentPreset.select', { sessionId, agentPreset });
  };
  S.hostDescribe = hostDescribe;
  S.pluginsList = pluginsList;
})(typeof globalThis !== 'undefined' ? globalThis : this);
