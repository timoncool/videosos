/**
 * Loudness of the exported mix as platforms measure it (ITU-R BS.1770-4, EBU R 128) and the limiter that keeps the
 * normalised mix under its ceiling, both streaming so the windowed export can use them chunk by chunk.
 */

/** One biquad section, Direct Form I, with its state kept between chunks. */
class Biquad {
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  next(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/**
 * The K-weighting of BS.1770 for any sample rate, derived as libebur128 does: at 48 kHz it gives the standard's
 * coefficients to the last digit, the high pass keeping its unnormalised numerator 1, -2, 1.
 */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelf = (() => {
    const q = 0.7071752369554193
    const k = Math.tan((Math.PI * 1681.974450955533) / sampleRate)
    const vh = 10 ** (3.999843853973347 / 20)
    const vb = vh ** 0.4996667741545416
    const a0 = 1 + k / q + k * k
    return new Biquad(
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
      (2 * (k * k - 1)) / a0,
      (1 - k / q + k * k) / a0,
    )
  })()
  const highPass = (() => {
    const q = 0.5003270373238773
    const k = Math.tan((Math.PI * 38.13547087602444) / sampleRate)
    const a0 = 1 + k / q + k * k
    return new Biquad(1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0)
  })()
  return [shelf, highPass]
}

/** Integrated loudness of a stream of stereo or mono chunks, in LUFS; -Infinity for silence. */
export class LoudnessMeter {
  private readonly filters: Array<[Biquad, Biquad]>
  private readonly step: number
  /** The K-weighted energy of each 100 ms step, summed over the channels. */
  private readonly steps: number[] = []
  private current = 0
  private filled = 0

  constructor(sampleRate: number, channels: number) {
    this.filters = Array.from({ length: channels }, () => kWeighting(sampleRate))
    this.step = Math.round(sampleRate / 10)
  }

  add(chunk: readonly Float32Array[]): void {
    const length = chunk[0]?.length ?? 0
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < this.filters.length; channel++) {
        const [shelf, highPass] = this.filters[channel]!
        const y = highPass.next(shelf.next(chunk[channel]?.[i] ?? 0))
        this.current += y * y
      }
      if (++this.filled === this.step) {
        this.steps.push(this.current)
        this.current = 0
        this.filled = 0
      }
    }
  }

  integrated(): number {
    // gating blocks of 400 ms overlapping by 75 %: four consecutive steps
    const blocks: number[] = []
    for (let i = 0; i + 4 <= this.steps.length; i++) {
      blocks.push(
        (this.steps[i]! + this.steps[i + 1]! + this.steps[i + 2]! + this.steps[i + 3]!) /
          (4 * this.step),
      )
    }
    const loudness = (power: number) => -0.691 + 10 * Math.log10(power)
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const absolute = blocks.filter((power) => loudness(power) > -70)
    if (absolute.length === 0) return -Infinity
    const relative = loudness(mean(absolute)) - 10
    const gated = absolute.filter((power) => loudness(power) > relative)
    return gated.length === 0 ? -Infinity : loudness(mean(gated))
  }
}

/** The gain that brings `measured` LUFS to `target` LUFS; unity for silence. */
export function normalisingGain(measured: number, target: number): number {
  return Number.isFinite(measured) ? 10 ** ((target - measured) / 20) : 1
}

/** The ceiling the limiter keeps the true peak under, in dBTP. */
const CEILING_DB = -1

/** Taps either side of a sample the true-peak interpolation reads: the detector runs this many samples behind its input. */
const TRUE_PEAK_REACH = 6

/** Windowed-sinc kernels for the points a quarter, a half and three quarters of the way to the next sample (4x oversampling). */
const TRUE_PEAK_KERNELS = [0.25, 0.5, 0.75].map((fraction) =>
  Array.from({ length: 2 * TRUE_PEAK_REACH }, (_, tap) => {
    const distance = fraction - (tap - TRUE_PEAK_REACH + 1)
    const sinc = Math.sin(Math.PI * distance) / (Math.PI * distance)
    const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / (TRUE_PEAK_REACH + 0.5))
    return sinc * window
  }),
)

/** The largest of a sample and the three points between it and the next, as BS.1770-4 estimates the true peak. */
export function truePeakAt(history: Float32Array, newest: number): number {
  const size = history.length
  const at = (offset: number) => history[(newest + size + offset) % size]!
  let peak = Math.abs(at(-TRUE_PEAK_REACH))
  for (const kernel of TRUE_PEAK_KERNELS) {
    let value = 0
    for (let tap = 0; tap < kernel.length; tap++)
      value += kernel[tap]! * at(tap - 2 * TRUE_PEAK_REACH + 1)
    peak = Math.max(peak, Math.abs(value))
  }
  return peak
}

/**
 * A look-ahead true-peak limiter: the gain falls before a peak and recovers after it, so neither a sample nor the
 * signal between samples passes the ceiling, and nothing clicks. The output lags the input by the look-ahead and the
 * detector's reach, absorbed at the start and given back by `flush`, so as many samples come out as went in.
 */
export class PeakLimiter {
  private readonly ceiling: number
  private readonly lookahead: number
  private readonly latency: number
  private readonly hold: number
  private readonly release: number
  private readonly history: Float32Array[]
  private readonly delay: Float32Array[]
  private readonly wanted: Float32Array
  private readonly smoothing: Float32Array
  /** Positions with rising wanted gains, a running minimum over the hold window; `head` is its front. */
  private readonly minimum: number[] = []
  private head = 0
  private index = 0
  private smoothSum = 0
  private gain = 1
  private skip: number

  constructor(
    sampleRate: number,
    private readonly channels: number,
    ceilingDb = CEILING_DB,
  ) {
    this.ceiling = 10 ** (ceilingDb / 20)
    this.lookahead = Math.max(1, Math.round(sampleRate * 0.005))
    this.latency = this.lookahead + TRUE_PEAK_REACH
    this.hold = this.lookahead * 2
    this.release = 1 - Math.exp(-1 / (sampleRate * 0.06))
    this.history = Array.from({ length: channels }, () => new Float32Array(2 * TRUE_PEAK_REACH))
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.latency))
    this.wanted = new Float32Array(this.hold).fill(1)
    this.smoothing = new Float32Array(this.lookahead).fill(1)
    this.smoothSum = this.lookahead
    this.skip = this.latency
  }

  process(chunk: readonly Float32Array[]): Float32Array[] {
    const length = chunk[0]?.length ?? 0
    const out = Array.from(
      { length: this.channels },
      () => new Float32Array(Math.max(0, length - Math.min(this.skip, length))),
    )
    let written = 0
    const historySlot = (i: number) => i % (2 * TRUE_PEAK_REACH)
    for (let i = 0; i < length; i++) {
      let peak = 0
      for (let channel = 0; channel < this.channels; channel++) {
        const history = this.history[channel]!
        history[historySlot(this.index)] = chunk[channel]?.[i] ?? 0
        peak = Math.max(peak, truePeakAt(history, historySlot(this.index)))
      }
      const sample = this.step(peak > this.ceiling ? this.ceiling / peak : 1)
      const slot = this.index % this.latency
      for (let channel = 0; channel < this.channels; channel++) {
        const delayed = this.delay[channel]!
        const leaving = delayed[slot]!
        delayed[slot] = chunk[channel]?.[i] ?? 0
        if (this.skip === 0) out[channel]![written] = leaving * sample
      }
      if (this.skip > 0) this.skip--
      else written++
      this.index++
    }
    return out
  }

  /** What the look-ahead still holds, at the end of the stream. */
  flush(): Float32Array[] {
    return this.process(Array.from({ length: this.channels }, () => new Float32Array(this.latency)))
  }

  /** The gain for the sample leaving the delay now, from the gain each sample of the hold window wants. */
  private step(wanted: number): number {
    const position = this.index
    this.wanted[position % this.hold] = wanted
    while (
      this.minimum.length > this.head &&
      this.wanted[this.minimum[this.minimum.length - 1]! % this.hold]! >= wanted
    )
      this.minimum.pop()
    this.minimum.push(position)
    while (this.minimum[this.head]! <= position - this.hold) this.head++
    if (this.head > 4096) {
      this.minimum.splice(0, this.head)
      this.head = 0
    }
    const held = this.wanted[this.minimum[this.head]! % this.hold]!
    const slot = position % this.lookahead
    this.smoothSum += held - this.smoothing[slot]!
    this.smoothing[slot] = held
    const target = this.smoothSum / this.lookahead
    this.gain = target < this.gain ? target : this.gain + (target - this.gain) * this.release
    return Math.min(this.gain, target)
  }
}

export function applyGain(chunk: readonly Float32Array[], gain: number): void {
  if (gain === 1) return
  for (const channel of chunk) {
    for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * gain
  }
}

const scaled = (chunk: readonly Float32Array[], gain: number) =>
  chunk.map((channel) => channel.map((value) => value * gain))

/** The highest true peak of a stream of chunks. */
class TruePeakMeter {
  private readonly history: Float32Array[]
  private index = 0
  peak = 0

  constructor(channels: number) {
    this.history = Array.from({ length: channels }, () => new Float32Array(2 * TRUE_PEAK_REACH))
  }

  add(chunk: readonly Float32Array[]): void {
    const length = chunk[0]?.length ?? 0
    for (let i = 0; i < length; i++) {
      const slot = this.index % (2 * TRUE_PEAK_REACH)
      this.history.forEach((history, channel) => {
        history[slot] = chunk[channel]?.[i] ?? 0
        this.peak = Math.max(this.peak, truePeakAt(history, slot))
      })
      this.index++
    }
  }
}

/** The mix, chunk by chunk, from its start each time it is called. */
export type MixChunks = () => AsyncIterable<readonly Float32Array[]>

export interface LoudnessPlan {
  /** Integrated loudness of the mix as it was mixed, LUFS. */
  measured: number
  /** The gain applied before the limiter. */
  gain: number
  /** Integrated loudness the written mix has, LUFS. */
  reached: number
}

async function loudnessThroughLimiter(
  chunks: MixChunks,
  sampleRate: number,
  channels: number,
  gain: number,
): Promise<number> {
  const meter = new LoudnessMeter(sampleRate, channels)
  const limiter = new PeakLimiter(sampleRate, channels)
  for await (const chunk of chunks()) meter.add(limiter.process(scaled(chunk, gain)))
  meter.add(limiter.flush())
  return meter.integrated()
}

/**
 * The gain that brings the mix to `target` LUFS once the limiter has held its peaks down. Where the raised mix would
 * pass the ceiling, the limiter takes some loudness away, so the gain is measured through it and corrected up to three
 * times: a very dynamic mix ends a little short of the target, as ffmpeg's loudnorm leaves it, instead of being crushed.
 */
export async function planLoudness(
  chunks: MixChunks,
  sampleRate: number,
  channels: number,
  target: number,
): Promise<LoudnessPlan> {
  const meter = new LoudnessMeter(sampleRate, channels)
  const peaks = new TruePeakMeter(channels)
  for await (const chunk of chunks()) {
    meter.add(chunk)
    peaks.add(chunk)
  }
  const measured = meter.integrated()
  if (!Number.isFinite(measured)) return { measured, gain: 1, reached: measured }
  let gain = normalisingGain(measured, target)
  if (peaks.peak * gain <= 10 ** (CEILING_DB / 20)) return { measured, gain, reached: target }
  let reached = measured
  for (let round = 0; round < 3; round++) {
    reached = await loudnessThroughLimiter(chunks, sampleRate, channels, gain)
    if (Math.abs(reached - target) <= 0.2 || round === 2) break
    gain *= normalisingGain(reached, target)
  }
  return { measured, gain, reached }
}

/** Brings a whole mix to `target` LUFS in place, its true peak limited under -1 dBTP. */
export async function normaliseMix(
  mix: Float32Array[],
  sampleRate: number,
  target: number,
): Promise<LoudnessPlan> {
  const step = sampleRate * 10
  const length = mix[0]?.length ?? 0
  const plan = await planLoudness(
    async function* () {
      for (let at = 0; at < length; at += step)
        yield mix.map((channel) => channel.subarray(at, at + step))
    },
    sampleRate,
    mix.length,
    target,
  )
  const limiter = new PeakLimiter(sampleRate, mix.length)
  let written = 0
  const put = (out: Float32Array[]) => {
    out.forEach((channel, index) => mix[index]!.set(channel, written))
    written += out[0]?.length ?? 0
  }
  // the limiter's output lags its input, so writing it back over the mix never overtakes what is still to be read
  for (let at = 0; at < length; at += step) {
    put(
      limiter.process(
        scaled(
          mix.map((channel) => channel.subarray(at, at + step)),
          plan.gain,
        ),
      ),
    )
  }
  put(limiter.flush())
  return plan
}
