#!/bin/sh
#
# PRTS one-click installer (Linux / macOS).
#
#   From the source checkout:  sh install.sh
#   With a prebuilt tarball:   sh install.sh /path/to/dsh-prts-ui-<ver>.tgz
#
# What it does:
#   1. Checks Node.js + npm (dsh is a Node harness).
#   2. Installs the dsh harness globally (npm registry -> npmmirror fallback,
#      so it works on networks that cannot reach registry.npmjs.org).
#   3. Installs the configured dsh plugins (prts.config.json "plugins").
#   4. Builds (or reuses) the dsh-prts-ui tarball.
#   5. Installs the plugin into the `prts` profile and pins the minimal bundle.
#   6. Provisions ~/.dsh/profiles/prts/prts.config.json from the example.
#   7. Creates the desktop + app-menu shortcuts and the `prts` command.
#
# China-friendly: every network step falls back to npmmirror / gitee mirrors.
#
set -eu

GREEN='\033[32m'; RED='\033[31m'; NC='\033[0m'
say() { printf '%b\n' "${GREEN}==>${NC} $*"; }
warn() { printf '%b\n' "${RED}warning:${NC} $*"; }
die() { printf '%b\n' "${RED}error:${NC} $*" >&2; exit 1; }

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/prts"
CONFIG_FILE="$PROFILE_DIR/prts.config.json"

# ---------- config (prts.config.json in the profile, example as template) ----------
mkdir -p "$PROFILE_DIR"
if [ ! -f "$CONFIG_FILE" ] && [ -f "$(dirname "$0")/prts.config.example.json" ]; then
  cp "$(dirname "$0")/prts.config.example.json" "$CONFIG_FILE"
  say "provisioned $CONFIG_FILE (edit it to change mirrors / plugins / release URL)"
fi

# Read scalar values from the JSON config without jq.
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
ELECTRON_MIRROR_CFG="$(cfg_get electronMirror)"
[ -n "$ELECTRON_MIRROR_CFG" ] || ELECTRON_MIRROR_CFG="https://npmmirror.com/mirrors/electron/"
export ELECTRON_MIRROR="$ELECTRON_MIRROR_CFG"

# npm install helper: registry, then the fallback registry on failure.
npm_i() {
  if [ -n "$NPM_REG" ]; then
    npm install "$@" --registry="$NPM_REG" 2>/dev/null && return 0
  else
    npm install "$@" 2>/dev/null && return 0
  fi
  warn "primary registry failed — retrying with $NPM_REG_FALLBACK"
  npm install "$@" --registry="$NPM_REG_FALLBACK"
}

# ---------- 1. Node.js + npm ----------
command -v node >/dev/null 2>&1 || die "Node.js is required (https://nodejs.org or https://npmmirror.com/mirrors/node/). Install it and re-run."
command -v npm  >/dev/null 2>&1 || die "npm is required (ships with Node.js)."
command -v pnpm >/dev/null 2>&1 || npm_i -g pnpm || true

# ---------- 2. dsh harness (idempotent) ----------
DSH_PKG="$(cfg_get dshPackage)"
[ -n "$DSH_PKG" ] || DSH_PKG="@deepseek-ai/dsh"
if command -v dsh >/dev/null 2>&1; then
  say "dsh is already installed: $(dsh --version 2>/dev/null | head -1)"
else
  say "Installing the dsh harness ($DSH_PKG)…"
  npm_i -g "$DSH_PKG"
fi
dsh --version >/dev/null 2>&1 || die "dsh installed but failed to run."

# ---------- 3. dsh plugins from prts.config.json ----------
PLUGINS_JSON="$(cfg_get plugins)"
if [ -n "$PLUGINS_JSON" ]; then
  PLUGINS="$(node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const p = Array.isArray(c.plugins) ? c.plugins : [];
      process.stdout.write(p.join("\n"));
    } catch (e) { process.stdout.write(""); }
  ' "$CONFIG_FILE" 2>/dev/null || true)"
  if [ -n "$PLUGINS" ]; then
    say "Installing dsh plugins…"
    for p in $PLUGINS; do
      dsh plugin --profile prts add "$p" || warn "plugin '$p' failed to install (may not exist on npm)."
    done
  fi
fi

# ---------- 4. Build (or reuse) the plugin tarball ----------
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  say "Building the dsh-prts-ui tarball…"
  ( cd "$SRC_DIR" && (node scripts/bundle-gui.mjs 2>/dev/null || true) && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
  TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "plugin tarball not found: $TGZ"
# dsh plugin add resolves bare names against the npm registry — hand it an
# absolute file path so the tarball is always treated as a local file.
case "$TGZ" in
  /*) ;;
  *) TGZ="$(cd "$(dirname "$TGZ")" && pwd)/$(basename "$TGZ")" ;;
esac

# ---------- 5. Install into the prts profile ----------
say "Approving build scripts in the profile (pnpm 11)…"
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
say "Installing plugin into profile 'prts'…"
if [ -f "$PROFILE_DIR/node_modules/dsh-prts-ui/package.json" ]; then
  V="$(node -e "console.log(require('$PROFILE_DIR/node_modules/dsh-prts-ui/package.json').version)" 2>/dev/null || echo '?')"
  say "PRTS is already installed (v$V) — skipping re-install. Use \`sh update.sh\` to upgrade."
else
  dsh plugin --profile prts add "$TGZ" || warn "pnpm reported a warning; continuing if the package landed."
fi
if [ ! -f "$PROFILE_DIR/node_modules/dsh-prts-ui/package.json" ]; then
  die "plugin did not install into $PROFILE_DIR"
fi
say "Pinning the bundle (dsh-prts-ui first, other plugins preserved)…"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.dsh = m.dsh || {};
  const existing = (m.dsh.profile && m.dsh.profile.bundles) || [];
  m.dsh.profile = { bundles: Array.from(new Set(["dsh-prts-ui"].concat(existing))) };
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
' "$PROFILE_DIR/package.json"

# ---------- 6. Shortcuts (desktop + app menu) ----------
say "Creating desktop + app-menu shortcuts…"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/prts/.shortcut-done" 2>/dev/null || true
dsh --profile prts --shortcut || warn "shortcut step failed (you can run \`dsh --profile prts --shortcut\` later)"

# ---------- 7. `prts` command on PATH ----------
say "Installing the 'prts' command…"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/prts" <<'EOF'
#!/bin/sh
# PRTS launcher — the GUI window is the default surface (dsh --profile prts).
exec dsh --profile prts "$@"
EOF
chmod +x "$BIN_DIR/prts"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) export PATH="$BIN_DIR:$PATH"
     touch "$HOME/.bashrc"
     if ! grep -q '\.local/bin' "$HOME/.bashrc" 2>/dev/null; then
       printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
     fi ;;
esac

cat <<EOF

${GREEN}Done!${NC}
  GUI window      : prts            (or dsh --profile prts)
  Desktop / dock  : PRTS is now in the app menu and on the Desktop.
                    On KDE, right-click the desktop icon once and choose
                    "Allow Launching" the first time; pin it to the dock from
                    the app launcher.
  Update          : Settings → Update, or re-run \`sh update.sh\`.
  Config          : $CONFIG_FILE (mirrors, plugins, release URL)
  Remove          : see README "Removing PRTS".
EOF
