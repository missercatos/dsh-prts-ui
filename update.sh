#!/usr/bin/env bash
#
# PRTS one-click updater (Linux / macOS).
#
#   From the source checkout:  bash update.sh
#   With a newer tarball:      bash update.sh /path/to/dsh-prts-ui-<new>.tgz
#
# Rebuilds (or reuses) the tarball, updates the plugin in the prts profile,
# and refreshes the desktop + app-menu shortcuts — all in one command.
#
set -euo pipefail

GREEN=$'\033[32m'; RED=$'\033[31m'; NC=$'\033[0m'
say() { printf '%b\n' "${GREEN}==>${NC} $*"; }
warn() { printf '%b\n' "${RED}warning:${NC} $*"; }
die() { printf '%b\n' "${RED}error:${NC} $*" >&2; exit 1; }

command -v dsh >/dev/null 2>&1 || die "dsh is not installed. Run \`bash install.sh\` first."

# ---------- dsh plugins (kept updated alongside PRTS) ----------
# Same list as install.sh — dsh has no marketplace; `dsh plugin add <pkg>`
# installs any npm package into the profile bundle.
PLUGINS=(
  # "dsh-at-file"
  # "dsh-cost-meter"
  # "dshmarket"
  # "dsh-better-sidebar"
)
if [ "${#PLUGINS[@]}" -gt 0 ]; then
  say "Updating dsh plugins…"
  PROFILE_DIR_EARLY="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
  mkdir -p "$PROFILE_DIR_EARLY"
  for p in "${PLUGINS[@]}"; do
    dsh plugin --profile prts add "$p" || warn "plugin '$p' failed to update (may not exist on npm)."
  done
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  say "Rebuilding the dsh-prts-ui tarball…"
  ( cd "$SRC_DIR" && (node scripts/bundle-gui.mjs 2>/dev/null || true) && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
  TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "tarball not found: $TGZ"

say "Updating the plugin in profile 'prts'…"
# Approve native-dep build scripts (dsh-prts-ui itself has none), merging so
# other plugins' approved builds survive.
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/prts"
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
STORE="$(pnpm store path 2>/dev/null || true)"
if [ -n "$STORE" ]; then
  rm -rf "$STORE"/file+*dsh-prts-ui* 2>/dev/null || true
fi
dsh plugin --profile prts add "$TGZ"
[ -f "${DSH_HOME:-$HOME/.dsh}/profiles/prts/node_modules/dsh-prts-ui/package.json" ] || die "plugin not present after update."

say "Refreshing desktop + app-menu shortcuts…"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/prts/.shortcut-done" 2>/dev/null || true
dsh --profile prts --shortcut || warn "shortcut refresh failed (run it later)."

say "Refreshing the plugin-market catalog (best-effort)…"
if [ -f "$SRC_DIR/scripts/scan-market.mjs" ]; then
  ( cd "$SRC_DIR" && node scripts/scan-market.mjs >/dev/null 2>&1 ) || warn "market scan skipped (no network?)"
fi

say "Done — PRTS is up to date."
