import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFinalRenderProbe } from './lib/final-render-probe.mjs'

const response = (overrides = {}) => ({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1080,
      height: 1920,
      pix_fmt: 'yuv420p',
      avg_frame_rate: '50/2',
    },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.004' },
  ...overrides,
})

test('parses final render evidence only from observed MP4 container and streams', () => {
  assert.deepEqual(parseFinalRenderProbe(response()), {
    width: 1080,
    height: 1920,
    durationMillis: 2004,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    frameRate: { numerator: 25, denominator: 1 },
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    audioChannels: 2,
  })
})

test('rejects wrong containers and ambiguous stream layouts', () => {
  assert.throws(
    () => parseFinalRenderProbe(response({ format: { format_name: 'matroska', duration: '2' } })),
    /not MP4/,
  )
  const extraAudio = response()
  extraAudio.streams.push({
    codec_type: 'audio',
    codec_name: 'aac',
    sample_rate: '48000',
    channels: 2,
  })
  assert.throws(() => parseFinalRenderProbe(extraAudio), /exactly one video and one audio/)
})
