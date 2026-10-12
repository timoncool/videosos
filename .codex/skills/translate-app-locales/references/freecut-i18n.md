# FreeCut i18n Checklist

Use this reference when working in the FreeCut repo.

## Files

- `src/i18n/languages.ts`: add `AppLanguage` entry.
- `src/i18n/index.ts`: import the base locale JSON and add it to `baseLocales`.
- `src/i18n/locales/<lang>.json`: base strings.
- `src/i18n/locales/partials/editor.json`: editor shell and panels.
- `src/i18n/locales/partials/projects.json`: project list, landing, migration, settings, hotkeys.
- `src/i18n/locales/partials/missing.json`: active fallback strings for export, media, preview, and timeline.
- `src/i18n/locales/partials/effects.json`: effect names, parameters, panels.
- `src/i18n/locales/partials/keyframes.json`: keyframe editor.
- `src/i18n/locales/partials/remaining-ui.json`: remaining editor/media/AI/project UI.
- `src/i18n/locales/partials/timeline.json`: timeline track drag/drop labels.

## Commands

```bash
node C:/Users/walter/.codex/skills/translate-app-locales/scripts/check-locale-coverage.mjs --locales src/i18n/locales --partials src/i18n/locales/partials --source en --target tr
bun run build
```

Run targeted tests for any settings or toolbar behavior touched during the language work.
