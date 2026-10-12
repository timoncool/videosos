function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

const HEADER_SIZE = 44

function allocWav(channels: number, frameCount: number, sampleRate: number): ArrayBuffer {
  const blockAlign = channels * 2
  const pcmByteLength = frameCount * blockAlign
  const out = new ArrayBuffer(HEADER_SIZE + pcmByteLength)
  const view = new DataView(out)
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmByteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcmByteLength, true)
  return out
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels))
  const frameCount = buffer.length
  const out = allocWav(channels, frameCount, buffer.sampleRate)

  // Write PCM samples through an Int16Array view over the data region rather
  // than per-sample DataView.setInt16. Int16Array writes in platform byte
  // order, and every browser target runs on little-endian hardware (which is
  // what WAV requires), so this is correct and ~7x faster on long buffers.
  const pcm = new Int16Array(out, HEADER_SIZE, frameCount * channels)
  const left = buffer.getChannelData(0)

  if (channels > 1) {
    const right = buffer.getChannelData(1)
    let p = 0
    for (let index = 0; index < frameCount; index += 1) {
      pcm[p] = floatToInt16(left[index] ?? 0)
      pcm[p + 1] = floatToInt16(right[index] ?? 0)
      p += 2
    }
  } else {
    for (let index = 0; index < frameCount; index += 1) {
      pcm[index] = floatToInt16(left[index] ?? 0)
    }
  }

  return new Blob([out], { type: 'audio/wav' })
}

/**
 * Build a stereo WAV blob directly from already-quantized Int16 channels.
 *
 * The decode pipeline persists bins as Int16 PCM, so the conform asset can be
 * interleaved straight from those samples — skipping the Int16→Float32→Int16
 * round-trip (and per-sample clamp/round) that `audioBufferToWavBlob` pays when
 * it has to re-quantize an AudioBuffer.
 */
export function int16StereoToWavBlob(
  left: Int16Array,
  right: Int16Array,
  sampleRate: number,
): Blob {
  const frameCount = Math.min(left.length, right.length)
  const out = allocWav(2, frameCount, sampleRate)
  const pcm = new Int16Array(out, HEADER_SIZE, frameCount * 2)
  let p = 0
  for (let index = 0; index < frameCount; index += 1) {
    pcm[p] = left[index]!
    pcm[p + 1] = right[index]!
    p += 2
  }
  return new Blob([out], { type: 'audio/wav' })
}
