---
name: translate-app-locales
description: Add or audit full application translations across base locale files and partial i18n namespaces. Use when the user asks to add a new language, fix incomplete translations, remove English fallbacks, verify locale coverage, move language UI, or make future app sections translated in React/TypeScript apps with JSON locale files, especially FreeCut-style src/i18n/locales plus src/i18n/locales/partials structures.
---

# Translate App Locales

## Workflow

Use this skill for end-to-end language work, not just a single JSON file.

1. Locate the i18n entrypoint, supported language registry, base locale files, and partial namespace files.
2. Add the language to the registry and import/load it wherever base locales are wired.
3. Create the base locale JSON for the language.
4. Translate every partial namespace that has English keys, including catch-all or "missing" files.
5. Preserve the English key tree exactly for the target language.
6. Preserve interpolation tokens, ICU/plural suffixes, HTML tags, component placeholders, URLs, command names, and code identifiers.
7. Remove obsolete UI settings only when the user asked for product behavior changes, not as part of translation by default.
8. Validate JSON parsing, key coverage, and the app build or relevant tests.

## FreeCut Locale Map

For FreeCut-like repos, check all of these:

- `src/i18n/languages.ts`: `SUPPORTED_LANGUAGES`, direction, native name, English name.
- `src/i18n/index.ts`: base locale imports and `baseLocales`.
- `src/i18n/locales/<lang>.json`: base app shell/settings/common language strings.
- `src/i18n/locales/partials/*.json`: every namespace partial. Do not skip `missing.json`; it may contain active export/media/preview/timeline UI.
- Existing locale files: remove keys only when the source UI no longer uses them.

If the repo has a different structure, adapt the same rule: target language must cover every English leaf key that can be loaded by i18next or the app's locale loader.

## Translation Rules

- Translate user-facing prose naturally in the target language.
- Keep product names such as `FreeCut` unchanged unless the existing locale pattern translates them.
- Keep placeholders byte-for-byte: `{{count}}`, `{{name}}`, `<code>`, `<strong>`, `<link>`, `<accent>`, and similar markers.
- Keep plural variants as separate keys: `_one`, `_other`, etc.
- Keep technical acronyms when normal in the target language: FPS, GPU, URL, MP4, AAC.
- Prefer concise UI labels over literal long translations when button space is tight.
- For language toolbar chips, use two-letter uppercase base codes such as `EN`, `ZH`, `FR`, `TR` unless the product has a different standard.
- Preserve valid UTF-8. Non-ASCII is expected in translated locale files.

## Coverage Validation

Use the bundled script after editing locale files:

```bash
node <skill>/scripts/check-locale-coverage.mjs --locales src/i18n/locales --partials src/i18n/locales/partials --source en --target tr
```

The script verifies:

- JSON parses for base and partial locale files.
- The target base locale has all source base leaf keys.
- Each partial's target language has every source language leaf key.

If the project has no partial directory, omit `--partials`.

## Verification

Run the repo's fastest meaningful checks:

- Locale coverage script for the target language.
- JSON parse validation if the project has custom locale loading.
- Focused tests for settings/language persistence when language controls changed.
- Build/typecheck when translations touch app wiring or TypeScript imports.

Report unrelated failures clearly and do not hide them as translation failures.
