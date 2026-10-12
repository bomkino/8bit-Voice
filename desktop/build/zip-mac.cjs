// Zips each built .app with its symlinks intact. electron-builder's own zip
// copies them as files when it runs off a Mac, which breaks the frameworks
// and their signatures, so dist:mac builds the app folder and zips it here.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const dist = path.join(__dirname, '..', 'dist');
for (const [dir, arch] of [['mac-arm64', 'arm64'], ['mac', 'x64']]) {
  const app = path.join(dist, dir, `${pkg.build.productName}.app`);
  if (!fs.existsSync(app)) continue;
  const out = path.join(dist, `BleepBloop-mac-${arch}.zip`);
  fs.rmSync(out, { force: true });
  if (process.platform === 'darwin') {
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, out]);
  } else {
    execFileSync('zip', ['-qry', out, path.basename(app)], { cwd: path.dirname(app) });
  }
  console.log(`  • zipped  file=${path.relative(process.cwd(), out)}`);
}
