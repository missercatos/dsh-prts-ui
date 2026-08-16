#!/usr/bin/env bash
#
# PRTS one-click installer (Linux / macOS).
#
#   From the source checkout:  bash install.sh
#   With a prebuilt tarball:   bash install.sh /path/to/dsh-prts-ui-0.1.0.tgz
#
# What it does:
#   1. Checks Node.js + npm (dsh is a Node harness).
#   2. Installs the dsh harness globally if missing.
#   3. Builds (or reuses) the dsh-prts-ui tarball.
#   4. Installs the plugin into the `prts` profile and pins the minimal bundle.
#   5. Creates the desktop + app-menu shortcuts.
#   6. Installs a `prts` command on PATH (terminal client).
#
set -euo pipefail

GREEN=$'\033[32m'; RED=$'\033[31m'; NC=$'\033[0m'
say() { printf '%b\n' "${GREEN}==>${NC} $*"; }
warn() { printf '%b\n' "${RED}warning:${NC} $*"; }
die() { printf '%b\n' "${RED}error:${NC} $*" >&2; exit 1; }

# ---------- 1. Node.js + npm ----------
command -v node >/dev/null 2>&1 || die "Node.js is required (https://nodejs.org). Install it and re-run."
command -v npm  >/dev/null 2>&1 || die "npm is required (ships with Node.js)."
command -v pnpm >/dev/null 2>&1 || npm i -g pnpm >/dev/null 2>&1 || true

# ---------- 2. dsh harness (idempotent) ----------
if command -v dsh >/dev/null 2>&1; then
  say "dsh is already installed: $(dsh --version 2>/dev/null | head -1)"
else
  say "Installing the dsh harness (@deepseek-ai/dsh)…"
  npm i -g @deepseek-ai/dsh
fi
dsh --version >/dev/null 2>&1 || die "dsh installed but failed to run."

# ---------- 2.5. dsh plugins (optional, kept updated alongside PRTS) ----------
# dsh has no plugin marketplace: `dsh plugin --profile <name> add <pkg>` just
# installs any npm package into the profile's bundle. Add the packages you want
# here and they are installed/updated before PRTS itself.
PLUGINS=(
  # "dsh-at-file"
  # "dsh-cost-meter"
  # "dshmarket"
  # "dsh-better-sidebar"
)
if [ "${#PLUGINS[@]}" -gt 0 ]; then
  say "Installing dsh plugins…"
  PROFILE_DIR_EARLY="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
  mkdir -p "$PROFILE_DIR_EARLY"
  for p in "${PLUGINS[@]}"; do
    dsh plugin --profile prts add "$p" || warn "plugin '$p' failed to install (may not exist on npm)."
  done
fi

# ---------- 3. Build the plugin tarball ----------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  say "Building the dsh-prts-ui tarball…"
  ( cd "$SRC_DIR" && (node scripts/bundle-gui.mjs 2>/dev/null || true) && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
  TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "plugin tarball not found: $TGZ"

# ---------- 4. Install into the prts profile ----------
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
mkdir -p "$PROFILE_DIR"
say "Approving build scripts in the profile (pnpm 11)…"
# dsh-prts-ui itself has no build script (bundled + shortcut done here), so it
# needs no `file:` allowBuilds key — only the native deps need approving. We
# merge so any other plugin's approved builds are preserved.
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
  say "PRTS is already installed (v$V) — skipping re-install. Use \`bash update.sh\` to upgrade."
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

# ---------- 5. Shortcuts (desktop + app menu) ----------
say "Creating desktop + app-menu shortcuts…"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/prts/.shortcut-done" 2>/dev/null || true
dsh --profile prts --shortcut || warn "shortcut step failed (you can run \`dsh --profile prts --shortcut\` later)"

# ---------- 6. `prts` command on PATH ----------
say "Installing the 'prts' command…"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/prts" <<'EOF'
#!/usr/bin/env bash
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
  Update          : Settings → Update, or re-run `bash update.sh`.
  Remove          : see README "Removing PRTS".
EOF
