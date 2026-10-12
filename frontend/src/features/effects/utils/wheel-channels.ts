/**
 * Conversions between a color wheel's hue/amount parameterization and the
 * Resolve-style per-channel R/G/B readout shown under each wheel.
 *
 * The gpu-color-wheels shader recolors via `multiplier_c = 1 + amount *
 * (tint_c - 1)` with `tint = hsv(hue, 1, 1)`, i.e. a per-channel deviation
 * `d_c = amount * (tint_c - 1)` whose maximum is always 0. The chips show
 * that deviation mean-centered, so the dominant channel reads positive the
 * way colorists expect. The mapping round-trips exactly: subtracting the
 * max recovers `d`, since max(d) = 0 implies max(centered) = -mean(d).
 */

export type WheelChannels = [number, number, number]

function wheelHueToTint(hue: number): WheelChannels {
  const h = (((hue % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  if (h < 1) return [1, x, 0]
  if (h < 2) return [x, 1, 0]
  if (h < 3) return [0, 1, x]
  if (h < 4) return [0, x, 1]
  if (h < 5) return [x, 0, 1]
  return [1, 0, x]
}

export function wheelChannelsFromHueAmount(hue: number, amount: number): WheelChannels {
  const tint = wheelHueToTint(hue)
  const deviations = tint.map((channel) => amount * (channel - 1)) as WheelChannels
  const mean = (deviations[0] + deviations[1] + deviations[2]) / 3
  // `+ 0` normalizes -0 from the amount * (tint - 1) product
  return deviations.map((deviation) => deviation - mean + 0) as WheelChannels
}

/**
 * Projects arbitrary channel values back onto the wheel's reachable states:
 * any uniform component is discarded (that is the master's job) and the
 * remaining color deviation becomes hue + amount.
 */
export function hueAmountFromWheelChannels(channels: WheelChannels): {
  hue: number
  amount: number
} {
  const max = Math.max(channels[0], channels[1], channels[2])
  const [r, g, b] = channels.map((channel) => channel - max) as WheelChannels
  const amount = -Math.min(r, g, b)
  if (amount < 1e-4) return { hue: 0, amount: 0 }

  // Recover the saturated tint color (max channel 1, min channel 0).
  const tr = 1 + r / amount
  const tg = 1 + g / amount
  const tb = 1 + b / amount
  let hue: number
  if (tr >= tg && tr >= tb) {
    hue = ((tg - tb) % 6) * 60
  } else if (tg >= tr && tg >= tb) {
    hue = (tb - tr + 2) * 60
  } else {
    hue = (tr - tg + 4) * 60
  }
  if (hue < 0) hue += 360
  return { hue, amount: Math.min(1, amount) }
}
