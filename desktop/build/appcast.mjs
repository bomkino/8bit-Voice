// Small helpers for the update feed, in Node so they run anywhere:
//
//   node build/appcast.mjs keygen <private-key-file>
//       a throwaway EdDSA key for tests: writes the private half in Sparkle's
//       format (base64 of the 32-byte seed) and prints the public half.
//   node build/appcast.mjs verify <appcast.xml> <archive> <public-key>
//       checks the feed's signature of the archive with the public key, as
//       Sparkle will before it installs anything.
//   node build/appcast.mjs first <version> <download-url> <archive> <appcast.xml>
//       the feed of the first release with updates: it names that release
//       only, with no signature, so no copy is ever offered anything from it.
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
const fromUrl = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

if (cmd === 'keygen') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(args[0], fromUrl(privateKey.export({ format: 'jwk' }).d).toString('base64'), { mode: 0o600 });
  console.log(fromUrl(publicKey.export({ format: 'jwk' }).x).toString('base64'));
} else if (cmd === 'verify') {
  const [feed, archive, pub] = args;
  const xml = readFileSync(feed, 'utf8');
  const sig = xml.match(/sparkle:edSignature="([^"]+)"/)?.[1];
  if (!sig) throw new Error(`${feed} has no signature`);
  const length = Number(xml.match(/length="(\d+)"/)?.[1]);
  if (length !== statSync(archive).size) throw new Error(`${feed} gives a length of ${length}, not ${statSync(archive).size}`);
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub, 'base64').toString('base64url') }, format: 'jwk' });
  if (!verify(null, readFileSync(archive), key, Buffer.from(sig, 'base64'))) {
    throw new Error(`The signature in ${feed} doesn't match ${basename(archive)} for the key ${pub}`);
  }
  console.log(`${basename(feed)}: the signature of ${basename(archive)} checks out with ${pub}`);
} else if (cmd === 'first') {
  const [version, url, archive, out] = args;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  writeFileSync(out, `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>BleepBloop</title>
    <item>
      <title>${esc(version)}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <sparkle:version>${esc(version)}</sparkle:version>
      <sparkle:shortVersionString>${esc(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure url="${esc(url + basename(archive))}" length="${statSync(archive).size}" type="application/octet-stream"/>
    </item>
  </channel>
</rss>
`);
  console.log(`${basename(out)}: names ${version} only, unsigned (the first release with updates)`);
} else {
  console.error('usage: appcast.mjs keygen <file> | verify <appcast.xml> <archive> <public-key> | first <version> <url> <archive> <out>');
  process.exit(2);
}
