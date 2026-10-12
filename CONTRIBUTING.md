# Contributing to 8-bit Voice

Thank you for being here. 8-bit Voice is a small, free tool, and it gets better every time someone tells us what broke, what's missing or what made them laugh. You don't need to be a programmer to help, and there are no silly questions.

## Ways to help

- **Tell us something's wrong.** [Open an issue](https://github.com/bomkino/8bit-Voice/issues/new/choose) with what you did, what you expected and what happened. Say which device and browser (or which app) you were on. A screenshot or a short clip helps a lot.
- **Ask for something.** New voices, characters, parts for the character creator, languages, export sizes: open an idea issue and tell us what you'd make with it.
- **Draw.** The faces are 16 × 16 pixels, and each part of the character creator is a few rows of letters in `chipvoice.js`. New hair, headwear, glasses, clothes and skin tones are very welcome, especially ones you don't see in games often enough.
- **Fix or build something.** Small pull requests are easiest to review. For anything bigger, open an issue first so we can figure it out together.
- **Translate, test on your phone, improve the docs.** All of it counts.

## Running it

You need [Node.js](https://nodejs.org) 18 or later. Nothing else to install for the web app:

```sh
npm test      # the engine's tests
npm start     # the web app at http://localhost:8080
```

The desktop app lives in `desktop/` (`npm ci`, then `npm start`). The README's "Working on it" section has the rest.

## How the code is laid out

- `chipvoice.js` is the engine: the voices, the cast's faces, the character creator's parts, the pixel font and the dialogue box. It has no dependencies and runs in browsers and in Node.
- `index.html` is the whole web app, and the desktop apps load the same page.
- `cli.mjs` is the command-line tool.
- `test/` has the engine's tests. Please add one when you change how something sounds or looks.

## A few promises we keep

- **It's a commons.** Free for everyone, with no accounts, ads, tracking or paywalls. Everything runs on the device, and nothing is sent anywhere. Please don't add anything that changes that.
- **Everyone belongs in it.** Characters, examples and copy are a real mix of people: women, men, nonbinary and trans people, a wide range of skin tones, hair and features, people with disabilities, all ages. Nobody is a man by default, voice pitch isn't tied to gender, and no group is a punchline.
- **It's original.** Only add art, sounds or code you made yourself or that comes with a licence compatible with MIT (MIT, BSD, Apache 2.0, ISC, CC0, or CC BY with the credit added to `THIRD-PARTY-NOTICES.md`). No samples of real voices, and no art traced from games.
- **It's accessible.** Buttons have labels, everything works with a keyboard, motion respects "reduce motion", and text has enough contrast.

## Pull requests

1. Fork the repo and make a branch.
2. Make your change, and run `npm test`.
3. Open a pull request saying what changed and how you checked it. Screenshots or a short recording are great for anything you can see or hear.

Everyone who contributes gets credited in the release notes. By contributing, you agree your work is released under the [MIT License](LICENSE), like the rest of the project.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md). In short: be kind, assume good faith, and make room for people.
