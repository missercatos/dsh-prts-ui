/**
 * PRTS platform adapter: OS, home/config directories, locale detection.
 * Runs in Node (TUI / Electron main) and in the web renderer.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  function env() {
    if (typeof process !== 'undefined') return process.env;
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.env) return window.prts.env;
    } catch (e) { /* no preload */ }
    return {};
  }

  function os() {
    if (typeof process !== 'undefined' && process.platform) {
      const p = process.platform;
      if (p === 'linux' || p === 'darwin' || p === 'win32') return p === 'darwin' ? 'macos' : p === 'win32' ? 'windows' : 'linux';
      return 'other';
    }
    const e = env();
    if (e.platform) return e.platform === 'darwin' ? 'macos' : e.platform === 'win32' ? 'windows' : 'linux';
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'macos';
    if (/Linux/i.test(ua)) return 'linux';
    return 'other';
  }

  function homedir() {
    const e = env();
    if (e.HOME || e.home) return e.HOME || e.home;
    if (e.USERPROFILE) return e.USERPROFILE;
    return '.';
  }

  function dshHome() {
    const e = env();
    if (e.dshHome) return e.dshHome;
    return homedir() + '/.dsh';
  }

  function configDir() {
    const o = os();
    const home = homedir();
    const e = env();
    if (o === 'linux') return (e.XDG_CONFIG_HOME ? e.XDG_CONFIG_HOME : home + '/.config') + '/prts';
    if (o === 'macos') return home + '/Library/Application Support/prts';
    if (o === 'windows') return (e.APPDATA ? e.APPDATA : home + '/AppData/Roaming') + '/prts';
    return home + '/.prts';
  }

  /** PRTS's own window-chrome config: lives with the prts profile under ~/.dsh. */
  function prtsUiConfigPath() {
    return prtsProfileDir() + '/prts-ui.json';
  }

  /** The prts profile directory under the dsh home. */
  function prtsProfileDir() {
    const profile = env().DSH_PRTS_PROFILE || 'web';
    return dshHome() + '/profiles/' + profile;
  }

  function desktopDir() {
    const o = os();
    const home = homedir();
    const e = env();
    if (e.DSH_PRTS_DESKTOP) return e.DSH_PRTS_DESKTOP;
    if (o === 'linux') {
      if (e.XDG_DESKTOP_DIR) return e.XDG_DESKTOP_DIR;
      const dirs = [home + '/Desktop', home + '/桌面'];
      return dirs[0];
    }
    if (o === 'macos') return home + '/Desktop';
    if (o === 'windows') return home + '/Desktop';
    return null;
  }

  function detectLocale() {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return /^zh/i.test(navigator.language) ? 'zh' : 'en';
    }
    const lang = typeof process !== 'undefined' && process.env.LANG ? process.env.LANG : '';
    return /^zh/i.test(lang) ? 'zh' : 'en';
  }

  P.platform = {
    os: os,
    homedir: homedir,
    dshHome: dshHome,
    configDir: configDir,
    prtsProfileDir: prtsProfileDir,
    prtsUiConfigPath: prtsUiConfigPath,
    desktopDir: desktopDir,
    detectLocale: detectLocale,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
