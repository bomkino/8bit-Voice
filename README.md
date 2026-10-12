# BleepBloop

Make anything talk like a video game. Type a line, or say it, pick a character, and hear it in a retro game voice with a talking dialogue box. Then save it as a video for Reels, TikTok, Shorts or YouTube.

**[Open it in your browser](https://bomkino.github.io/8bit-Voice/)** · **[Download the app](https://github.com/bomkino/8bit-Voice/releases/latest)**

![BleepBloop](icons/social.png)

BleepBloop used to be called 8-bit Voice. Old links still work, and the Mac app updates itself to the new name. It's free and open source, made by [pitch.dog](https://pitch.dog) and anyone who'd like to join in. There are no accounts, ads or tracking. Everything happens on your own device: every sound is made on the spot from chip-style oscillators, filters and noise, with no samples. That means there's nothing to license, and what you make is yours.

## Get it

| Where | How |
| --- | --- |
| iPhone and iPad | Open [the web app](https://bomkino.github.io/8bit-Voice/) in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen and works offline. |
| Android | Open [the web app](https://bomkino.github.io/8bit-Voice/) in Chrome and tap **Install** (or **Add to Home screen** in the menu). |
| Mac with Apple silicon | [`BleepBloop-mac-arm64.dmg`](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-mac-arm64.dmg) |
| Mac with an Intel chip | [`BleepBloop-mac-x64.dmg`](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-mac-x64.dmg) |
| Windows 10 or 11 | [`BleepBloop-windows-x64-setup.exe`](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-windows-x64-setup.exe) ([Arm](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-windows-arm64-setup.exe)) |
| Linux, any distro | [`BleepBloop-linux-x86_64.AppImage`](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-linux-x86_64.AppImage) ([Arm](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-linux-arm64.AppImage)) |
| Debian and Ubuntu | [`BleepBloop-linux-amd64.deb`](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-linux-amd64.deb) ([Arm](https://github.com/bomkino/8bit-Voice/releases/latest/download/BleepBloop-linux-arm64.deb)) |

The Mac, Windows and Linux apps are the same tool in its own window, with menus and save dialogs.

### Opening it the first time

The apps aren't signed with an Apple or Microsoft developer certificate, so each system asks once before it opens one.

- **macOS (12 or later).** Open the .dmg and drag BleepBloop to Applications. The first time you open it, macOS says it can't verify the app: click **Done**. Then go to **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to BleepBloop. After that it opens normally. In Terminal, `xattr -dr com.apple.quarantine "/Applications/BleepBloop.app"` does the same thing. From then on the app updates itself (**BleepBloop › Check for Updates…**): [docs/UPDATES.md](docs/UPDATES.md).
- **Windows.** If SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. The installer puts BleepBloop in your Start menu. No admin rights are needed.
- **Linux.** For the AppImage, run `chmod +x BleepBloop-linux-x86_64.AppImage` and open it. Some distros need `libfuse2` first. For the .deb, run `sudo apt install ./BleepBloop-linux-amd64.deb`, then find it in your app menu.

`SHA256SUMS.txt` on each release has a checksum for every file.

## Using it

1. **Pick a character.** Fourteen of them, each with a face and a voice: a hero, a narrator whose voice is almost human, a henchling who sings everything, a wizard, a villain, a sidekick, a secret agent, a ship's computer, a robot, a fairy, a ghost, a stone golem, a guard and a villager. **Surprise me** picks one at random.
2. **Or make your own.** Choose skin, face shape, hair and its colour, headwear (hijab, headwrap, turban, durag, cap, crown and more), eyes, brows, mouth, lips, cheeks, facial hair, glasses, earrings, a pin, clothes, a backdrop and the light. **Randomize** rolls a whole new person; lock the parts you love first. Each part also has its own shuffle, and **Undo** steps back. Give them a name and a voice, and save them as a picture if you like. They're kept on your device and travel with shared links.
3. **Type what they say,** one line per clip, or start from a scene. Stage directions go in brackets: `(slow, awed) ...That's the future.`
4. **Or use your voice.** Record a line, or open a recording, and your character says it back in their own voice with your timing and your tune. The Narrator's machine keeps your words almost clear; the others turn them into game talk. Recordings never leave your device.
5. **Tune the voice:** pitch, speed, melody, the machine's own character knob and grit. **Speakerphone** puts it through a phone speaker, and **New take** gives a slightly different performance of the same settings.
6. **Save it.** A video for Reels, TikTok and Shorts (9:16), the Instagram feed (4:5), a square post (1:1) or YouTube (16:9), with the character talking above the box, all kept inside each app's safe area. Choose a colour, dark, green or clear background, the face and box or just the box, and one line or all of them. Or save WAVs: 48 kHz, 16-bit mono. On a phone, saving opens the share sheet.

Space plays and stops, and Ctrl Enter (⌘ Return on a Mac) plays the line you're typing. **Copy a link** gives you a link that opens your lines, voice and character on any device, and tells no server anything.

### Delivery

Stage directions go in brackets before the line, and they combine: `(slow, awed) ...That's the future.` "Very" pushes one further: `(panicking, very fast and very high)`. The delivery buttons add and remove them for you.

whisper · quiet · shouting · slow · fast · faster and faster · high · low · flat · excited · awed · sad · offended · panicking

Punctuation does the rest. A question rises, a full stop falls, an ellipsis trails off, a dash cuts the line off mid-syllable, and capitals are louder. `(speakerphone)` puts one line on the phone. `WIZARD:` in front of a line puts a name on it.

### Machines

| Machine | Sounds like | Character knob |
| --- | --- | --- |
| Square | NES square wave | Bite: pure blips to hissy consonants |
| Pocket | Game Boy wave channel | Nasal: round to pinched |
| Babble | Cozy village chatter | Squeak: big animal to tiny one |
| Typewriter | RPG text blips | Click: soft boop to sharp tick |
| Boss | Final-boss voice | Menace: stern to demon with reverb |
| Speech chip | 80s arcade speech chip | Buzz: clean robot to cheap toy |
| Mouth | 80s home-computer speech | Clarity: happy gibberish to almost words |

### The dialogue box

The box shows the line in pixel capitals, typing along with the voice. **Runes** swaps the words for a made-up alphabet where each letter always gets the same glyph, so it reads like a real language nobody speaks.

## Command line

The same engine runs in Node 18 or later, with nothing to install:

```sh
node cli.mjs "(offended) You said WHAT about my hat?" --voice wizard --out hat.wav
node cli.mjs --file lines.txt --voice narrator --dir clips --speaker Narrator
node cli.mjs --in me.wav --voice robot --out robot.wav
node cli.mjs --file lines.txt --compare --dir compare --lineup compare/all.wav
node cli.mjs --list
```

`--in` says a recording again in the voice instead of speaking a line: a 16-bit, 24-bit or float WAV, mono or stereo. Every knob works on it, and a line given with it is what the dialogue box types and `--json` lists.

`--json` writes each clip's timing next to its WAV: every syllable's start, length and pitch, and the characters it voices, for syncing animation to it. The app's **Make it from the command line** panel gives you the exact command for the line and voice on screen. `node stings.mjs` makes the little game-over sting.

## In your own code

`chipvoice.js` has no dependencies. It works as a `<script>` (as `window.ChipVoice`), with `require()`, and in a bundler, and `chipvoice.d.ts` types it.

```js
const fs = require('node:fs');
const CV = require('./chipvoice.js');

// a line, in a character's voice
const clip = CV.render('(excited) We found the treasure!', CV.normVoice('hero'));
fs.writeFileSync('treasure.wav', CV.encodeWav(clip.samples, clip.sampleRate));

// a character from parts, by name, index or share code, and a random one
const face = CV.buildFace({ skin: 'Umber', hair: 'Locs', hairColor: 'Black', cover: 'Headphones', pin: 'Trans' });
const someone = CV.buildFace(CV.randomLook('any seed'));
CV.drawFace(canvas.getContext('2d'), face, 0, 0, { open: 0.6 });
```

`drawDialog` draws the talking box, with a portrait of any face, and `revealTimes` and `talkLevel` time the typing and the mouth to the voice.

A recording works the same way. `analyzeRecording` takes mono samples at any rate and listens once; `renderRecording` says it again in any voice and returns the same shape as `render`. The Mouth keeps the words, with Clarity running from almost clear down to cheerful gibberish. Every other machine turns the person's syllables, rhythm and melody into its own blips.

```js
const rec = CV.analyzeRecording(samples, 44100);
const robot = CV.renderRecording(rec, 'robot', { text: 'What I said, for the dialogue box' });
```

## Working on it

```sh
npm test                 # the engine's tests
npm start                # the web app at http://localhost:8080

cd desktop
npm ci
npm start                # the desktop app, from source
npm run dist:mac         # .dmg and .zip, Apple silicon and Intel, with Sparkle (on a Mac)
npm run test:update      # proves a Mac copy updates itself (on a Mac, after dist:mac)
npm run dist:win         # installers for x64 and Arm (on Windows)
npm run dist:linux       # AppImage and .deb, x64 and Arm
```

Building the Mac app off a Mac needs [rcodesign](https://github.com/indygreg/apple-platform-rs) for its ad-hoc signature, because Apple silicon won't run unsigned code: `RCODESIGN=/path/to/rcodesign npm run dist:mac-off-mac`.

- `chipvoice.js` is the engine: the voices, the cast, the character creator's parts, the pixel font and the dialogue box.
- `index.html` is the whole web app. The desktop apps load the same page, so a change there reaches every platform.
- `sw.js` and `manifest.webmanifest` make it installable and offline. `vendor/` holds [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), which packs the videos.
- `desktop/` is the Electron wrapper. Its `build/make_icon.py` draws every icon and the disk image background, and `build/social.html` renders `icons/social.png`.
- `desktop/build/sparkle.sh`, `desktop/native/sparkle/` and `desktop/build/sign-update.sh` are the Mac app's updater: [docs/UPDATES.md](docs/UPDATES.md).
- `.github/workflows/build.yml` tests the engine, builds and opens the apps on macOS, Windows and Linux, and tests the Mac updater, for every pull request. On `main`, when `desktop/package.json` has a new version, it publishes them as a release with signed update feeds.
- `.github/workflows/pages.yml` puts the web app on GitHub Pages once the Build workflow on `main` has finished, so the site never links to a release that isn't out yet.

To ship a new version, raise `version` in `desktop/package.json` (and `APP_VERSION` in `index.html`, `VERSION` in `chipvoice.js`, the cache name in `sw.js` and `version` in `package.json` to match), add a section to `CHANGELOG.md`, then merge to `main`.

## Join in

Bug reports, ideas, new parts for the character creator, translations and fixes are all welcome, and you don't need to be a programmer to help. [CONTRIBUTING.md](CONTRIBUTING.md) explains how, and the [Code of Conduct](CODE_OF_CONDUCT.md) says how we treat each other. Security problems go to [SECURITY.md](SECURITY.md).

The character creator learned from open-source avatar makers that came before it; [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) credits them and everything else BleepBloop uses.

## License

The code and art are under the [MIT License](LICENSE). The fonts in `fonts/` are pitch.dog's PD Body and PD Eyebrow, dedicated to the public domain under [CC0](fonts/LICENSE.md). The pitch.dog name and marks aren't covered by either license.
