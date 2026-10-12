// Runs after electron-builder lays out the app, before it signs and archives it.
//
// Linux: start through a small launcher that turns Chromium's sandbox off only
// where it can't work. The sandbox needs a setuid chrome-sandbox or unprivileged
// user namespaces, which Ubuntu 23.10 and later restrict unless an AppArmor
// profile allows them (the .deb installs one, build/apparmor-profile.tpl). An
// AppImage there would otherwise refuse to open. The app only ever loads its
// own bundled page.
//
// macOS: add Sparkle, the updater pitch.dog's other Mac apps use, then give
// the app an ad-hoc signature, since Apple silicon won't run unsigned code.
// There are no certificates: updates are trusted by their EdDSA signature
// against SUPublicEDKey, not by Apple (docs/UPDATES.md). The order matters:
//   1. Info.plist names the feed for this architecture and the public key;
//   2. the bridge (native/sparkle/sparkle.node) goes into Resources;
//   3. the app is signed ad hoc, deep;
//   4. Sparkle.framework is copied in with ditto, keeping its makers' signature;
//   5. the outer app is signed again, not deep, sealing Sparkle as it is.
// build/sparkle.sh fetches Sparkle and builds the bridge; without them the
// app is built without updates (REQUIRE_SPARKLE=1 makes that an error).
// Off a Mac, there's no Sparkle, and rcodesign (set RCODESIGN to its path)
// signs the app.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');

const LAUNCHER = (bin, exe, optDir) => `#!/bin/sh
here=$(dirname "$(readlink -f "$0")")
sandbox_ok() {
  [ -u "$here/chrome-sandbox" ] && [ "$(stat -c %u "$here/chrome-sandbox" 2>/dev/null)" = 0 ] && return 0
  [ "$here" = "${optDir}" ] && [ -e "/etc/apparmor.d/${exe}" ] && return 0
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && return 1
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] && return 1
  return 0
}
if [ "$(id -u)" = 0 ] || ! sandbox_ok; then
  exec "$here/${bin}" --no-sandbox "$@"
fi
exec "$here/${bin}" "$@"
`;

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName === 'linux') {
    const exe = packager.executableName;
    const real = `${exe}.bin`;
    fs.renameSync(path.join(appOutDir, exe), path.join(appOutDir, real));
    fs.writeFileSync(path.join(appOutDir, exe), LAUNCHER(real, exe, `/opt/${packager.appInfo.sanitizedProductName}`), { mode: 0o755 });
    return;
  }

  if (electronPlatformName === 'darwin') {
    const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    if (process.platform === 'darwin') return signMac(appPath, Arch[context.arch]);
    const rcodesign = process.env.RCODESIGN || 'rcodesign';
    try {
      execFileSync(rcodesign, ['sign', appPath], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (err) {
      throw new Error(`Ad-hoc signing the macOS app needs rcodesign (set RCODESIGN to its path): ${err.message}`);
    }
  }
};

const FEED = 'https://github.com/bomkino/8bit-Voice/releases/latest/download';
// pitch.dog's update key, the same one OOO, Backdrop, Deck Beat, Drift and
// Galileo trust. Only its public half is here.
const PUBLIC_KEY = 'P43E8I+FgVyAW3QkS4J9bnDRRhAnsS4y3dT2WDce1lQ=';

function signMac(appPath, arch) {
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
  const root = path.join(__dirname, '..');
  const framework = path.join(root, 'vendor', 'sparkle', 'Sparkle.framework');
  const bridge = path.join(root, 'native', 'sparkle', 'sparkle.node');
  const sparkle = fs.existsSync(framework) && fs.existsSync(bridge);
  if (!sparkle) {
    const why = 'Sparkle or its bridge is missing (run build/sparkle.sh)';
    if (process.env.REQUIRE_SPARKLE === '1') throw new Error(why);
    console.warn(`  • ${why}: building without in-app updates`);
  }

  if (sparkle) {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    for (const [key, type, value] of [
      ['SUFeedURL', 'string', `${FEED}/appcast-${arch}.xml`],
      ['SUPublicEDKey', 'string', process.env.SPARKLE_PUBLIC_KEY_OVERRIDE || PUBLIC_KEY],
      ['SUEnableAutomaticChecks', 'bool', 'true'],
    ]) {
      try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' }); } catch {}
      run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist]);
    }
    fs.copyFileSync(bridge, path.join(appPath, 'Contents', 'Resources', 'sparkle.node'));
  }

  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  if (!sparkle) return;
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  run('ditto', [framework, path.join(frameworks, 'Sparkle.framework')]);
  run('codesign', ['--force', '--sign', '-', appPath]);
}
