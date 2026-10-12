import 'i18next'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    // Resources are intentionally left untyped: locale data is assembled at
    // runtime from `en.json` plus per-feature partial files (see `src/i18n`),
    // so a static key union would be incomplete during the incremental
    // migration. `t()` therefore accepts any key string and returns `string`.
    returnNull: false
  }
}
