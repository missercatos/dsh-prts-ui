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

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  say "Rebuilding the dsh-prts-ui tarball…"
  ( cd "$SRC_DIR" && (npm pack --silent 2>/dev/null || pnpm pack --silent) )
  TGZ="$(ls -1 "$SRC_DIR"/dsh-prts-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TGZ" ] && [ -f "$TGZ" ] || die "tarball not found: $TGZ"

say "Updating the plugin in profile 'prts'…"
dsh plugin --profile prts install "$TGZ" || warn "pnpm reported a warning; continuing."
[ -f "${DSH_HOME:-$HOME/.dsh}/profiles/prts/node_modules/dsh-prts-ui/package.json" ] || die "plugin not present after update."

say "Refreshing desktop + app-menu shortcuts…"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/prts/.shortcut-done" 2>/dev/null || true
dsh --profile prts --shortcut || warn "shortcut refresh failed (run it later)."

say "Done — PRTS is up to date."
