#!/bin/sh
#
# PRTS one-click updater (Linux / macOS).
#
#   From the source checkout:  sh update.sh
#   With a newer tarball:      sh update.sh /path/to/dsh-prts-ui-<new>.tgz
#
# When the profile config (prts.config.json) sets a `releaseBase`, the updater
# first tries to download the latest release tarball from there (the website's
# /releases folder); any failure falls back to rebuilding locally. dsh itself
# and the configured plugins are updated the same way, and every network step
# falls back to npmmirror so the updater works without GitHub access.
#
set -eu

GREEN='\033[32m'; RED='\033[31m'; NC='\033[0m'
say() { printf '%b\n' "${GREEN}==>${NC} $*"; }
warn() { printf '%b\n' "${RED}warning:${NC} $*"; }
die() { printf '%b\n' "${RED}error:${NC} $*" >&2; exit 1; }

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/web"
CONFIG_FILE="$PROFILE_DIR/prts.config.json"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

cfg_get() {
  node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = c[process.argv[2]];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch (e) { process.stdout.write(""); }
  ' "$CONFIG_FILE" "$1" 2>/dev/null || true
}

NPM_REG="$(cfg_get npmRegistry)"
NPM_REG_FALLBACK="$(cfg_get npmRegistryFallback)"
[ -n "$NPM_REG_FALLBACK" ] || NPM_REG_FALLBACK="https://registry.npmmirror.com"
export ELECTRON_MIRROR="$(cfg_get electronMirror)"
[ -n "$ELECTRON_MIRROR" ] || export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

npm_i() {
  if [ -n "$NPM_REG" ]; then
    npm install "$@" --registry="$NPM_REG" 2>/dev/null && return 0
  else
    npm install "$@" 2>/dev/null && return 0
  fi
  warn "primary registry failed — retrying with $NPM_REG_FALLBACK"
  npm install "$@" --registry="$NPM_REG_FALLBACK"
}

command -v dsh >/dev/null 2>&1 || die "dsh is not installed. Run \`sh install.sh\` first."

# ---------- 1. dsh harness ----------
DSH_PKG="$(cfg_get dshPackage)"
[ -n "$DSH_PKG" ] || DSH_PKG="@deepseek-ai/dsh"
say "Updating the dsh harness ($DSH_PKG)…"
if npm_i -g "$DSH_PKG" >/tmp/prts-npm-i.log 2>&1; then
  :
elif grep -q "EACCES\|permission denied" /tmp/prts-npm-i.log 2>/dev/null; then
  warn "dsh is installed system-wide and the global update needs sudo — run \`sudo npm i -g $DSH_PKG\` later (continuing with the installed version)."
else
  warn "dsh update failed (continuing with the installed version)."
fi

# ---------- 2. dsh plugins (kept updated alongside PRTS) ----------
PLUGINS="$(node -e '
  const fs = require("fs");
  try {
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const p = Array.isArray(c.plugins) ? c.plugins : [];
    process.stdout.write(p.join("\n"));
  } catch (e) { process.stdout.write(""); }
' "$CONFIG_FILE" 2>/dev/null || true)"
if [ -n "$PLUGINS" ]; then
  say "Updating dsh plugins…"
  for p in $PLUGINS; do
    dsh plugin --profile web add "$p" || warn "plugin '$p' failed to update (may not exist on npm)."
  done
fi

# ---------- 3. PRTS itself: remote release → local rebuild ----------
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  RELEASE_BASE="$(cfg_get releaseBase)"
  if [ -n "$RELEASE_BASE" ]; then
    say "Downloading the latest PRTS release from $RELEASE_BASE …"
    MANIFEST="$(cfg_get releaseManifest)"
    [ -n "$MANIFEST" ] || MANIFEST="releases.json"
    DL_URL=""
    if command -v node >/dev/null 2>&1; then
      DL_URL="$(node -e '
        const https = require("https"), http = require("http");
        const base = process.argv[1].replace(/\/+$/, "");
        const manifest = process.argv[2];
        const get = (url, cb) => {
          const mod = url.indexOf("https:") === 0 ? https : http;
          const req = mod.get(url, { timeout: 20000 }, (res) => {
            if (res.statusCode !== 200) { res.resume(); cb(null); return; }
            let b = "";
            res.on("data", (d) => b += d);
            res.on("end", () => cb(b));
          });
          req.on("error", () => cb(null));
          req.on("timeout", () => { req.destroy(); cb(null); });
        };
        get(base + "/" + manifest, (body) => {
          if (!body) { process.stdout.write(""); return; }
          try {
            const m = JSON.parse(body);
            // releases.json layout: { downloads: { tarball, ... }, files: [...] }
            let file = "";
            if (m.downloads && m.downloads.tarball) file = m.downloads.tarball;
            else if (Array.isArray(m.files)) {
              const hit = m.files.find((f) => f.file && /\.tgz$/.test(f.file));
              if (hit) file = hit.file;
            }
            process.stdout.write(file ? base + "/" + file : "");
          } catch (e) { process.stdout.write(""); }
        });
      ' "$RELEASE_BASE" "$MANIFEST" 2>/dev/null || true)"
    fi
    if [ -n "$DL_URL" ]; then
      TMP_TGZ="${TMPDIR:-/tmp}/dsh-prts-ui-remote-$$.tgz"
      if curl -fsSL --connect-timeout 15 -o "$TMP_TGZ" "$DL_URL" || wget -q -T 15 -O "$TMP_TGZ" "$DL_URL"; then
        TGZ="$TMP_TGZ"
        say "downloaded $(basename "$DL_URL")"
      else
        warn "release download failed — falling back to a local rebuild."
        TGZ=""
      fi
    fi
  fi
  if [ -z "$TGZ" ]; then
    say "Rebuilding the dsh-prts-ui tarball…"
    ( cd "$SRC_DIR" && (node scripts/bundle-gui.mjs 2>/dev/null || true) && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
    TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "tarball not found: $TGZ"
case "$TGZ" in
  /*) ;;
  *) TGZ="$(cd "$(dirname "$TGZ")" && pwd)/$(basename "$TGZ")" ;;
esac

# ---------- 4. Install the tarball into the profile ----------
say "Updating the plugin in profile 'prts'…"
# Remove the old install first so the same version (or a downgrade) also
# overwrites in place — `pnpm add` alone would keep the existing copy.
dsh plugin --profile web remove dsh-prts-ui >/dev/null 2>&1 || true
node - "$PROFILE_DIR" <<'NODE'
const fs = require('fs')
const path = require('path')
const [profileDir] = process.argv.slice(2)
const file = path.join(profileDir, 'pnpm-workspace.yaml')
const base = new Map([
  ['node-pty', 'true'],
  ['koffi', 'true'],
  ['protobufjs', 'true'],
  ['@google/genai', 'true'],
  ['@deepseek-ai/dsh-subprocess-local', 'true'],
])
const extra = new Map()
try {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^  (@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?): (true|false)\s*$/)
    if (!m || base.has(m[1])) continue
    extra.set(m[1], m[2])
  }
} catch (e) { /* new file */ }
const keys = [...base, ...extra]
const q = (k) => /^@/.test(k) ? "'" + k + "'" : k
fs.writeFileSync(file, 'allowBuilds:\n' + keys.map(([k, v]) => '  ' + q(k) + ': ' + v).join('\n') + '\n')
NODE
# Clear any stale file:-tarball cache for dsh-prts-ui (pnpm caches file: deps
# by filename, so a changed tarball with the same name can serve a stale copy).
if command -v pnpm >/dev/null 2>&1; then
  STORE="$(pnpm store path 2>/dev/null || true)"
  if [ -n "$STORE" ]; then
    rm -rf "$STORE"/file+*dsh-prts-ui* 2>/dev/null || true
  fi
fi
dsh plugin --profile web add "$TGZ"
[ -f "$PROFILE_DIR/node_modules/dsh-prts-ui/package.json" ] || die "plugin not present after update."

# Keep the profile config (mirrors / plugins / release URL) if the package
# shipped a fresh example.
if [ ! -f "$CONFIG_FILE" ] && [ -f "$PROFILE_DIR/node_modules/dsh-prts-ui/prts.config.example.json" ]; then
  cp "$PROFILE_DIR/node_modules/dsh-prts-ui/prts.config.example.json" "$CONFIG_FILE"
fi

# ---------- 5. Shortcuts + market catalog ----------
say "Refreshing desktop + app-menu shortcuts…"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/prts/.shortcut-done" 2>/dev/null || true
dsh --profile web --shortcut || warn "shortcut refresh failed (run it later)."

say "Refreshing the plugin-market catalog (best-effort)…"
if [ -f "$SRC_DIR/scripts/scan-market.mjs" ]; then
  ( cd "$SRC_DIR" && node scripts/scan-market.mjs >/dev/null 2>&1 ) || warn "market scan skipped (no network?)"
fi

[ -z "${TMP_TGZ:-}" ] || rm -f "$TMP_TGZ"
say "Done — PRTS is up to date."
