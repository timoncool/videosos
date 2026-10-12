// Portable media/audio integration using a WAV generated at runtime.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MEDIA_ID = 'generated-tone'

function generateToneWav(
  filePath,
  { sampleRate = 48_000, durationSeconds = 0.5, frequency = 440 } = {},
) {
  const sampleCount = Math.round(sampleRate * durationSeconds)
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

function renderInput(mediaUrl) {
  return {
    tracks: [
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
        order: 0,
        items: [],
      },
    ],
    items: [
      {
        id: 'tone',
        type: 'audio',
        trackId: 'audio-1',
        from: 0,
        durationInFrames: 15,
        label: 'Generated tone',
        mediaId: MEDIA_ID,
        src: '',
        volume: 0,
        sourceStart: 0,
        sourceEnd: 15,
        sourceDuration: 15,
        sourceFps: 30,
        speed: 1,
      },
    ],
    transitions: [],
    fps: 30,
    width: 320,
    height: 180,
    backgroundColor: '#000',
    media: [
      {
        mediaId: MEDIA_ID,
        url: mediaUrl,
        metadata: {
          id: MEDIA_ID,
          fileName: 'generated-tone.wav',
          mimeType: 'audio/wav',
          duration: 0.5,
          audioCodec: 'pcm-s16',
          audioCodecSupported: true,
        },
      },
    ],
    settings: {
      mode: 'audio',
      codec: 'avc',
      audioCodec: 'pcm-s16',
      container: 'wav',
      quality: 'high',
      resolution: { width: 320, height: 180 },
      fps: 30,
      audioBitrate: 192_000,
    },
    outputFileName: 'portable-media.wav',
  }
}

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-media-test-'))
  const sourcePath = path.join(tempDir, 'generated-tone.wav')
  const outputPath = path.join(tempDir, 'rendered-tone.wav')
  generateToneWav(sourcePath)

  const server = await createHarnessServer({
    distDir,
    resolveMedia: (mediaId) => (mediaId === MEDIA_ID ? sourcePath : null),
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
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    const summary = await page.evaluate(
      (input) => window.freecut.renderTimeline(input),
      renderInput(server.mediaUrl(MEDIA_ID)),
    )
    const download = await downloadPromise
    await download.saveAs(outputPath)

    const output = fs.readFileSync(outputPath)
    assert.equal(output.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(output.subarray(8, 12).toString('ascii'), 'WAVE')
    assert.equal(summary.mimeType.startsWith('audio/wav'), true)
    assert.equal(summary.effectiveSettings.container, 'wav')
    assert.ok(
      summary.durationSeconds >= 0.5 && summary.durationSeconds <= 1.1,
      `duration ${summary.durationSeconds}`,
    )
    assert.ok(output.length > 44)
    const dataOffset = output.indexOf(Buffer.from('data'))
    assert.ok(dataOffset >= 0, 'WAV has a data chunk')
    const audioBytes = output.subarray(dataOffset + 8)
    assert.ok(
      audioBytes.some((byte) => byte !== 0),
      'rendered PCM contains audible samples',
    )
    process.stdout.write(`Portable media/audio contract passed (${output.length} bytes)\n`)
  } finally {
    await browser.close()
    await server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`Portable media/audio contract failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
