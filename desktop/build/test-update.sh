#!/bin/bash
# Proves the Mac app's in-app updates work, on a Mac or in CI, without
# pitch.dog's real key. Test copies of the app (another name and bundle
# identifier) trust only a throwaway key; 9.0.1 is packed with build/zip-mac.cjs's
# ditto and signed by build/sign-update.sh, as a release is, and served locally.
#
#   bash build/test-update.sh
#
#   1. 9.0.0 reads the feed and installs 9.0.1, and 9.0.1 starts as a new
#      process, says it is running, and keeps running. 9.0.1 has a new name,
#      the way 8-bit Voice 1.1 became BleepBloop 1.2, so this also proves an
#      update can rename the app: Sparkle finds it by its bundle identifier.
#   2. With one byte of the served ZIP changed, 9.0.0 refuses it and stays.
#
# Needs a logged-in session (the app opens a window) and build/sparkle.sh run.
set -euo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"
NAME="8-bit Voice Update Test"
NEW_NAME="BleepBloop Update Test"
ID="dog.pitch.8bitvoice.updatetest"
PORT=8766
ARCH="$(uname -m | sed 's/x86_64/x64/')"

cleanup() {
  pkill -f "$NAME.app/Contents/MacOS/" 2>/dev/null || true
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null || true
  defaults delete "$ID" 2>/dev/null || true
  rm -rf "$HOME/Library/Application Support/$NAME" "$HOME/Library/Application Support/$NEW_NAME"
}
trap cleanup EXIT

echo "== A throwaway signing key"
export SPARKLE_KEY="$T/key"
export SPARKLE_PUBLIC_KEY_OVERRIDE="$(node build/appcast.mjs keygen "$SPARKLE_KEY")"
export REQUIRE_SPARKLE=1 CSC_IDENTITY_AUTO_DISCOVERY=false

build() {
  npx electron-builder --mac dir "--$ARCH" --publish never \
    -c.productName="$2" -c.appId="$ID" -c.extraMetadata.version="$1" \
    -c.directories.output="$T/build-$1" > "$T/build-$1.log" 2>&1 || { tail -40 "$T/build-$1.log"; exit 1; }
  ls -d "$T/build-$1"/mac*/"$2.app"
}
echo "== Test copies at 9.0.0 (installed) and 9.0.1, renamed (on the feed)"
OLD_APP="$(build 9.0.0 "$NAME")"
NEW_APP="$(build 9.0.1 "$NEW_NAME")"
mkdir -p "$T/install" "$T/feed"
ZIP="8-bit-Voice-Update-Test-$ARCH.zip"
ditto -c -k --sequesterRsrc --keepParent "$NEW_APP" "$T/feed/$ZIP"
printf 'Test notes.\n' > "$T/notes.md"
# Relative paths from another folder, the way the release workflow calls it.
(cd "$T" && bash "$OLDPWD/build/sign-update.sh" "feed/$ZIP" "http://127.0.0.1:$PORT/" feed/appcast.xml notes.md)

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T/feed" 2> "$T/server.log" &
SERVER=$!
sleep 1

APP="$T/install/$NAME.app"
version() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist"; }
bundle_name() { /usr/libexec/PlistBuddy -c "Print :CFBundleName" "$APP/Contents/Info.plist"; }

# A running copy writes "version process" here once it is up. It reads the
# path from its defaults, which a relaunch keeps; it doesn't keep the environment.
READY="$T/ready"
defaults write "$ID" UpdateTestReadyFile "$READY"

# Installs a fresh 9.0.0 and runs it against the feed for up to $1 seconds,
# stopping early once its files say 9.0.1. OLD is the process it started as.
run() {
  pkill -f "$NAME.app/Contents/MacOS/" 2>/dev/null || true
  rm -rf "$APP" && ditto "$OLD_APP" "$APP"
  rm -f "$READY"
  : > "$T/server.log"
  STUDIO_UPDATE_TEST=1 STUDIO_UPDATE_FEED="http://127.0.0.1:$PORT/appcast.xml" \
    "$APP/Contents/MacOS/$NAME" > "$T/app.log" 2>&1 &
  OLD=$!
  for _ in $(seq "$1"); do
    sleep 1
    [ "$(version)" = 9.0.1 ] && break
  done
  return 0
}
stop() {
  sleep 2
  pkill -f "$NAME.app/Contents/MacOS/" 2>/dev/null || true
}

echo "== 1. A signed update installs and the new version runs"
run 120
grep -q "GET /$ZIP" "$T/server.log" || { echo "FAIL: the ZIP was never fetched"; cat "$T/server.log"; tail -40 "$T/app.log"; exit 1; }
[ "$(version)" = 9.0.1 ] || { echo "FAIL: still $(version) after the update"; cat "$T/server.log"; tail -40 "$T/app.log"; exit 1; }
NEW=""
for _ in $(seq 60); do
  if read -r v pid < "$READY" 2>/dev/null && [ "$v" = 9.0.1 ] && [ "$pid" != "$OLD" ]; then NEW="$pid"; break; fi
  sleep 1
done
[ -n "$NEW" ] || { echo "FAIL: 9.0.1 is on disk, but no new process ever said it was running"; cat "$READY" 2>/dev/null; tail -40 "$T/app.log"; exit 1; }
sleep 3
kill -0 "$NEW" 2>/dev/null || { echo "FAIL: 9.0.1 started (process $NEW) but stopped within three seconds"; exit 1; }
codesign --verify --deep --strict "$APP" || { echo "FAIL: the updated app's signature doesn't hold"; exit 1; }
[ "$(bundle_name)" = "$NEW_NAME" ] || { echo "FAIL: the update kept the old name ($(bundle_name))"; exit 1; }
echo "   9.0.0 (process $OLD) fetched $ZIP, and 9.0.1, now called $(bundle_name), relaunched as process $NEW and kept running"
stop

echo "== 2. A ZIP with one byte changed is refused"
python3 - "$T/feed/$ZIP" <<'PY'
import sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
b[len(b) // 2] ^= 0x01
open(p, "wb").write(b)
PY
run 40
stop
grep -q "GET /$ZIP" "$T/server.log" || { echo "FAIL: the tampered ZIP was never fetched, so nothing was tested"; cat "$T/server.log"; tail -40 "$T/app.log"; exit 1; }
[ "$(version)" = 9.0.0 ] || { echo "FAIL: a tampered update was installed ($(version))"; exit 1; }
echo "   9.0.0 fetched the tampered $ZIP and stayed at $(version)"
echo "== In-app updates: OK"
