export type ExportAudioCodec = 'aac' | 'opus' | 'mp3' | 'pcm-s16'

export interface AudioEncoderSupportOptions {
  bitrate?: number
  numberOfChannels?: number
  sampleRate?: number
}

let aacRegistrationPromise: Promise<void> | null = null

async function registerAacEncoderOnce(): Promise<void> {
  if (!aacRegistrationPromise) {
    aacRegistrationPromise = import('@mediabunny/aac-encoder').then(({ registerAacEncoder }) => {
      registerAacEncoder()
    })
  }
  return aacRegistrationPromise
}

/**
 * Check audio encoder availability and install Mediabunny's AAC WASM fallback
 * when Chromium cannot provide a native AAC encoder (notably on Linux).
 */
export async function ensureAudioEncoderSupport(
  codec: ExportAudioCodec,
  options: AudioEncoderSupportOptions = {},
): Promise<boolean> {
  if (codec === 'pcm-s16') return true

  const { canEncodeAudio } = await import('mediabunny')
  const config = {
    bitrate: options.bitrate,
    numberOfChannels: options.numberOfChannels ?? 2,
    sampleRate: options.sampleRate ?? 48_000,
  }

  try {
    if (await canEncodeAudio(codec, config)) return true
    if (codec !== 'aac') return false

    await registerAacEncoderOnce()
    return await canEncodeAudio(codec, config)
  } catch {
    return false
  }
}
