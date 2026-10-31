/**
 * The silence before and after the speech of a voice-over, found as Dub Studio's tts_trim finds it: 20 ms frames,
 * a frame is speech above the loudest frame's level minus 40 dB (never below -70 dBFS), and 60 ms are kept past the
 * first and the last speech frame so a soft final consonant stays.
 */

const FRAME_SECONDS = 0.02
const BELOW_PEAK_DB = 40
const FLOOR_DBFS = -70
const MARGIN_FRAMES = 3

export interface SpeechEdges {
  leadSeconds: number
  tailSeconds: number
}

const NONE: SpeechEdges = { leadSeconds: 0, tailSeconds: 0 }

/** The silence at both ends of mono samples; none when nothing rises above the floor. */
export function speechEdges(samples: Float32Array, sampleRate: number): SpeechEdges {
  const hop = Math.round(sampleRate * FRAME_SECONDS)
  if (hop === 0 || samples.length === 0) return NONE
  const rms: number[] = []
  let peak = 0
  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + hop)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    const level = Math.sqrt(sum / (end - start))
    rms.push(level)
    if (level > peak) peak = level
  }
  const threshold = Math.max(peak * 10 ** (-BELOW_PEAK_DB / 20), 10 ** (FLOOR_DBFS / 20))
  const first = rms.findIndex((level) => level > threshold)
  if (first < 0) return NONE
  const last = rms.findLastIndex((level) => level > threshold)
  const start = Math.max(0, first - MARGIN_FRAMES) * hop
  const end = Math.min(samples.length, (last + 1 + MARGIN_FRAMES) * hop)
  return { leadSeconds: start / sampleRate, tailSeconds: (samples.length - end) / sampleRate }
}

/** The silence at both ends of a sound file's speech, its channels mixed to one. */
export async function speechEdgesOf(blob: Blob): Promise<SpeechEdges> {
  const decoded = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(await blob.arrayBuffer())
  const mono = new Float32Array(decoded.length)
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / decoded.numberOfChannels
  }
  return speechEdges(mono, decoded.sampleRate)
}
