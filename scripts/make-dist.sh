#!/bin/sh
#
# PRTS release builder — produces every installer artifact in dist/:
#
#   dsh-prts-ui-<ver>.tgz              the dsh plugin tarball (profile install)
#   PRTS-<ver>-linux-x64.run           self-extracting Linux installer
#   PRTS-<ver>-macos.sh                self-extracting macOS installer
#   PRTS-Setup-<ver>-windows-x64.exe   self-extracting Windows installer (PE32+)
#   PRTS-Setup-<ver>-windows-x64.zip   plain zip fallback for Windows
#   PRTS-<ver>-android.zip             Termux/Android installer
#   SHA256SUMS                          checksums for every artifact
#   releases.json                       manifest consumed by the download site
#
# The Windows exe is a mingw-w64 stub (dist-tools/sfx.c) with the payload zip
# appended — it extracts with tar/PowerShell and runs install.bat, so the
# whole installer chain (dsh + plugins + GUI + config + updater) is one file.
#
set -eu

cd "$(dirname "$0")/.."

VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo 0.0.0)"
OUT="dist"
OUT_ABS="$(pwd)/dist"
PAYLOAD="$OUT/.payload/dsh-prts-ui"
STUB="dist-tools/PRTS-Setup.exe"

rm -rf "$OUT/.payload" "$OUT/.work"
mkdir -p "$OUT" "$PAYLOAD"
# Drop previous-version artifacts so dist/ only ever holds one release.
rm -f "$OUT"/PRTS-*.run "$OUT"/PRTS-*.sh "$OUT"/PRTS-Setup-*.exe "$OUT"/PRTS-Setup-*.zip "$OUT"/PRTS-*.zip "$OUT"/dsh-prts-ui-*.tgz "$OUT"/SHA256SUMS "$OUT"/releases.json

say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. Plugin tarball ----------
say "Building the dsh-prts-ui tarball ($VERSION)…"
node scripts/bundle-gui.mjs
# Always pack fresh — reusing an older tarball with the same prefix silently
# ships the previous version (the classic `ls | head -1` trap).
say "Packing the plugin tarball…"
npm pack --silent 2>/dev/null || pnpm pack --silent || die "could not pack the tarball"
TGZ="dsh-prts-ui-$VERSION.tgz"
[ -f "$TGZ" ] || die "tarball missing: $TGZ"
cp "$TGZ" "$OUT/dsh-prts-ui-$VERSION.tgz"

# ---------- 2. Payload directory (what every installer extracts) ----------
say "Preparing the installer payload…"
for f in bin src web electron assets scripts cordis.patch.yml package.json LICENSE README.md README.zh.md \
         install.sh install.bat install-android.sh update.sh update.bat build-exe.bat prts.config.example.json; do
  if [ -e "$f" ]; then
    mkdir -p "$PAYLOAD/$(dirname "$f")"
    cp -a "$f" "$PAYLOAD/$(dirname "$f")/"
  fi
done
cp "$OUT/dsh-prts-ui-$VERSION.tgz" "$PAYLOAD/"

# ---------- 3. Linux / macOS self-extracting .run ----------
say "Building the Linux and macOS installers…"
write_run() {
  # $1 = output file, $2 = friendly name
  OUT_RUN="$1"; NAME="$2"
  {
    cat <<RUN_EOF
#!/bin/sh
# $NAME — self-extracting PRTS installer (Linux / macOS).
# Usage: sh $NAME   (or chmod +x and run directly)
set -eu
NAME="$(basename "\$0")"
WORK="\$(mktemp -d 2>/dev/null || mktemp -d "\${TMPDIR:-/tmp}/prts.XXXXXX")"
trap 'rm -rf "\$WORK"' EXIT INT TERM
echo "PRTS: extracting to \$WORK …"
ARCHIVE=\$(awk '/^__ARCHIVE_BELOW__\$/ {print NR + 1; exit 0;}' "\$0")
tail -n +\$ARCHIVE "\$0" | tar -xz -C "\$WORK"
cd "\$WORK/dsh-prts-ui"
TGZ="\$(ls -1 dsh-prts-ui-*.tgz | head -1)"
echo "PRTS: starting the installer (install.sh) with \$TGZ …"
sh install.sh "\$TGZ"
echo "PRTS: installation finished."
exit 0
__ARCHIVE_BELOW__
RUN_EOF
    tar -cz -C "$OUT/.payload" dsh-prts-ui
  } > "$OUT_RUN"
  chmod +x "$OUT_RUN"
}
write_run "$OUT/PRTS-$VERSION-linux-x64.run" "PRTS Linux installer"
write_run "$OUT/PRTS-$VERSION-macos.sh" "PRTS macOS installer"

# ---------- 4. Windows exe (SFX stub + payload zip) ----------
say "Building the Windows installer exe…"
if [ ! -f "$STUB" ]; then
  if command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    ( cd dist-tools && x86_64-w64-mingw32-windres prts.rc -O coff -o prts.res.o && x86_64-w64-mingw32-gcc -Os -s -o PRTS-Setup.exe sfx.c prts.res.o -luser32 -lshell32 )
  else
    warn="mingw-w64 not found — skipping the exe (zip + build-exe.bat still produced)"
  fi
fi
ZIP_PAYLOAD="$OUT/.work/PRTS-windows"
rm -rf "$ZIP_PAYLOAD"
mkdir -p "$ZIP_PAYLOAD"
cp -a "$PAYLOAD" "$ZIP_PAYLOAD/dsh-prts-ui"
( cd "$ZIP_PAYLOAD" && zip -qr "$OUT_ABS/PRTS-Setup-$VERSION-windows-x64.zip" dsh-prts-ui )
if [ -f "$STUB" ]; then
  ( cd "$ZIP_PAYLOAD" && zip -q -9 "$OUT_ABS/.work/payload.zip" -r dsh-prts-ui )
  EXE="$OUT/PRTS-Setup-$VERSION-windows-x64.exe"
  cp "$STUB" "$EXE"
  printf 'PRTSPAYLOAD0' >> "$EXE"
  cat "$OUT/.work/payload.zip" >> "$EXE"
  say "windows exe: $(ls -la "$EXE" | awk '{print $5}') bytes"
fi

# ---------- 5. Android ----------
say "Building the Android (Termux) installer…"
ANDROID_DIR="$OUT/.work/PRTS-android"
rm -rf "$ANDROID_DIR"
mkdir -p "$ANDROID_DIR"
cp -a "$PAYLOAD" "$ANDROID_DIR/dsh-prts-ui"
cat > "$ANDROID_DIR/README.txt" <<'EOF'
PRTS on Android (Termux)
------------------------
1. Install Termux (F-Droid build recommended).
2. pkg update && pkg install -y nodejs git curl termux-api
3. Copy the dsh-prts-ui folder to ~/ and run:
     cd ~/dsh-prts-ui && sh install-android.sh
4. Start with `prts`, then open http://127.0.0.1:3080 in your browser.

Tip: the PRTS website is a PWA — open it in Chrome and choose
"Add to Home screen" for an app-like launcher.
EOF
( cd "$OUT_ABS/.work" && zip -qr "$OUT_ABS/PRTS-$VERSION-android.zip" PRTS-android )

# ---------- 6. Checksums + release manifest ----------
say "Writing SHA256SUMS and releases.json…"
( cd "$OUT" && sha256sum dsh-prts-ui-*.tgz PRTS-*.run PRTS-*.sh PRTS-Setup-*.exe PRTS-Setup-*.zip PRTS-*.zip 2>/dev/null > SHA256SUMS )

BASE="${PRTS_RELEASE_BASE:-https://your-domain.example.com/releases}"
node - "$VERSION" "$BASE" "$OUT" <<'NODE'
const fs = require('fs')
const [version, base] = process.argv.slice(2)
const out = process.argv[4]
const files = fs.readdirSync(out).filter((f) => !f.startsWith('.') && f !== 'SHA256SUMS' && f !== 'releases.json')
const checksums = fs.readFileSync(out + '/SHA256SUMS', 'utf8')
  .split('\n').filter(Boolean)
  .map((l) => { const [sum, name] = l.split(/\s+/); return [name, sum] })
const hashOf = (name) => { const hit = checksums.find(([n]) => n === name); return hit ? hit[1] : '' }
const manifest = {
  product: 'dsh-prts-ui',
  version,
  releasedAt: new Date().toISOString(),
  files: files.map((f) => ({ file: f, sha256: hashOf(f), url: base.replace(/\/+$/, '') + '/' + f })),
  downloads: {
    windows: files.find((f) => f.endsWith('-windows-x64.exe')) || files.find((f) => f.endsWith('-windows-x64.zip')) || '',
    linux: files.find((f) => f.endsWith('-linux-x64.run')) || '',
    macos: files.find((f) => f.endsWith('-macos.sh')) || '',
    android: files.find((f) => f.endsWith('-android.zip')) || '',
    tarball: files.find((f) => f.startsWith('dsh-prts-ui-') && f.endsWith('.tgz')) || '',
  },
}
fs.writeFileSync(out + '/releases.json', JSON.stringify(manifest, null, 2))
console.log('manifest ->', out + '/releases.json')
NODE

rm -rf "$OUT/.payload" "$OUT/.work"
say "dist/ contents:"
ls -la "$OUT"
