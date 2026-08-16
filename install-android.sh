#!/bin/sh
#
# PRTS installer for Android (Termux).
#
# Android cannot run the Electron window, so this installs the real dsh
# harness + the PRTS GUI plugin inside Termux and opens the GUI in the
# Android browser (PRTS served from the dsh web backend). Works without
# Google services and without GitHub access (npmmirror fallbacks).
#
#   pkg install -y termux-api && pkg install -y nodejs git curl
#   sh install-android.sh
#
set -eu

say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is required: run \`pkg install nodejs\` first."
command -v npm  >/dev/null 2>&1 || die "npm is required (ships with the nodejs package)."

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# ---------- 1. dsh harness ----------
if command -v dsh >/dev/null 2>&1; then
  say "dsh is already installed."
else
  say "Installing the dsh harness…"
  npm i -g @deepseek-ai/dsh 2>/dev/null || npm i -g @deepseek-ai/dsh --registry=https://registry.npmmirror.com
fi

# ---------- 2. PRTS plugin into the prts profile ----------
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
say "Building the dsh-prts-ui tarball…"
( cd "$SRC_DIR" && (node scripts/bundle-gui.mjs 2>/dev/null || true) && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "plugin tarball not found."

PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
mkdir -p "$PROFILE_DIR"
dsh plugin --profile prts add "$TGZ"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.dsh = m.dsh || {};
  const existing = (m.dsh.profile && m.dsh.profile.bundles) || [];
  m.dsh.profile = { bundles: Array.from(new Set(["dsh-prts-ui"].concat(existing))) };
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
' "$PROFILE_DIR/package.json"

# ---------- 3. Desktop-entry style launcher ----------
say "Creating the prts launcher…"
mkdir -p "$HOME/bin"
cat > "$HOME/bin/prts" <<'EOF'
#!/bin/sh
# PRTS on Android: start dsh web (browser GUI) — the PRTS plugin boots inside it.
exec dsh --profile prts
EOF
chmod +x "$HOME/bin/prts"

cat <<EOF

${GREEN}Done!${NC}
  Start          : prts     (then open http://127.0.0.1:3080 in your browser)
  Stop           : press Ctrl+C in Termux
  Update         : re-run \`sh update.sh\` (or \`sh update-android.sh\`)
  Note           : the desktop window needs a desktop OS; on Android the
                   browser GUI is the surface (same dsh, same plugin).
EOF
