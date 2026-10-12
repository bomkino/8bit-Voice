#!/bin/bash
# Gets Sparkle 2.10.0 (the updater pitch.dog's Mac apps use) and builds the
# small bridge that lets the app talk to it, for the Mac build:
#
#   vendor/sparkle/          Sparkle's release: Sparkle.framework and bin/ (its tools)
#   native/sparkle/sparkle.node   the bridge, one file for Apple silicon and Intel
#
# The download is checked against Sparkle's published checksum. The bridge is
# an N-API addon, which every Node and Electron version loads alike, so it is
# compiled straight against this Node's headers, no node-gyp needed.
# Runs on a Mac only; anywhere else it says so and does nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=2.10.0
SHA256=c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c

if [ "$(uname)" != Darwin ]; then
  echo "Sparkle is for the Mac build; skipped on $(uname)."
  exit 0
fi

if [ ! -d vendor/sparkle/Sparkle.framework ] || [ "$(cat vendor/sparkle/.version 2>/dev/null)" != "$VERSION" ]; then
  echo "== Sparkle $VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/sparkle.tar.xz" "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz"
  echo "$SHA256  $tmp/sparkle.tar.xz" | shasum -a 256 -c -
  rm -rf vendor/sparkle && mkdir -p vendor/sparkle
  tar -xf "$tmp/sparkle.tar.xz" -C vendor/sparkle
  echo "$VERSION" > vendor/sparkle/.version
  rm -rf "$tmp"
fi
codesign --verify --strict vendor/sparkle/Sparkle.framework

echo "== The Sparkle bridge"
NODE_INCLUDE="$(dirname "$(dirname "$(command -v node)")")/include/node"
[ -f "$NODE_INCLUDE/node_api.h" ] || { echo "No node_api.h in $NODE_INCLUDE"; exit 1; }
xcrun clang++ -std=c++17 -ObjC++ -fobjc-arc -O2 -shared \
  -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 \
  -DNODE_GYP_MODULE_NAME=sparkle -I"$NODE_INCLUDE" \
  -undefined dynamic_lookup -framework Cocoa \
  -o native/sparkle/sparkle.node native/sparkle/sparkle.mm
codesign --force --sign - native/sparkle/sparkle.node
lipo -archs native/sparkle/sparkle.node
