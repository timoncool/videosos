import { describe, expect, it } from 'vitest'
import { LoudnessMeter, PeakLimiter, normaliseMix, normalisingGain, truePeakAt } from './loudness'

const sine = (hz: number, dbfs: number, seconds: number, rate: number) => {
  const amplitude = 10 ** (dbfs / 20)
  const samples = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < samples.length; i++)
    samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate)
  return samples
}

describe('loudness of the exported mix', () => {
  it('reads EBU Tech 3341 case 1: a stereo 1 kHz sine at -23 dBFS is -23 LUFS', () => {
    for (const rate of [48_000, 44_100]) {
      const tone = sine(1000, -23, 20, rate)
      const meter = new LoudnessMeter(rate, 2)
      meter.add([tone, tone.slice()])
      expect(meter.integrated()).toBeCloseTo(-23, 1)
    }
  })

  it('measures the same in chunks as in one piece, and silence as nothing', () => {
    const rate = 48_000
    const tone = sine(440, -18, 10, rate)
    const whole = new LoudnessMeter(rate, 2)
    whole.add([tone, tone])
    const pieces = new LoudnessMeter(rate, 2)
    for (let at = 0; at < tone.length; at += 12_345) {
      const part = tone.subarray(at, at + 12_345)
      pieces.add([part, part])
    }
    expect(pieces.integrated()).toBeCloseTo(whole.integrated(), 6)
    const quiet = new LoudnessMeter(rate, 2)
    quiet.add([new Float32Array(rate * 5), new Float32Array(rate * 5)])
    expect(quiet.integrated()).toBe(-Infinity)
    expect(normalisingGain(-Infinity, -14)).toBe(1)
    expect(normalisingGain(-20, -14)).toBeCloseTo(10 ** (6 / 20), 6)
  })

  it('keeps every sample under the ceiling, the length as it was, and the same result in chunks', () => {
    const rate = 48_000
    const signal = sine(220, 0, 2, rate).map((value, i) => (i % 9_000 < 40 ? value * 3 : value))
    const ceiling = 10 ** (-1 / 20)
    const once = new PeakLimiter(rate, 2)
    const head = once.process([signal, signal])
    const tail = once.flush()
    const joined = new Float32Array(head[0]!.length + tail[0]!.length)
    joined.set(head[0]!)
    joined.set(tail[0]!, head[0]!.length)
    expect(joined.length).toBe(signal.length)
    expect(Math.max(...joined.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6)

    const chunked = new PeakLimiter(rate, 2)
    const parts: Float32Array[] = []
    for (let at = 0; at < signal.length; at += 7_777) {
      const part = signal.subarray(at, at + 7_777)
      parts.push(chunked.process([part, part])[0]!)
    }
    parts.push(chunked.flush()[0]!)
    const again = new Float32Array(signal.length)
    let offset = 0
    for (const part of parts) {
      again.set(part, offset)
      offset += part.length
    }
    expect(offset).toBe(signal.length)
    expect(Array.from(again.subarray(1000, 1100))).toEqual(Array.from(joined.subarray(1000, 1100)))
  })

  it('limits the peaks between samples too, so a tone whose samples sit at -3 dBFS still ends under -1 dBTP', () => {
    const rate = 48_000
    const tone = new Float32Array(rate).map((_, i) =>
      Math.sin((2 * Math.PI * 12_000 * i) / rate + Math.PI / 4),
    )
    const before = livePeak(tone)
    expect(Math.max(...tone.map(Math.abs))).toBeLessThan(0.71)
    expect(before).toBeGreaterThan(0.97)
    const limiter = new PeakLimiter(rate, 1)
    const out = joined([limiter.process([tone])[0]!, limiter.flush()[0]!])
    expect(out.length).toBe(tone.length)
    expect(livePeak(out)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-3)
  })

  it('normalises a whole mix to the target loudness under the ceiling', async () => {
    const rate = 48_000
    const quiet = sine(440, -30, 12, rate)
    const mix = [quiet, quiet.slice()]
    const input = new LoudnessMeter(rate, 2)
    input.add(mix)
    const plan = await normaliseMix(mix, rate, -14)
    expect(plan.measured).toBe(input.integrated())
    const meter = new LoudnessMeter(rate, 2)
    meter.add(mix)
    expect(meter.integrated()).toBeCloseTo(-14, 1)
    expect(livePeak(mix[0]!)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-3)
  })

  it('still reaches the target when the limiter has to hold spiky peaks down', async () => {
    const rate = 48_000
    const tone = sine(220, -24, 12, rate).map((value, i) =>
      i % 48_000 < 960 ? 0.9 * Math.sin((2 * Math.PI * 80 * i) / rate) : value,
    )
    const mix = [tone, tone.slice()]
    const plan = await normaliseMix(mix, rate, -14)
    expect(plan.gain).toBeGreaterThan(normalisingGain(plan.measured, -14))
    const meter = new LoudnessMeter(rate, 2)
    meter.add(mix)
    expect(Math.abs(meter.integrated() + 14)).toBeLessThanOrEqual(0.3)
    expect(plan.reached).toBeCloseTo(meter.integrated(), 1)
    expect(livePeak(mix[0]!)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-3)
  })
})

function joined(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** The true peak over a whole signal, through the same 4x estimate the limiter uses. */
function livePeak(signal: Float32Array): number {
  const history = new Float32Array(12)
  let peak = 0
  for (let i = 0; i < signal.length; i++) {
    history[i % 12] = signal[i]!
    if (i >= 11) peak = Math.max(peak, truePeakAt(history, i % 12))
  }
  return peak
}
