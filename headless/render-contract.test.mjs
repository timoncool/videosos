import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MissingMediaError,
  outputPathForContainer,
  renderJob,
  warningsHeaderValue,
} from './lib/render-core.mjs'

const requestedSettings = {
  mode: 'video',
  codec: 'avc',
  audioCodec: 'aac',
  container: 'mp4',
  quality: 'high',
  resolution: { width: 1280, height: 720 },
  fps: 30,
  videoBitrate: 4_000_000,
  audioBitrate: 192_000,
}

function fakePage(summary, bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86])) {
  let evaluateCalls = 0
  return {
    get evaluateCalls() {
      return evaluateCalls
    },
    waitForEvent: async () => ({ saveAs: async (target) => fs.writeFileSync(target, bytes) }),
    evaluate: async () => {
      evaluateCalls++
      return structuredClone(summary)
    },
  }
}

function job(dir, overrides = {}) {
  return {
    project: { id: 'project-1', name: 'Project', timeline: {}, metadata: {} },
    settings: structuredClone(requestedSettings),
    media: [],
    missing: [],
    hasRange: false,
    inPoint: null,
    outPoint: null,
    outPath: path.join(dir, 'result.mp4'),
    ...overrides,
  }
}

function summary(overrides = {}) {
  return {
    ok: true,
    mimeType: 'video/mp4',
    fileSize: 6,
    durationSeconds: 1,
    fileName: 'freecut-export.mp4',
    effectiveSettings: structuredClone(requestedSettings),
    warnings: [],
    ...overrides,
  }
}

test('supported settings remain requested settings without fallback warning', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = await renderJob(fakePage(summary()), job(dir), { onWarn: () => {} })
  assert.equal(result.effectiveSettings.codec, 'avc')
  assert.equal(result.effectiveSettings.container, 'mp4')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.outputPath, path.join(dir, 'result.mp4'))
})

test('software WebGPU rejects GPU-effect projects before browser rendering', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const page = fakePage(summary())
  const effectProject = {
    id: 'project-1',
    name: 'Project',
    metadata: {},
    timeline: {
      items: [{ id: 'item-1', effects: [{ id: 'effect-1', enabled: true }] }],
    },
  }
  await assert.rejects(
    () => renderJob(page, job(dir, { project: effectProject }), { softwareGpu: true }),
    (error) => error.code === 'HARDWARE_GPU_REQUIRED' && error.statusCode === 422,
  )
  assert.equal(page.evaluateCalls, 0)
})

test('fallback metadata controls extension, MIME, summary, and output signature', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fallbackWarning = {
    code: 'CODEC_FALLBACK',
    message: 'Requested video codec avc is unsupported; using vp9/webm',
    details: { requestedCodec: 'avc', effectiveCodec: 'vp9', effectiveContainer: 'webm' },
  }
  const page = fakePage(
    summary({
      mimeType: 'video/webm',
      fileName: 'freecut-export.webm',
      effectiveSettings: {
        ...requestedSettings,
        codec: 'vp9',
        audioCodec: 'opus',
        container: 'webm',
      },
      warnings: [fallbackWarning],
    }),
  )
  const result = await renderJob(page, job(dir), { onWarn: () => {} })
  assert.equal(result.outputPath, path.join(dir, 'result.webm'))
  assert.equal(result.fileName, 'result.webm')
  assert.equal(result.mimeType, 'video/webm')
  assert.equal(result.effectiveSettings.container, 'webm')
  assert.equal(result.effectiveSettings.audioCodec, 'opus')
  assert.equal(result.warnings[0].code, 'CODEC_FALLBACK')
  assert.deepEqual([...fs.readFileSync(result.outputPath).subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3])
})

test('strict missing media rejects before browser rendering and writes no output', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const page = fakePage(summary())
  await assert.rejects(
    renderJob(page, job(dir, { missing: ['media-404'] }), { onWarn: () => {} }),
    (error) => error instanceof MissingMediaError && error.code === 'MISSING_MEDIA',
  )
  assert.equal(page.evaluateCalls, 0)
  assert.equal(fs.existsSync(path.join(dir, 'result.mp4')), false)
})

test('permissive missing media succeeds with a structured warning', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = await renderJob(fakePage(summary()), job(dir, { missing: ['media-404'] }), {
    allowMissingMedia: true,
    onWarn: () => {},
  })
  assert.equal(result.ok, true)
  assert.equal(result.warnings[0].code, 'MISSING_MEDIA')
  assert.deepEqual(result.warnings[0].details.mediaIds, ['media-404'])
})

test('unsupported audio is visible in render JSON and the HTTP warning header', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-render-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const media = [
    {
      mediaId: 'clip-1',
      url: 'http://localhost/media/clip-1',
      metadata: { fileName: 'source.mov', audioCodec: 'dts', audioCodecSupported: false },
    },
  ]
  const result = await renderJob(fakePage(summary()), job(dir, { media }), { onWarn: () => {} })
  assert.equal(result.warnings[0].code, 'UNSUPPORTED_AUDIO')
  const cliJson = JSON.parse(JSON.stringify({ ok: true, renders: [{ summary: result }] }))
  assert.equal(cliJson.renders[0].summary.warnings[0].code, 'UNSUPPORTED_AUDIO')
  const httpWarnings = JSON.parse(warningsHeaderValue(result.warnings))
  assert.equal(httpWarnings[0].code, 'UNSUPPORTED_AUDIO')
})

test('outputPathForContainer replaces stale requested extensions', () => {
  assert.equal(outputPathForContainer('render.mp4', 'webm'), 'render.webm')
  assert.equal(outputPathForContainer('render', 'webm'), 'render.webm')
})
