/**
 * dsh-backed application state — everything PRTS shows comes from dsh's /api.
 * PRTS keeps no session/history/model state of its own; it mirrors dsh.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = P.dshState = {
    ready: false,
    url: 'http://127.0.0.1:3085',
    workspaces: [],
    sessions: [],
    models: [],       // provider groups: { id, models: [{id,name,...}] }
    providers: [],    // { provider, displayName, active, ... }
    currentWorkspaceId: null,
    currentSessionId: null,
    events: [],       // raw session events of the current session
  };

  function dshUrl() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.env && window.prts.env.dshUrl) {
        return window.prts.env.dshUrl;
      }
    } catch (e) { /* no preload */ }
    return S.url;
  }

  async function connect() {
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
    S.sessions = (r && r.sessions) || [];
    return S.sessions;
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

  async function refreshAll() {
    await Promise.allSettled([listWorkspaces(), listSessions(), listModels(), listProviders()]);
  }

  async function createSession(workspaceId) {
    const r = await P.dsh.request('session.create', workspaceId ? { workspaceId } : {});
    return r && r.sessionId;
  }

  async function history(sessionId) {
    const r = await P.dsh.request('session.history', { sessionId });
    return (r && r.items) || [];
  }

  async function prompt(sessionId, text) {
    return P.dsh.request('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
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

  async function deleteWorkspace(workspaceId) {
    await P.dsh.request('workspace.delete', { workspaceId });
  }

  async function createWorkspace(path) {
    return P.dsh.request('workspace.create', { path });
  }

  async function selectModel(sessionId, provider, model) {
    return P.dsh.request('session.selectModel', { sessionId, provider, model });
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

  async function commandsList(sessionId) {
    const r = await P.dsh.request('commands.list', { sessionId });
    return (r && Array.isArray(r)) ? r : (Array.isArray(r) ? r : []);
  }

  S.connect = connect;
  S.listWorkspaces = listWorkspaces;
  S.listSessions = listSessions;
  S.listModels = listModels;
  S.listProviders = listProviders;
  S.refreshAll = refreshAll;
  S.createSession = createSession;
  S.history = history;
  S.prompt = prompt;
  S.cancel = cancel;
  S.renameSession = renameSession;
  S.archiveSession = archiveSession;
  S.deleteWorkspace = deleteWorkspace;
  S.createWorkspace = createWorkspace;
  S.selectModel = selectModel;
  S.settingsGet = settingsGet;
  S.settingsUpdate = settingsUpdate;
  S.credentialsDescribe = credentialsDescribe;
  S.credentialsSet = credentialsSet;
  S.credentialsUnset = credentialsUnset;
  S.commandsList = commandsList;
})(typeof globalThis !== 'undefined' ? globalThis : this);
