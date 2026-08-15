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

# ---------- 2. dsh harness ----------
if ! command -v dsh >/dev/null 2>&1; then
  say "Installing the dsh harness (@deepseek-ai/dsh)…"
  npm i -g @deepseek-ai/dsh
fi
dsh --version >/dev/null 2>&1 || die "dsh installed but failed to run."

# ---------- 3. Build the plugin tarball ----------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  say "Building the dsh-prts-ui tarball…"
  ( cd "$SRC_DIR" && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
  TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "plugin tarball not found: $TGZ"

# ---------- 4. Install into the prts profile ----------
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
mkdir -p "$PROFILE_DIR"
say "Approving build scripts in the profile (pnpm 11)…"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  dsh-prts-ui: true
  koffi: true
  node-pty: true
  protobufjs: true
YAML
say "Installing plugin into profile 'prts'…"
dsh plugin --profile prts install "$TGZ" || warn "pnpm reported a warning; continuing if the package landed."
if [ ! -f "$PROFILE_DIR/node_modules/dsh-prts-ui/package.json" ]; then
  die "plugin did not install into $PROFILE_DIR"
fi
say "Pinning the minimal bundle (dsh-prts-ui)…"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.dsh = m.dsh || {};
  m.dsh.profile = { bundles: ["dsh-prts-ui"] };
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
# PRTS launcher — defaults to the terminal client; pass --gui / --shortcut to
# pick another surface.
for a in "$@"; do
  case "$a" in --tui|--gui|--shortcut) exec dsh --profile prts "$@";; esac
done
exec dsh --profile prts --tui "$@"
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
  Terminal client : prts            (or dsh --profile prts --tui)
  GUI window      : prts --gui      (or dsh --profile prts)
  Desktop / dock  : PRTS is now in the app menu and on the Desktop.
                    On KDE, right-click the desktop icon once and choose
                    "Allow Launching" the first time; pin it to the dock from
                    the app launcher.
  Remove          : see README "Removing PRTS".
EOF
