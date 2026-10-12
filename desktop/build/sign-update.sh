#!/bin/bash
# Signs one Mac update ZIP into its feed, for Sparkle:
#
#   bash build/sign-update.sh <zip> <download-url> <appcast.xml> [notes.md]
#
# SPARKLE_KEY is the private EdDSA key file and SPARKLE_BIN Sparkle's tools
# (default vendor/sparkle/bin, from build/sparkle.sh). The release workflow
# and build/test-update.sh both sign this way. Before anything is written the
# signature is checked with the public key inside the app in the ZIP, as
# Sparkle will check it, so a wrong key fails here. Never prints the key.
set -euo pipefail
# Paths are taken from where it was run, before it moves to desktop/.
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
ZIP="$(abs "$1")"; URL="$2"; OUT="$(abs "$3")"; NOTES="${4:+$(abs "$4")}"
cd "$(dirname "$0")/.."
SPARKLE_BIN="${SPARKLE_BIN:-$(pwd)/vendor/sparkle/bin}"
[ -x "$SPARKLE_BIN/generate_appcast" ] || { echo "Sparkle's tools aren't at $SPARKLE_BIN (run build/sparkle.sh)"; exit 1; }
[ -f "${SPARKLE_KEY:-}" ] || { echo "SPARKLE_KEY doesn't name a key file"; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The app inside: its version and the key it trusts.
ditto -x -k "$ZIP" "$work/app"
PLIST="$(ls -d "$work"/app/*.app | head -1)/Contents/Info.plist"
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")"
PUBLIC="$(/usr/libexec/PlistBuddy -c "Print :SUPublicEDKey" "$PLIST")"

# generate_appcast signs every archive in its folder, so this one gets its own.
mkdir "$work/cast"
cp "$ZIP" "$work/cast/"
# Notes for the update window: a Markdown file named like the archive.
[ -n "$NOTES" ] && cp "$NOTES" "$work/cast/$(basename "${ZIP%.zip}").md"
"$SPARKLE_BIN/generate_appcast" --ed-key-file "$SPARKLE_KEY" --download-url-prefix "$URL" \
  --link "https://github.com/bomkino/8bit-Voice/releases" --embed-release-notes --maximum-versions 1 \
  -o "$work/appcast.xml" "$work/cast" > "$work/log" 2>&1 || { cat "$work/log"; echo "generate_appcast failed"; exit 1; }
grep -Eq "sparkle:shortVersionString(>|=\")${VERSION}[<\"]" "$work/appcast.xml" || { cat "$work/log"; echo "the feed doesn't name $VERSION"; exit 1; }
grep -q "url=\"$URL$(basename "$ZIP")\"" "$work/appcast.xml" || { echo "the feed doesn't point at $URL$(basename "$ZIP")"; exit 1; }
# Sparkle signs only with the key whose public half the app holds; with any
# other it warns and leaves the feed unsigned, which verify catches.
node build/appcast.mjs verify "$work/appcast.xml" "$ZIP" "$PUBLIC" \
  || { grep -i "warning\|error" "$work/log" || true; echo "the app wouldn't accept this feed: is the key the one whose public half is $PUBLIC?"; exit 1; }
cp "$work/appcast.xml" "$OUT"
echo "Signed $VERSION into $(basename "$OUT")"
