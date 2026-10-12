import type { EasingPreset } from './easings-dev-presets'

/**
 * User-saved easing presets, persisted globally in localStorage so a curve the
 * user tweaks in one project is available in every project. Shape mirrors the
 * built-in {@link EasingPreset} catalog so both render through the same grid.
 */
const STORAGE_KEY = 'freecut-easing-presets'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasNumericFields(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return fields.every((field) => isFiniteNumber(record[field]))
}

function isValidPreset(value: unknown): value is EasingPreset {
  if (!value || typeof value !== 'object') return false
  const preset = value as Record<string, unknown>
  if (typeof preset.name !== 'string') return false
  if (preset.type === 'Easing') return hasNumericFields(preset.bezier, ['x1', 'y1', 'x2', 'y2'])
  if (preset.type === 'Spring')
    return hasNumericFields(preset.spring, ['tension', 'friction', 'mass'])
  return false
}

export function loadCustomPresets(): EasingPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidPreset) : []
  } catch {
    return []
  }
}

export function saveCustomPresets(presets: EasingPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // ignore localStorage write errors (quota / private mode)
  }
}
