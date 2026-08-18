#!/bin/sh
#
# PRTS release builder — produces every installer artifact in dist/:
#
#   dsh-prts-ui-<ver>.tgz              the dsh plugin tarball (profile install)
#   PRTS-<ver>-linux-x64.run           self-extracting Linux installer
#   PRTS-<ver>-macos.sh                self-extracting macOS installer
#   PRTS-Setup-<ver>-windows-x64.exe   self-extracting Windows installer (PE32+)
#   PRTS-Setup-<ver>-windows-x64.zip   plain zip fallback for Windows
#   PRTS-mobile-<ver>.zip              mobile guide (scan-to-connect, no install)
#   SHA256SUMS                          checksums for every artifact
#   releases.json                       STABLE-channel manifest for the site + updater
#
# Every installer extracts the same payload and opens the cross-platform
# PRTS wizard (wizard/server.mjs): dsh check/download with progress, plugin
# selection (installed ones greyed out), PRTS UI install and theme applied.
# Only this STABLE release set goes to the download site and the in-app
# update channel — the git working tree (现行版) never enters releases.json.
#
# The Windows exe is a mingw-w64 stub (dist-tools/sfx.c) with the payload zip
# appended — it extracts with tar/PowerShell and runs install.bat, so the
# whole installer chain (dsh + plugins + GUI + wizard) is one file.
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
for f in bin src web electron assets scripts wizard vendor cordis.patch.yml package.json LICENSE README.md README.zh.md \
         install.sh install.bat prts.config.example.json; do
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
NAME="\$(basename "\$0")"
WORK="\$(mktemp -d 2>/dev/null || mktemp -d "\${TMPDIR:-/tmp}/prts.XXXXXX")"
trap 'rm -rf "\$WORK"' EXIT INT TERM
echo "PRTS: extracting to \$WORK …"
ARCHIVE=\$(awk '/^__ARCHIVE_BELOW__\$/ {print NR + 1; exit 0;}' "\$0")
tail -n +\$ARCHIVE "\$0" | tar -xz -C "\$WORK"
cd "\$WORK/dsh-prts-ui"
TGZ="\$(ls -1 dsh-prts-ui-*.tgz | head -1)"
echo "PRTS: opening the installer wizard…"
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

# ---------- 5. Mobile (Android/phone) guide — scan-to-connect, no install ----------
say "Building the mobile guide zip…"
MOBILE_DIR="$OUT/.work/PRTS-mobile"
rm -rf "$MOBILE_DIR"
mkdir -p "$MOBILE_DIR"
cat > "$MOBILE_DIR/README.html" <<'MOBILE_EOF'
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRTS 手机端</title>
<style>body{background:#0A0A0B;color:#FAFAFA;font-family:sans-serif;padding:24px;line-height:1.9}
h1{font-style:italic;letter-spacing:.2em}code{background:#161618;padding:2px 8px;border-radius:6px}
.dim{color:#9C9CA1}</style></head><body>
<h1>PRTS · 手机端</h1>
<p>手机端无需安装任何东西 —— 只负责<b>扫码连接电脑</b>，然后就能在手机上控制电脑里的 dsh（对话、工具、审批全部可用）。</p>
<p><b>1.</b> 在电脑上打开 PRTS，进入 设置 → PRTS → 移动端；<br>
<b>2.</b> 用手机扫屏幕上的二维码（或手动输入地址）；<br>
<b>3.</b> 手机浏览器打开后，用浏览器菜单「添加到主屏幕」即可当 App 用。</p>
<p class="dim">要求：手机与电脑在同一个局域网。主题与配色跟随你在电脑 PRTS 里的设置。</p>
</body></html>
MOBILE_EOF
( cd "$OUT_ABS/.work" && zip -qr "$OUT_ABS/PRTS-mobile-$VERSION.zip" PRTS-mobile )

# ---------- 6. Checksums + STABLE release manifest ----------
say "Writing SHA256SUMS and releases.json…"
( cd "$OUT" && sha256sum dsh-prts-ui-*.tgz PRTS-[0-9]*.run PRTS-[0-9]*.sh PRTS-mobile-*.zip PRTS-Setup-*.exe PRTS-Setup-*.zip 2>/dev/null > SHA256SUMS )

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
  channel: 'stable', // only the STABLE release set — the git tree never lands here
  version,
  releasedAt: new Date().toISOString(),
  files: files.map((f) => ({ file: f, sha256: hashOf(f), url: base.replace(/\/+$/, '') + '/' + f })),
  downloads: {
    windows: files.find((f) => f.endsWith('-windows-x64.exe')) || files.find((f) => f.endsWith('-windows-x64.zip')) || '',
    linux: files.find((f) => f.endsWith('-linux-x64.run')) || '',
    macos: files.find((f) => f.endsWith('-macos.sh')) || '',
    mobile: files.find((f) => f.startsWith('PRTS-mobile-') && f.endsWith('.zip')) || '',
    tarball: files.find((f) => f.startsWith('dsh-prts-ui-') && f.endsWith('.tgz')) || '',
  },
}
fs.writeFileSync(out + '/releases.json', JSON.stringify(manifest, null, 2))
console.log('manifest ->', out + '/releases.json (stable channel)')
NODE

rm -rf "$OUT/.payload" "$OUT/.work"
say "dist/ contents:"
ls -la "$OUT"
