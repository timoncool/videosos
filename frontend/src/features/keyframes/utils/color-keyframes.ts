import type { Keyframe } from '@/types/keyframe'
import { applyEasing, applyEasingConfig } from './easing'

export const MIN_PACKED_RGB = 0

const MAX_LEGACY_PACKED_RGB = 0xffffff
const RGBA_PACKED_OFFSET = 0x100000000
const MAX_PACKED_RGBA = RGBA_PACKED_OFFSET + 0xffffffff

/** Maximum persisted color-keyframe value, including the versioned RGBA encoding. */
export const MAX_PACKED_RGB = MAX_PACKED_RGBA

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
  hasAlpha: boolean
}

interface OklchColor {
  l: number
  c: number
  h: number
}

const OKLCH_CACHE_LIMIT = 512
const oklchByPackedColor = new Map<number, OklchColor>()

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampChannel(value: number): number {
  return clamp(Math.round(value), 0, 255)
}

function normalizePackedColor(value: number): number {
  if (!Number.isFinite(value)) return MIN_PACKED_RGB
  const rounded = Math.round(value)
  if (rounded <= MAX_LEGACY_PACKED_RGB) {
    return clamp(rounded, MIN_PACKED_RGB, MAX_LEGACY_PACKED_RGB)
  }
  if (rounded < RGBA_PACKED_OFFSET) return MAX_LEGACY_PACKED_RGB
  return clamp(rounded, RGBA_PACKED_OFFSET, MAX_PACKED_RGBA)
}

function rgbaToPacked({ r, g, b, a, hasAlpha }: RgbaColor): number {
  const red = clampChannel(r)
  const green = clampChannel(g)
  const blue = clampChannel(b)
  if (!hasAlpha) return red * 0x10000 + green * 0x100 + blue

  const alpha = clampChannel(a)
  return RGBA_PACKED_OFFSET + red * 0x1000000 + green * 0x10000 + blue * 0x100 + alpha
}

function packedToRgba(value: number): RgbaColor {
  const packed = normalizePackedColor(value)
  if (packed >= RGBA_PACKED_OFFSET) {
    const rgba = packed - RGBA_PACKED_OFFSET
    return {
      r: Math.floor(rgba / 0x1000000) & 0xff,
      g: Math.floor(rgba / 0x10000) & 0xff,
      b: Math.floor(rgba / 0x100) & 0xff,
      a: rgba & 0xff,
      hasAlpha: true,
    }
  }

  return {
    r: Math.floor(packed / 0x10000) & 0xff,
    g: Math.floor(packed / 0x100) & 0xff,
    b: packed & 0xff,
    a: 255,
    hasAlpha: false,
  }
}

function srgbChannelToLinear(channel: number): number {
  const value = clamp(channel / 255, 0, 1)
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearChannelToSrgb(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
  return clamp(value, 0, 1) * 255
}

function rgbaToOklch(color: RgbaColor): OklchColor {
  const red = srgbChannelToLinear(color.r)
  const green = srgbChannelToLinear(color.g)
  const blue = srgbChannelToLinear(color.b)

  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return {
    l: lightness,
    c: Math.hypot(a, b),
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  }
}

function packedToOklch(value: number): OklchColor {
  const packed = normalizePackedColor(value)
  const cached = oklchByPackedColor.get(packed)
  if (cached) return { ...cached }

  const converted = rgbaToOklch(packedToRgba(packed))
  if (oklchByPackedColor.size >= OKLCH_CACHE_LIMIT) {
    const oldestKey = oklchByPackedColor.keys().next().value
    if (oldestKey !== undefined) oklchByPackedColor.delete(oldestKey)
  }
  oklchByPackedColor.set(packed, converted)
  return { ...converted }
}

function oklchToRgb(color: OklchColor): Pick<RgbaColor, 'r' | 'g' | 'b'> {
  const hueRadians = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(hueRadians)
  const b = color.c * Math.sin(hueRadians)

  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3

  return {
    r: linearChannelToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearChannelToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearChannelToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim()
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed)
  if (!match) return null

  const hex = match[1]!
  if (hex.length === 3 || hex.length === 4) {
    return `#${hex
      .split('')
      .map((char) => char + char)
      .join('')
      .toLowerCase()}`
  }

  return `#${hex.toLowerCase()}`
}

export function colorStringToKeyframeValue(value: string): number | null {
  const normalized = normalizeHexColor(value)
  if (!normalized) return null
  const hex = normalized.slice(1)
  if (hex.length === 6) return Number.parseInt(hex, 16)
  return RGBA_PACKED_OFFSET + Number.parseInt(hex, 16)
}

export function keyframeValueToHexColor(value: number): string {
  const normalized = normalizePackedColor(value)
  if (normalized >= RGBA_PACKED_OFFSET) {
    return `#${(normalized - RGBA_PACKED_OFFSET).toString(16).padStart(8, '0')}`
  }
  return `#${normalized.toString(16).padStart(6, '0')}`
}

function interpolateOklch(prevValue: number, nextValue: number, progress: number): number {
  const prev = packedToRgba(prevValue)
  const next = packedToRgba(nextValue)
  const prevOklch = packedToOklch(prevValue)
  const nextOklch = packedToOklch(nextValue)

  // Hue is undefined for near-neutral colors. Borrow the chromatic endpoint's
  // hue so gray-to-color transitions do not spin through an arbitrary angle.
  if (prevOklch.c < 1e-7) prevOklch.h = nextOklch.h
  if (nextOklch.c < 1e-7) nextOklch.h = prevOklch.h

  const hueDelta = ((nextOklch.h - prevOklch.h + 540) % 360) - 180
  const interpolated = oklchToRgb({
    l: prevOklch.l + (nextOklch.l - prevOklch.l) * progress,
    c: prevOklch.c + (nextOklch.c - prevOklch.c) * progress,
    h: prevOklch.h + hueDelta * progress,
  })

  return rgbaToPacked({
    ...interpolated,
    a: prev.a + (next.a - prev.a) * progress,
    hasAlpha: prev.hasAlpha || next.hasAlpha,
  })
}

export function interpolateColorKeyframeValue(
  keyframes: Keyframe[],
  frame: number,
  baseValue: number,
): number {
  if (keyframes.length === 0) return normalizePackedColor(baseValue)

  const firstKf = keyframes[0]!
  if (keyframes.length === 1) return normalizePackedColor(firstKf.value)
  if (frame <= firstKf.frame) return normalizePackedColor(firstKf.value)

  const lastKf = keyframes[keyframes.length - 1]!
  if (frame >= lastKf.frame) return normalizePackedColor(lastKf.value)

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const prevKf = keyframes[i]!
    const nextKf = keyframes[i + 1]!
    if (prevKf.frame > frame || nextKf.frame <= frame) continue

    const frameRange = nextKf.frame - prevKf.frame
    if (frameRange <= 0) return normalizePackedColor(prevKf.value)

    const progress = (frame - prevKf.frame) / frameRange
    const easedProgress = prevKf.easingConfig
      ? applyEasingConfig(progress, prevKf.easingConfig)
      : applyEasing(progress, prevKf.easing)

    return interpolateOklch(prevKf.value, nextKf.value, easedProgress)
  }

  return normalizePackedColor(baseValue)
}

export function interpolateColorKeyframesToHex(
  keyframes: Keyframe[],
  frame: number,
  baseColor: string,
): string | null {
  const baseValue = colorStringToKeyframeValue(baseColor)
  if (baseValue === null) return null
  return keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, frame, baseValue))
}
