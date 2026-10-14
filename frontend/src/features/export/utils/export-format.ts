/**
 * Display formatting for the export surfaces, in the window's language: seconds to a compact runtime, bytes to
 * a compact size, bits per second to a bitrate.
 */

function unit(language: string, name: string, value: number, digits = 0): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatTime(seconds: number, language: string): string {
  if (seconds < 60) return unit(language, 'second', Math.round(seconds))
  const minutes = Math.floor(seconds / 60)
  return `${unit(language, 'minute', minutes)} ${unit(language, 'second', Math.round(seconds % 60))}`
}

export function formatFileSize(bytes: number, language: string): string {
  if (bytes < 1024) return unit(language, 'byte', bytes)
  if (bytes < 1024 * 1024) return unit(language, 'kilobyte', bytes / 1024, 1)
  if (bytes >= 1024 * 1024 * 1024) return unit(language, 'gigabyte', bytes / (1024 * 1024 * 1024), 2)
  return unit(language, 'megabyte', bytes / (1024 * 1024), 2)
}

export function formatBitrate(bitsPerSecond: number, language: string): string {
  return unit(language, 'megabit-per-second', bitsPerSecond / 1_000_000, 2)
}

/** The bitrate unit alone, for a field that takes the number. */
export function bitrateUnit(language: string): string {
  return new Intl.NumberFormat(language, { style: 'unit', unit: 'megabit-per-second', unitDisplay: 'short' })
    .formatToParts(1)
    .filter((part) => part.type === 'unit')
    .map((part) => part.value)
    .join('')
}
