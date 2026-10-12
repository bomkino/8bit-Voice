// Runs after electron-builder lays out the app, before it signs and archives it.
//
// Linux: start through a small launcher that turns Chromium's sandbox off only
// where it can't work. The sandbox needs a setuid chrome-sandbox or unprivileged
// user namespaces, which Ubuntu 23.10 and later restrict unless an AppArmor
// profile allows them (the .deb installs one, build/apparmor-profile.tpl). An
// AppImage there would otherwise refuse to open. The app only ever loads its
// own bundled page.
//
// macOS, when building on another system: give the app an ad-hoc signature with
// rcodesign (set RCODESIGN to its path), since Apple Silicon won't run unsigned
// code. On a Mac, electron-builder signs it ad hoc itself (mac.identity "-").
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

  if (electronPlatformName === 'darwin' && process.platform !== 'darwin') {
    const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    const rcodesign = process.env.RCODESIGN || 'rcodesign';
    try {
      execFileSync(rcodesign, ['sign', appPath], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (err) {
      throw new Error(`Ad-hoc signing the macOS app needs rcodesign (set RCODESIGN to its path): ${err.message}`);
    }
  }
};
