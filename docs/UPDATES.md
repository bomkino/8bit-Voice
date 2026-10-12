# In-app updates (Mac)

The Mac app updates itself from this repository's GitHub releases through [Sparkle](https://sparkle-project.org) 2.10.0, the same way pitch.dog's OOO, Backdrop, Deck Beat, Drift and Galileo do. Windows and Linux users download new versions from the [releases page](https://github.com/bomkino/8bit-Voice/releases/latest) (**Help › Check for a New Version** opens it).

No Apple Developer account is involved. The app is signed ad hoc. Updates are trusted because each one carries an EdDSA signature that only pitch.dog's private key can make, and the app has the matching public key built in.

## How it works

1. Each release carries, per Mac architecture, `BleepBloop-mac-<arch>.dmg` (for people), `BleepBloop-mac-<arch>.zip` (for the updater) and `appcast-<arch>.xml` (the feed), where `<arch>` is `arm64` or `x64`.
2. The app's `Info.plist` names its feed, `https://github.com/bomkino/8bit-Voice/releases/latest/download/appcast-<arch>.xml`. GitHub redirects that to the feed of the release marked **Latest**, so Apple silicon and Intel copies each get their own build.
3. Once a day, and whenever someone chooses **BleepBloop › Check for Updates…**, Sparkle reads the feed. If it lists a newer version, it shows the release notes and an Install button.
4. Sparkle downloads the ZIP, checks its signature against `SUPublicEDKey`, swaps the app in place and relaunches it. A ZIP that doesn't match is refused.

| | |
|---|---|
| Public key (`SUPublicEDKey`, set in `desktop/build/after-pack.cjs`) | `P43E8I+FgVyAW3QkS4J9bnDRRhAnsS4y3dT2WDce1lQ=` |
| Private key, for CI | The `SPARKLE_PRIVATE_KEY` secret of this repository's `release` environment, which only `main` may use |
| Private key, on the release Mac | `~/Library/Application Support/pitch.dog/Release Keys/sparkle-ed25519-private.key` |

**Never commit the private key, paste it into chat, or print it.** It is only ever used through Sparkle's `--ed-key-file`, by `desktop/build/sign-update.sh`.

### Turning on signing, once

On the Mac that holds the key, with the GitHub CLI signed in:

```sh
git clone https://github.com/bomkino/8bit-Voice && cd 8bit-Voice
bash scripts/auto-signing-setup.sh
```

It creates the `release` environment (open to `main` only) and stores the key in it. Nothing else is needed. To stop CI signing, delete the secret in **Settings › Environments › release**.

## How the app is put together

Electron has no updater of its own on the Mac that works without an Apple certificate, so the app carries Sparkle itself:

- `desktop/build/sparkle.sh` downloads Sparkle 2.10.0 (checked against its SHA-256) into `desktop/vendor/sparkle`, and compiles `desktop/native/sparkle/sparkle.mm`, a small N-API bridge, into one `sparkle.node` for both architectures.
- `desktop/build/after-pack.cjs` writes the feed and the key into `Info.plist`, puts the bridge in `Contents/Resources`, signs the app ad hoc, copies `Sparkle.framework` in with `ditto` (keeping its makers' signature), and signs the outer app again without `--deep`.
- `desktop/main.js` loads the bridge on a packaged Mac build, starts the updater and adds **Check for Updates…** to the app menu.

## Making a release

1. On `main`, raise `version` in `desktop/package.json` (always upwards) and give it a section in `CHANGELOG.md`: its first paragraph is the headline, the rest is what's new.
2. Push. The **Build** workflow tests everything, builds every app, runs the update test below, and then, because that version isn't out yet, publishes `vx.y.z`, marked Latest, with every installer, the signed feeds, `SHA256SUMS.txt` and the notes. It waits until `releases/latest/download/appcast-<arch>.xml` names the new version.

Signing checks the signature with the public key inside the app before anything is published, so a wrong key stops the release there.

Things that break updates:

- **The feeds must be called exactly `appcast-arm64.xml` and `appcast-x64.xml`**, and the release must be the **Latest** one (drafts and pre-releases don't count).
- **Versions only go up.** Sparkle compares `CFBundleVersion`, which is the version in `desktop/package.json`.
- Don't delete the newest release, or its feeds.

## 1.1.0, the first release with updates

Nothing can update *to* a first release, so if the key isn't set up yet, 1.1.0's feeds only name 1.1.0, with no signature: Sparkle reads them, finds nothing newer and downloads nothing. Every later release needs the key, and the workflow stops with a clear message if it's missing.

## The new name

Until 1.2 the app was called 8-bit Voice. The bundle identifier (`dog.pitch.8bitvoice`), the feed address and this repository's name are unchanged, so Mac copies of 1.1 find 1.2 as usual. Sparkle recognises the renamed app by its bundle identifier and installs it in place, so an updated copy keeps its old file name, `8-bit Voice.app`, until someone renames it. That's harmless, and later updates work either way. The desktop apps also keep their data in the old `8-bit Voice` folder, so nobody loses their lines, characters or recordings.

## Testing

`desktop/build/test-update.sh` runs in CI on every change. It makes a throwaway key, builds test copies at 9.0.0 (`8-bit Voice Update Test`) and 9.0.1 (`BleepBloop Update Test`) with their own bundle identifier (`dog.pitch.8bitvoice.updatetest`) that trust only that key, signs 9.0.1 with `sign-update.sh` and serves it from a local feed. It passes when 9.0.0 installs 9.0.1 under its new name, 9.0.1 starts as a new process and is still running three seconds later, and a ZIP with one changed byte is fetched and refused.

The test hooks are environment variables read only at launch: `STUDIO_UPDATE_TEST` (check now and install as soon as an update is ready) and `STUDIO_UPDATE_FEED` (use another feed). A relaunch doesn't keep the environment, so the new version reads `UpdateTestReadyFile` from its defaults instead and writes its version and process number there a second after it starts. A feed can't install anything unless it is signed with the key the app trusts.
