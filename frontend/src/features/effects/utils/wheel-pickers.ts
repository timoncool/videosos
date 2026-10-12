/**
 * Math for the Resolve-style primaries pickers: auto balance, white-balance
 * eyedropper, and black/white point pickers. Samples are post-grade screen
 * colors (EyeDropper API) or the rendered preview frame, and the solvers
 * compute the gpu-color-wheels params that neutralize the sample under the
 * shader model:
 *   temperature: r += (T/100)*0.1, b -= (T/100)*0.1
 *   tint:        g -= (Ti/100)*0.1, r += (Ti/100)*0.05, b += (Ti/100)*0.05
 *   lift:        c += lift   (additive)
 *   gain:        c *= gain   (multiplicative)
 * One-shot corrections on already-graded samples are approximations — same
 * as Resolve, picking twice converges.
 */

export interface PickedColor {
  r: number
  g: number
  b: number
}

const LIFT_MIN = -2
const LIFT_MAX = 2
const GAIN_MIN = 0
const GAIN_MAX = 16
const WB_LIMIT = 100

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

export function hexToRgb01(hex: string): PickedColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1] ?? '', 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

export function luma601({ r, g, b }: PickedColor): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Temp/tint that neutralize the picked color (r' = g' = b' under the shader
 * model), applied relative to the current values.
 */
export function whiteBalanceFromPick(
  picked: PickedColor,
  currentTemperature: number,
  currentTint: number,
): { temperature: number; tint: number } {
  // r' - b' = (r - b) + 0.2*tau = 0
  const tau = (picked.b - picked.r) / 0.2
  // g' = (r' + b')/2  =>  g - (r + b)/2 = 0.15*phi
  const phi = (picked.g - (picked.r + picked.b) / 2) / 0.15
  return {
    temperature: clamp(round4(currentTemperature + tau * 100), -WB_LIMIT, WB_LIMIT),
    tint: clamp(round4(currentTint + phi * 100), -WB_LIMIT, WB_LIMIT),
  }
}

/** Lift that maps the picked luma to black. */
export function blackPointFromPick(pickedLuma: number, currentLift: number): number {
  return clamp(round4(currentLift - pickedLuma), LIFT_MIN, LIFT_MAX)
}

/** Gain that maps the picked luma to white. */
export function whitePointFromPick(pickedLuma: number, currentGain: number): number {
  return clamp(round4(currentGain / Math.max(pickedLuma, 0.05)), GAIN_MIN, GAIN_MAX)
}

export interface AutoBalanceCurrent {
  lift: number
  gain: number
  temperature: number
  tint: number
}

/**
 * Frame-statistics auto balance: stretches the 1st/99th luma percentiles to
 * black/white and removes the average color cast via temp/tint.
 */
export function autoBalanceFromFrame(
  imageData: Pick<ImageData, 'data' | 'width' | 'height'>,
  current: AutoBalanceCurrent,
): { lift: number; gain: number; temperature: number; tint: number } {
  const { data } = imageData
  const pixelCount = Math.floor(data.length / 4)
  const lumas = new Float32Array(pixelCount)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let i = 0; i < pixelCount; i++) {
    const r = (data[i * 4] ?? 0) / 255
    const g = (data[i * 4 + 1] ?? 0) / 255
    const b = (data[i * 4 + 2] ?? 0) / 255
    lumas[i] = 0.299 * r + 0.587 * g + 0.114 * b
    sumR += r
    sumG += g
    sumB += b
  }
  if (pixelCount === 0) {
    return {
      lift: current.lift,
      gain: current.gain,
      temperature: current.temperature,
      tint: current.tint,
    }
  }

  const sorted = Array.from(lumas).sort((a, b) => a - b)
  const percentile = (p: number) =>
    sorted[clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1)] ?? 0
  const black = percentile(0.01)
  const white = percentile(0.99)

  const mean: PickedColor = { r: sumR / pixelCount, g: sumG / pixelCount, b: sumB / pixelCount }
  const wb = whiteBalanceFromPick(mean, current.temperature, current.tint)

  return {
    lift: clamp(round4(current.lift - black), LIFT_MIN, LIFT_MAX),
    gain: clamp(round4(current.gain / Math.max(white - black, 0.05)), GAIN_MIN, GAIN_MAX),
    temperature: wb.temperature,
    tint: wb.tint,
  }
}
