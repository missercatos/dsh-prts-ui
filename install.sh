#!/bin/sh
#
# PRTS integrated-package installer (Linux / macOS) — launcher for the
# cross-platform wizard. The wizard checks dsh (downloading it with live
# progress when missing), offers the optional plugins (already-installed ones
# are greyed out), installs the PRTS UI into the isolated `prts` profile and
# finally applies the PRTS theme over the whole modpack.
#
#   sh install.sh [path/to/dsh-prts-ui-<ver>.tgz]
#
set -eu

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "PRTS: Node.js is required — install it from https://nodejs.org (or https://npmmirror.com/mirrors/node/ in mainland China) and re-run." >&2
  exit 1
fi
export PRTS_WIZARD_TGZ="${1:-}"
exec node "$SRC_DIR/wizard/server.mjs"
