# Translating

The overlays, the OBS dock and the studio speak Turkish, English, Spanish, Portuguese (Brazil), German and Arabic. Every text lives in a plain JSON file, so you can translate with any editor or translation platform.

## Where the texts are

| File | What it holds |
| --- | --- |
| `i18n/overlay/<code>.json` | Texts on stream: bar labels, alerts, chat, events, leaderboards, and the OBS dock. |
| `i18n/studio/<code>.json` | The studio: `ui` holds the interface texts, `labels` the names of each setting's choices. |

English (`en.json`) is the reference: every language has the same keys. The pages read the generated scripts in `shared/lang/`, because OBS loads them from `file://`, where JSON cannot be fetched. Never edit those scripts; edit the JSON and run:

```bash
npm run build:lang
```

## Rules for a text

- Keep every `{slot}` (`{n}`, `{name}`, `{latest}` …). The page puts a number or a name there.
- Plural texts are objects keyed by `Intl.PluralRules` category: `one` and `other` in English, and `zero`, `two`, `few`, `many` where your language has them. A language without plural forms, such as Turkish, may use one plain text instead.
- Keep names as they are: Kick, OBS, Kicks, setting names such as `kanal` and file names such as `AYARLAR.js`.
- Overlay texts sit on a stream: keep them short, because a bar has room for a few words.

## Checking your work

```bash
npm run i18n:status            # per language: missing, untranslated and slot problems
npm run i18n:status -- --verbose   # the same, with the keys
npm test                       # fails on a missing key or slot
```

`i18n:status` counts a text that is still the English one as untranslated when it is a phrase; names that stay the same, such as "Kick Overlay Studio", may show up there and are fine.

To see the result, open `studio.html`, switch the interface language, and pick your language under **Label language** to see the overlays. `node tools/visual-qa.js --out <dir> --only lang --gate` checks that the texts fit and stay readable.

## A new language

1. Copy `i18n/overlay/en.json` and `i18n/studio/en.json` to your language code (for example `fr.json`) and translate the values.
2. Run `npm run build:lang`.
3. The code also has to be added in a few places in the code (the `dil` setting, number formats, script tags and the studio's language buttons). [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language) lists them. If you only want to translate, open a pull request with the two JSON files and say so: a maintainer adds the rest.

## Translation platforms

The files are nested JSON with English as the template, which Weblate, Crowdin, Tolgee and similar tools read as they are. Plural categories that English does not have (`zero`, `two`, `few`, `many`) are not in the template, so for languages that need them, add those in the file itself.

## Reviews

Every language is reviewed against English before a release: meaning, grammar, plural forms, `{slots}`, consistent terms, and whether an overlay text fits its bar. A native speaker who spots something odd is the best review there is: open an issue or a pull request with the key and a better text.
