import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  canonicalJsonBytes,
  FINAL_RENDER_PROFILE,
  FINAL_RENDER_PROFILE_SHA256,
  qualifiedSha256,
} from './lib/contract.mjs'

const root = path.resolve(import.meta.dirname, '..')
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-lifecycle-e2e-'))
fs.writeFileSync(
  path.join(workspace, '.freecut-workspace.json'),
  '{"schemaVersion":"2.0","createdAt":1}\n',
)
const port = 20_000 + Math.floor(Math.random() * 20_000)

function generateToneWav(filePath) {
  const sampleRate = 48_000
  const sampleCount = sampleRate / 2
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
  for (let index = 0; index < sampleCount; index++)
    wav.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000),
      44 + index * 2,
    )
  fs.writeFileSync(filePath, wav)
}

/**
 * The final-render flow needs a genuinely decodable clip, so this synthesises
 * one with ffmpeg rather than hand-writing an MP4. ffmpeg is therefore a
 * prerequisite of this suite; say so plainly instead of failing on a bare
 * status assertion.
 */
function generateToneVideo(filePath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=size=108x192:rate=25:duration=0.6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=0.6',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-shortest',
      filePath,
    ],
    { encoding: 'utf8' },
  )
  if (result.error?.code === 'ENOENT' || result.status === null) {
    throw new Error(
      'ffmpeg is required by headless/lifecycle-e2e.mjs (it synthesises the clip the ' +
        'final-render checkpoint renders). Install ffmpeg and re-run.',
    )
  }
  assert.equal(result.status, 0, result.stderr)
}

async function jsonRequest(route, options) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options)
  const body = await response.json()
  assert.equal(response.ok, true, `${JSON.stringify(body)}\n${serviceLog}`)
  return { response, body }
}

function runAgent(args) {
  const result = spawnSync(process.execPath, ['headless/agent.mjs', ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const service = spawn(
  process.execPath,
  ['headless/serve.mjs', '--workspace', workspace, '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serviceLog = ''
service.stdout.on('data', (chunk) => {
  serviceLog += chunk
})
service.stderr.on('data', (chunk) => {
  serviceLog += chunk
})

let initialStatus
let edited
let checkpoint
let finalRenderBody
let finalRender
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      ready = (await jsonRequest('/health')).body.ok
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  assert.equal(ready, true, serviceLog)
  initialStatus = (await jsonRequest('/v1/status')).body
  assert.equal(initialStatus.state, 'ready')
  assert.equal(initialStatus.queue.accepting, true)
  assert.equal(initialStatus.activeOperation, null)
  const createOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'create-demo' },
    body: JSON.stringify({ id: 'demo', name: 'Demo' }),
  }
  const created = (await jsonRequest('/v1/projects', createOptions)).body
  const replay = await jsonRequest('/v1/projects', createOptions)
  assert.equal(replay.response.headers.get('idempotency-replayed'), 'true')
  assert.equal(replay.body.revision, created.revision)
  const conflict = await fetch(`http://127.0.0.1:${port}/v1/projects`, {
    ...createOptions,
    body: '{ "id": "demo", "name": "Demo" }',
  })
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT')
  const listed = (await jsonRequest('/v1/projects')).body
  assert.equal(listed.projects.length, 1)
  const editOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'edit-demo' },
    body: JSON.stringify({
      persist: true,
      expectedRevision: created.revision,
      ops: [
        { callerId: 'created', op: 'addText', text: 'agent', from: 0 },
        { callerId: 'moved', op: 'moveItem', id: { $ref: 'created#/detail/id' }, from: 6 },
      ],
    }),
  }
  edited = (await jsonRequest('/v1/projects/demo/edit', editOptions)).body
  assert.equal(edited.persisted, true)
  assert.equal(edited.project.timeline.items[0].from, 6)
  const staleUpdate = await fetch(`http://127.0.0.1:${port}/v1/projects/demo`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      updates: { name: 'Stale update' },
      expectedRevision: created.revision,
    }),
  })
  assert.equal(staleUpdate.status, 409)
  const staleError = await staleUpdate.json()
  assert.equal(staleError.error.code, 'REVISION_CONFLICT')
  assert.equal(staleError.error.expectedRevision, created.revision)
  assert.equal(staleError.error.actualRevision, edited.revision)
  const conflictStatus = (await jsonRequest('/v1/status')).body
  assert.equal(conflictStatus.lastOperation.kind, 'project-update')
  assert.equal(conflictStatus.lastOperation.state, 'failed')
  assert.equal(conflictStatus.lastOperation.error.code, 'REVISION_CONFLICT')
  const unchanged = (await jsonRequest('/v1/projects/demo')).body
  assert.equal(unchanged.revision, edited.revision)
  assert.equal(unchanged.project.name, 'Demo')

  const traversal = await fetch(`http://127.0.0.1:${port}/v1/projects/%2e%2e%2foutside`)
  assert.equal(traversal.status, 404)

  const recordingDirectory = path.join(workspace, 'recording')
  fs.mkdirSync(recordingDirectory, { recursive: true })
  const finalAudioSource = path.join(recordingDirectory, 'tone.mp4')
  generateToneVideo(finalAudioSource)
  const finalAudioBytes = fs.readFileSync(finalAudioSource)
  await jsonRequest('/v1/media/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'import-final-audio' },
    body: JSON.stringify({
      mediaId: 'final_media',
      projectId: 'demo',
      sourceRelativePath: 'recording/tone.mp4',
      expectedByteSize: finalAudioBytes.byteLength,
      expectedSha256: qualifiedSha256(finalAudioBytes),
    }),
  })
  edited = (
    await jsonRequest('/v1/projects/demo/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'add-final-audio' },
      body: JSON.stringify({
        persist: true,
        expectedRevision: edited.revision,
        ops: [
          { callerId: 'final_audio_track', op: 'addTrack', kind: 'video' },
          {
            callerId: 'final_audio',
            op: 'addClip',
            mediaId: 'final_media',
            trackId: { $ref: 'final_audio_track#/detail/trackId' },
            from: 0,
            durationInFrames: 15,
          },
        ],
      }),
    })
  ).body

  const checkpointRecipe = {
    schemaVersion: '1.1',
    operations: [
      {
        callerId: 'checkpoint_move',
        op: 'moveItem',
        id: edited.project.timeline.items[0].id,
        from: 9,
      },
    ],
    render: { codec: 'vp9', container: 'webm', duration: 0.2, quality: 'low' },
  }
  const checkpointBody = {
    operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10',
    projectId: 'demo',
    expectedRevision: edited.revision,
    recipe: checkpointRecipe,
    recipeSha256: qualifiedSha256(canonicalJsonBytes(checkpointRecipe)),
    outputRelativePath: 'artifacts/demo/checkpoint.webm',
  }
  const checkpointOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'checkpoint-demo' },
    body: JSON.stringify(checkpointBody),
  }
  const accepted = await jsonRequest('/v1/checkpoint-operations', checkpointOptions)
  assert.equal(accepted.response.status, 202)
  assert.equal(accepted.body.operation.phase, 'queued')
  const checkpointReplay = await jsonRequest('/v1/checkpoint-operations', checkpointOptions)
  assert.equal(checkpointReplay.response.headers.get('idempotency-replayed'), 'true')
  const changedCheckpoint = await fetch(`http://127.0.0.1:${port}/v1/checkpoint-operations`, {
    ...checkpointOptions,
    body: JSON.stringify({ ...checkpointBody, outputRelativePath: 'artifacts/demo/other.webm' }),
  })
  assert.equal(changedCheckpoint.status, 409)
  assert.equal((await changedCheckpoint.json()).error.code, 'CHECKPOINT_IDEMPOTENCY_CONFLICT')
  for (let attempt = 0; attempt < 160; attempt++) {
    checkpoint = (await jsonRequest(`/v1/checkpoint-operations/${checkpointBody.operationId}`)).body
      .operation
    if (checkpoint.state === 'succeeded' || checkpoint.state === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(checkpoint?.state, 'succeeded', JSON.stringify(checkpoint))
  assert.equal(checkpoint.resultingRevision.startsWith('sha256:'), true)
  assert.equal(checkpoint.artifact.relativePath, checkpointBody.outputRelativePath)
  const checkpointArtifact = fs.readFileSync(path.join(workspace, checkpoint.artifact.relativePath))
  assert.equal(checkpoint.artifact.sha256, qualifiedSha256(checkpointArtifact))
  assert.equal(checkpoint.artifact.byteSize, checkpointArtifact.byteLength)

  finalRenderBody = {
    kind: 'final_render',
    operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b12',
    projectId: 'demo',
    expectedRevision: checkpoint.resultingRevision,
    renderProfile: FINAL_RENDER_PROFILE,
    renderProfileSha256: FINAL_RENDER_PROFILE_SHA256,
    approvalBindingSha256: `sha256:${'a'.repeat(64)}`,
    outputRelativePath: 'artifacts/demo/final.mp4',
  }
  const finalRenderOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'final-render-demo' },
    body: JSON.stringify(finalRenderBody),
  }
  const finalAccepted = await jsonRequest('/v1/checkpoint-operations', finalRenderOptions)
  assert.equal(finalAccepted.body.operation.kind, 'final_render')
  assert.equal(finalAccepted.body.operation.renderProfileSha256, FINAL_RENDER_PROFILE_SHA256)
  assert.equal(
    finalAccepted.body.operation.approvalBindingSha256,
    finalRenderBody.approvalBindingSha256,
  )
  for (let attempt = 0; attempt < 320; attempt++) {
    finalRender = (await jsonRequest(`/v1/checkpoint-operations/${finalRenderBody.operationId}`))
      .body.operation
    if (finalRender.state === 'succeeded' || finalRender.state === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(finalRender?.state, 'succeeded', `${JSON.stringify(finalRender)}\n${serviceLog}`)
  assert.equal(finalRender.artifact.mimeType, 'video/mp4')
  assert.equal(finalRender.artifact.mediaProbe.width, 1080)
  assert.equal(finalRender.artifact.mediaProbe.height, 1920)
  assert.equal(finalRender.artifact.mediaProbe.durationMillis > 0, true)
  assert.equal(finalRender.artifact.mediaProbe.videoCodec, 'h264')
  assert.equal(finalRender.artifact.mediaProbe.pixelFormat, 'yuv420p')
  assert.deepEqual(finalRender.artifact.mediaProbe.frameRate, { numerator: 25, denominator: 1 })
  assert.equal(finalRender.artifact.mediaProbe.audioCodec, 'aac')
  assert.equal(finalRender.artifact.mediaProbe.audioSampleRateHz, 48000)
  assert.equal(finalRender.artifact.mediaProbe.audioChannels, 2)
  const finalArtifact = fs.readFileSync(path.join(workspace, finalRender.artifact.relativePath))
  assert.equal(finalRender.artifact.sha256, qualifiedSha256(finalArtifact))
  assert.equal(finalRender.artifact.byteSize, finalArtifact.byteLength)

  const staleBody = {
    ...checkpointBody,
    operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b11',
    outputRelativePath: 'artifacts/demo/stale.webm',
  }
  await jsonRequest('/v1/checkpoint-operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'checkpoint-stale' },
    body: JSON.stringify(staleBody),
  })
  let staleOperation
  for (let attempt = 0; attempt < 80; attempt++) {
    staleOperation = (await jsonRequest(`/v1/checkpoint-operations/${staleBody.operationId}`)).body
      .operation
    if (staleOperation.state === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(staleOperation?.error?.code, 'REVISION_CONFLICT')

  const renderedRequest = fetch(`http://127.0.0.1:${port}/v1/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Long enough that the /v1/status poll below reliably lands inside the
    // render window; a 1-second render can finish between two polls.
    body: JSON.stringify({ project: 'demo', duration: 3, codec: 'vp9' }),
  })
  let observedOperation
  for (let attempt = 0; attempt < 400; attempt++) {
    const currentStatus = (await jsonRequest('/v1/status')).body
    if (
      currentStatus.activeOperation?.kind === 'render' &&
      currentStatus.activeOperation.progress
    ) {
      observedOperation = currentStatus.activeOperation
      assert.equal(currentStatus.state, 'ready')
      assert.equal(currentStatus.queue.active, 1)
      assert.equal(typeof observedOperation.progress.phase, 'string')
      assert.ok(observedOperation.progress.progress >= 0)
      assert.ok(observedOperation.progress.progress <= 100)
      if (
        observedOperation.progress.currentFrame !== undefined &&
        observedOperation.progress.totalFrames !== undefined
      ) {
        assert.ok(observedOperation.progress.currentFrame <= observedOperation.progress.totalFrames)
      }
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const renderedResponse = await renderedRequest
  assert.equal(renderedResponse.status, 200)
  assert.match(renderedResponse.headers.get('content-type') ?? '', /^video\/webm(?:;|$)/)
  assert.ok((await renderedResponse.arrayBuffer()).byteLength > 0)
  assert.ok(observedOperation, 'render progress was never observable through /v1/status')
  const completedStatus = (await jsonRequest('/v1/status')).body
  assert.equal(completedStatus.activeOperation, null)
  assert.equal(completedStatus.lastOperation.kind, 'render')
  assert.equal(completedStatus.lastOperation.state, 'succeeded')
  assert.equal(completedStatus.lastOperation.id, observedOperation.id)
} finally {
  const exited = new Promise((resolve) => service.once('exit', () => resolve(true)))
  service.kill('SIGTERM')
  const didExit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ])
  assert.equal(didExit, true, 'service did not exit after SIGTERM')
  // Windows TerminateProcess does not run Node exit hooks. The test owns this
  // workspace and has confirmed the writer PID exited, so its lock is stale.
  const lockPath = path.join(workspace, '.freecut-headless', 'writer.lock')
  if (process.platform === 'win32') fs.rmSync(lockPath, { force: true })
  else assert.equal(fs.existsSync(lockPath), false, 'writer lock survived graceful shutdown')
}

const restartPort = port + 1
const restartedService = spawn(
  process.execPath,
  ['headless/serve.mjs', '--workspace', workspace, '--port', String(restartPort)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let restartLog = ''
restartedService.stdout.on('data', (chunk) => {
  restartLog += chunk
})
restartedService.stderr.on('data', (chunk) => {
  restartLog += chunk
})
try {
  let restartedStatus
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${restartPort}/v1/status`)
      if (response.ok) {
        restartedStatus = await response.json()
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(restartedStatus?.state, 'ready', restartLog)
  assert.equal(restartedStatus.lastOperation, null)
  assert.notEqual(restartedStatus.instanceId, initialStatus.instanceId)
  const restartedProjectResponse = await fetch(`http://127.0.0.1:${restartPort}/v1/projects/demo`)
  assert.equal(restartedProjectResponse.status, 200)
  const restartedProject = await restartedProjectResponse.json()
  assert.equal(restartedProject.revision, checkpoint.resultingRevision)
  assert.equal(restartedProject.project.timeline.items[0].from, 9)
  assert.equal(restartedProject.project.checkpointApplicationReceipts, undefined)
  const restartedCheckpointResponse = await fetch(
    `http://127.0.0.1:${restartPort}/v1/checkpoint-operations/${checkpoint.operationId}`,
  )
  assert.equal(restartedCheckpointResponse.status, 200)
  assert.equal((await restartedCheckpointResponse.json()).operation.state, 'succeeded')
  const restartedFinalRenderResponse = await fetch(
    `http://127.0.0.1:${restartPort}/v1/checkpoint-operations/${finalRenderBody.operationId}`,
  )
  assert.equal(restartedFinalRenderResponse.status, 200)
  const restartedFinalRender = (await restartedFinalRenderResponse.json()).operation
  assert.equal(restartedFinalRender.state, 'succeeded')
  assert.deepEqual(restartedFinalRender.artifact.mediaProbe, finalRender.artifact.mediaProbe)
} finally {
  const exited = new Promise((resolve) => restartedService.once('exit', () => resolve(true)))
  restartedService.kill('SIGTERM')
  const didExit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ])
  assert.equal(didExit, true, 'restarted service did not exit after SIGTERM')
  if (process.platform === 'win32')
    fs.rmSync(path.join(workspace, '.freecut-headless', 'writer.lock'), { force: true })
}

try {
  const source = path.join(workspace, 'tone.wav')
  const output = path.join(workspace, 'rendered.wav')
  const ops = path.join(workspace, 'add-tone.json')
  generateToneWav(source)
  fs.writeFileSync(
    ops,
    JSON.stringify([
      { callerId: 'tone', op: 'addClip', mediaId: 'tone_1', from: 0, durationInFrames: 15 },
    ]),
  )
  const imported = runAgent([
    'media',
    'import',
    '--workspace',
    workspace,
    '--file',
    source,
    '--id',
    'tone_1',
    '--project',
    'demo',
  ])
  assert.equal(imported.media.metadata.mimeType, 'audio/wav')
  const current = runAgent(['project', 'get', '--workspace', workspace, '--id', 'demo'])
  const edited = runAgent([
    'project',
    'edit',
    '--workspace',
    workspace,
    '--id',
    'demo',
    '--ops',
    ops,
    '--persist',
    '--expected-revision',
    current.revision,
  ])
  assert.equal(edited.persisted, true)
  const rendered = runAgent([
    'render',
    '--workspace',
    workspace,
    '--project',
    'demo',
    '--out',
    output,
    '--audio-only',
    '--container',
    'wav',
    '--duration',
    '0.5',
  ])
  assert.equal(rendered.ok, true)
  assert.ok(fs.statSync(output).size > 1_000)
  console.log('Lifecycle HTTP + CLI import/edit/render checks passed')
} finally {
  fs.rmSync(workspace, { recursive: true, force: true })
}

const corruptWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-corrupt-checkpoint-'))
try {
  const operationRoot = path.join(corruptWorkspace, '.freecut-headless', 'checkpoint-operations')
  fs.mkdirSync(operationRoot, { recursive: true })
  fs.writeFileSync(
    path.join(operationRoot, '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10.json'),
    '{ corrupt durable record',
  )
  const corruptService = spawn(
    process.execPath,
    ['headless/serve.mjs', '--workspace', corruptWorkspace, '--port', String(port + 2)],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let corruptLog = ''
  corruptService.stdout.on('data', (chunk) => {
    corruptLog += chunk
  })
  corruptService.stderr.on('data', (chunk) => {
    corruptLog += chunk
  })
  const exitCode = await Promise.race([
    new Promise((resolve) => corruptService.once('exit', resolve)),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ])
  if (exitCode === 'timeout') corruptService.kill('SIGKILL')
  assert.notEqual(exitCode, 'timeout', 'service became stuck on corrupt checkpoint state')
  assert.notEqual(exitCode, 0, `service became ready with corrupt checkpoint state:\n${corruptLog}`)
  assert.match(corruptLog, /SyntaxError|JSON|Checkpoint record is corrupt/)
} finally {
  fs.rmSync(corruptWorkspace, { recursive: true, force: true })
}
