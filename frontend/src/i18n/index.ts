import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { createLogger } from '@/shared/logging/logger'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, resolveSupportedLanguage } from './languages'
import en from './locales/en.json'

const log = createLogger('i18n')

export const I18N_STORAGE_KEY = 'freecut-language'

type LocaleTree = Record<string, unknown>

// English is the fallback language and must be available synchronously at
// module init. Every other base locale loads on demand in
// loadLanguageResources() — non-English users already await that before first
// render, so this only removes dead weight from the initial bundle.
const enBase: LocaleTree = en as LocaleTree

const lazyBaseLocaleModules = import.meta.glob<{ default: LocaleTree }>([
  './locales/*.json',
  '!./locales/en.json',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      deepMerge(existing, value)
    } else {
      target[key] = value
    }
  }
}

function normalizePartialSlice(path: string, slice: LocaleTree): LocaleTree {
  if (path.endsWith('/effects.json') && !isPlainObject(slice.effects)) {
    return { effects: slice }
  }

  return slice
}

// Eager: English partials only (statically imported, bundled into app-shell).
const enPartialModules = import.meta.glob<{ default: LocaleTree }>('./locales/partials/en/*.json', {
  eager: true,
})

// Lazy: non-English partial dirs — loaded on demand when switching language.
// English partials stay out: they are bundled eagerly above, and
// loadLanguageResources() early-returns for the default language anyway.
const lazyPartialModules = import.meta.glob<{ default: LocaleTree }>([
  './locales/partials/*/*.json',
  '!./locales/partials/en/*.json',
])

// Build the merged English tree eagerly.
const enMerged: LocaleTree = structuredClone(enBase)
for (const [path, mod] of Object.entries(enPartialModules).sort(([a], [b]) => a.localeCompare(b))) {
  deepMerge(enMerged, normalizePartialSlice(path, mod.default ?? {}))
}

// Only English ships in the initial resources: it is the fallback language,
// and every other language is added by loadLanguageResources() before the
// first render or on language switch.
const resources = {
  [DEFAULT_LANGUAGE]: {
    translation: enMerged,
  },
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
    load: 'currentOnly',
    interpolation: {
      // React already escapes values to prevent XSS.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: I18N_STORAGE_KEY,
      caches: ['localStorage'],
      convertDetectedLanguage: resolveSupportedLanguage,
    },
    returnEmptyString: false,
  })
  .catch((err) => {
    log.error('Failed to initialize i18n', err)
  })

function syncDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = resolveSupportedLanguage(lng)
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANGUAGE)
i18n.on('languageChanged', syncDocumentLanguage)

// Track which languages have been fully loaded (base locale + partials).
const loadedLanguages = new Set<string>([DEFAULT_LANGUAGE])

export async function loadLanguageResources(lang: string): Promise<void> {
  const resolved = resolveSupportedLanguage(lang)
  if (loadedLanguages.has(resolved)) return
  const baseLoader = lazyBaseLocaleModules[`./locales/${resolved}.json`]
  const tree: LocaleTree = baseLoader
    ? structuredClone((await baseLoader()).default ?? {})
    : {}
  const prefix = `./locales/partials/${resolved}/`
  const entries = Object.entries(lazyPartialModules)
    .filter(([path]) => path.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [path, loader] of entries) {
    const mod = await loader()
    deepMerge(tree, normalizePartialSlice(path, mod.default ?? {}))
  }
  i18n.addResourceBundle(resolved, 'translation', tree, false, true)
  loadedLanguages.add(resolved)
}

export async function changeAppLanguage(lang: string): Promise<void> {
  const resolved = resolveSupportedLanguage(lang)
  await loadLanguageResources(resolved)
  await i18n.changeLanguage(resolved)
}

// Preload the user's persisted/detected language before first render.
// Errors are caught so the app still renders with English fallback.
export const i18nReady: Promise<void> = (async () => {
  const persistedLanguage =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(I18N_STORAGE_KEY)
  const detectedLanguage = typeof navigator === 'undefined' ? DEFAULT_LANGUAGE : navigator.language
  const initial = resolveSupportedLanguage(
    persistedLanguage ?? detectedLanguage,
  )
  if (initial !== DEFAULT_LANGUAGE) await loadLanguageResources(initial)
})().catch((err) => {
  log.error('Failed to preload language resources', err)
})

export { i18n }
export default i18n
