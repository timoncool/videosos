// Portable export contract: renders a real, media-backed video through the
// headless harness and probes the decoded artifact.
//
// `headless/test.mjs` covers the export summary and container signature with a
// text-only timeline, and `headless/media-test.mjs` covers the audio path with a
// generated WAV. Neither exercises the media decode -> canvas -> encode path for
// video, which is most of the export engine. This drives exactly that: a
// synthesised animated clip plus a tone, exported to WebM/VP9, then probed with
// ffprobe for stream count, codec, dimensions, frame rate and duration, and
// sampled at two timestamps to prove frames were actually rendered and differ.
//
// VP9/WebM is requested explicitly because AVC/MP4 encoding is not available on
// every host (see the forced-codec-fallback case in headless/test.mjs).
//
// Usage: node headless/export-media-video.mjs   (requires dist/ and ffmpeg)
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VIDEO_MEDIA_ID = 'generated-clip'
const AUDIO_MEDIA_ID = 'generated-tone'

const FPS = 30
const DURATION_SECONDS = 1
const DURATION_FRAMES = FPS * DURATION_SECONDS
const WIDTH = 320
const HEIGHT = 180
/** testsrc2 animates, so two sampled frames must differ. */
const SOURCE_PATTERN = `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${DURATION_SECONDS}`

function generateToneWav(filePath, { sampleRate = 48_000, frequency = 440 } = {}) {
  const sampleCount = Math.round(sampleRate * DURATION_SECONDS)
  const dataSize = sampleCount * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index++) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 12_000)
    wav.writeInt16LE(sample, 44 + index * 2)
  }
  fs.writeFileSync(filePath, wav)
}

async function generateClip(filePath) {
  await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      SOURCE_PATTERN,
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      filePath,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )
}

function renderInput(videoUrl, audioUrl) {
  return {
    tracks: [
      {
        id: 'video-1',
        name: 'V1',
        kind: 'video',
        height: 120,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
      {
        id: 'audio-1',
        name: 'A1',
        kind: 'audio',
        height: 60,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ],
    items: [
      {
        id: 'clip',
        type: 'video',
        trackId: 'video-1',
        from: 0,
        durationInFrames: DURATION_FRAMES,
        label: 'Generated clip',
        mediaId: VIDEO_MEDIA_ID,
        src: '',
        volume: 1,
        sourceStart: 0,
        sourceEnd: DURATION_FRAMES,
        sourceDuration: DURATION_FRAMES,
        sourceFps: FPS,
        speed: 1,
      },
      {
        id: 'tone',
        type: 'audio',
        trackId: 'audio-1',
        from: 0,
        durationInFrames: DURATION_FRAMES,
        label: 'Generated tone',
        mediaId: AUDIO_MEDIA_ID,
        src: '',
        volume: 0,
        sourceStart: 0,
        sourceEnd: DURATION_FRAMES,
        sourceDuration: DURATION_FRAMES,
        sourceFps: FPS,
        speed: 1,
      },
    ],
    transitions: [],
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#000',
    media: [
      {
        mediaId: VIDEO_MEDIA_ID,
        url: videoUrl,
        metadata: {
          id: VIDEO_MEDIA_ID,
          fileName: 'generated-clip.mp4',
          mimeType: 'video/mp4',
          duration: DURATION_SECONDS,
          videoCodec: 'h264',
          videoCodecSupported: true,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
        },
      },
      {
        mediaId: AUDIO_MEDIA_ID,
        url: audioUrl,
        metadata: {
          id: AUDIO_MEDIA_ID,
          fileName: 'generated-tone.wav',
          mimeType: 'audio/wav',
          duration: DURATION_SECONDS,
          audioCodec: 'pcm-s16',
          audioCodecSupported: true,
        },
      },
    ],
    settings: {
      mode: 'video',
      codec: 'vp9',
      audioCodec: 'opus',
      container: 'webm',
      quality: 'medium',
      resolution: { width: WIDTH, height: HEIGHT },
      fps: FPS,
      videoBitrate: 2_000_000,
      audioBitrate: 128_000,
    },
    outputFileName: 'export-contract.webm',
  }
}

async function probeStreams(file) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,channels',
      '-of',
      'json',
      '--',
      file,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
  return JSON.parse(stdout)
}

async function sampleFrame(file, atSeconds, outPath) {
  await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      outPath,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  return fs.readFileSync(outPath)
}

/**
 * Contrast of a decoded frame. A lossily encoded empty (black) frame still
 * carries ±1 rounding noise, so "any non-zero byte" would pass for it; the
 * spread between the darkest and lightest sample does not.
 */
function frameContrast(buffer) {
  let min = 255
  let max = 0
  for (const byte of buffer) {
    if (byte < min) min = byte
    if (byte > max) max = byte
  }
  return max - min
}

async function extractPcm(file, outPath) {
  await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', file, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', outPath],
    { encoding: 'utf8', timeout: 60_000 },
  )
  return fs.readFileSync(outPath)
}

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-export-contract-'))
  const clipPath = path.join(tempDir, 'generated-clip.mp4')
  const tonePath = path.join(tempDir, 'generated-tone.wav')
  const outputPath = path.join(tempDir, 'export-contract.webm')
  await generateClip(clipPath)
  generateToneWav(tonePath)

  const mediaFiles = {
    [VIDEO_MEDIA_ID]: clipPath,
    [AUDIO_MEDIA_ID]: tonePath,
  }
  const server = await createHarnessServer({
    distDir,
    resolveMedia: (mediaId) => mediaFiles[mediaId] ?? null,
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })

  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    downloadPromise.catch(() => {})
    const summary = await page.evaluate(
      (input) => window.freecut.renderTimeline(input),
      renderInput(server.mediaUrl(VIDEO_MEDIA_ID), server.mediaUrl(AUDIO_MEDIA_ID)),
    )
    const download = await downloadPromise
    await download.saveAs(outputPath)

    const size = fs.statSync(outputPath).size
    const signature = fs.readFileSync(outputPath).subarray(0, 4).toString('hex')

    assert.equal(summary.ok, true, `render failed: ${JSON.stringify(summary.warnings)}`)
    assert.equal(summary.effectiveSettings.codec, 'vp9', summary.effectiveSettings.codec)
    assert.equal(summary.effectiveSettings.container, 'webm', summary.effectiveSettings.container)
    assert.ok(
      !summary.warnings.some((warning) => warning.code === 'CODEC_FALLBACK'),
      `unexpected codec fallback: ${JSON.stringify(summary.warnings)}`,
    )
    assert.ok(
      Math.abs(summary.durationSeconds - DURATION_SECONDS) < 0.35,
      `summary duration ${summary.durationSeconds}`,
    )
    assert.ok(size > 5_000, `artifact too small: ${size} bytes`)
    assert.equal(signature, '1a45dfa3', `not a WebM artifact: ${signature}`)

    const probe = await probeStreams(outputPath)
    const videos = probe.streams.filter((stream) => stream.codec_type === 'video')
    const audios = probe.streams.filter((stream) => stream.codec_type === 'audio')
    assert.equal(videos.length, 1, `expected one video stream, got ${videos.length}`)
    assert.equal(audios.length, 1, `expected one audio stream, got ${audios.length}`)
    const [video] = videos
    assert.equal(video.codec_name, 'vp9', `artifact codec ${video.codec_name}`)
    assert.equal(video.width, WIDTH, `artifact width ${video.width}`)
    assert.equal(video.height, HEIGHT, `artifact height ${video.height}`)
    const [numerator, denominator = '1'] = String(video.avg_frame_rate).split('/')
    assert.equal(Number(numerator) / Number(denominator), FPS, `artifact fps ${video.avg_frame_rate}`)
    const durationSeconds = Number(probe.format?.duration)
    assert.ok(
      Number.isFinite(durationSeconds) &&
        Math.abs(durationSeconds - DURATION_SECONDS) < 0.35,
      `artifact duration ${probe.format?.duration}`,
    )

    // Frames must be rendered, non-empty and animated: a stuck or blank export
    // is exactly what a summary-only assertion cannot see.
    const early = await sampleFrame(outputPath, 0.1, path.join(tempDir, 'early.raw'))
    const late = await sampleFrame(outputPath, 0.9, path.join(tempDir, 'late.raw'))
    assert.ok(early.length === WIDTH * HEIGHT * 3, `unexpected frame size ${early.length}`)
    assert.ok(
      frameContrast(early) >= 64,
      `first sampled frame has no contrast (${frameContrast(early)}); the export rendered an empty frame`,
    )
    assert.ok(!early.equals(late), 'sampled frames are identical; the clip did not animate')

    // The audio encode path has to carry the tone through, not just declare a stream.
    const pcm = await extractPcm(outputPath, path.join(tempDir, 'audio.pcm'))
    assert.ok(pcm.length > 0, 'exported artifact has no decodable audio')
    assert.ok(
      pcm.some((byte) => byte !== 0),
      'exported audio is silent',
    )

    process.stdout.write(
      `Export contract passed (${size} bytes, ${videos.length}v/${audios.length}a, ` +
        `${video.width}x${video.height}@${video.avg_frame_rate}, ${durationSeconds.toFixed(2)}s)\n`,
    )
  } finally {
    await browser.close()
    await server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`Export contract failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
