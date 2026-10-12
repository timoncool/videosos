import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { capabilities, mediaImportRequestSchema } from './lib/contract.mjs'
import { withIdempotency } from './lib/idempotency.mjs'
import { importWorkspaceMedia, requestHashOf, workspaceFingerprint } from './lib/media-import.mjs'
import { createProjectResource, getMediaResource } from './lib/lifecycle-store.mjs'

const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`
const probe = async () => ({
  mimeType: 'video/mp4',
  metadata: {
    type: 'video',
    width: 1080,
    height: 1920,
    duration: 12.345,
    fps: 29.97,
    codec: 'h264',
    audioCodec: 'aac',
    videoCodecSupported: true,
    audioCodecSupported: true,
  },
})

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-import-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(root, '.freecut-workspace.json'),
    '{"schemaVersion":"2.0","createdAt":1}\n',
  )
  fs.mkdirSync(path.join(root, 'recording'))
  return root
}

function fixture(root, name = 'source.mp4', bytes = Buffer.from('video-source')) {
  fs.writeFileSync(path.join(root, 'recording', name), bytes)
  return {
    body: {
      mediaId: 'media_1',
      sourceRelativePath: `recording/${name}`,
      expectedByteSize: bytes.length,
      expectedSha256: sha256(bytes),
    },
    bytes,
  }
}

const project = {
  id: 'project_1',
  name: 'Project',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  schemaVersion: 14,
  metadata: { width: 1080, height: 1920, fps: 30 },
}

test('media import schema is strict and rejects unsafe POSIX and Windows paths', () => {
  const valid = {
    mediaId: 'media_1',
    sourceRelativePath: 'recording/ролик 1.mp4',
    expectedByteSize: 1,
    expectedSha256: `sha256:${'a'.repeat(64)}`,
  }
  assert.equal(mediaImportRequestSchema.safeParse(valid).success, true)
  for (const sourceRelativePath of [
    '/tmp/a.mp4',
    '../a.mp4',
    'recording/../a.mp4',
    'C:\\a.mp4',
    '\\\\server\\share\\a.mp4',
    '\\\\?\\C:\\a.mp4',
    'recording\\a.mp4',
    'recording//a.mp4',
    'recording/\0a.mp4',
  ]) {
    assert.equal(
      mediaImportRequestSchema.safeParse({ ...valid, sourceRelativePath }).success,
      false,
      sourceRelativePath,
    )
  }
  assert.equal(mediaImportRequestSchema.safeParse({ ...valid, extra: true }).success, false)
  assert.equal(
    mediaImportRequestSchema.safeParse({ ...valid, expectedSha256: 'a'.repeat(64) }).success,
    false,
  )
})

test('workspace identity hashes exact marker bytes and capabilities advertise import', async (t) => {
  const root = workspace(t)
  const marker = fs.readFileSync(path.join(root, '.freecut-workspace.json'))
  assert.deepEqual(await workspaceFingerprint(root), {
    schemaVersion: '2.0',
    fingerprint: sha256(marker),
  })
  assert.ok(capabilities().lifecycle.routes.includes('POST /v1/media/import'))
  assert.ok(capabilities().schemas.mediaImport)
  fs.writeFileSync(path.join(root, '.freecut-workspace.json'), '{bad')
  assert.equal(await workspaceFingerprint(root), null)
  fs.writeFileSync(path.join(root, '.freecut-workspace.json'), Buffer.alloc(64 * 1024 + 1, 1))
  assert.equal(await workspaceFingerprint(root), null)
  fs.rmSync(path.join(root, '.freecut-workspace.json'))
  fs.writeFileSync(path.join(root, 'marker-target.json'), '{"schemaVersion":"2.0"}')
  fs.symlinkSync('marker-target.json', path.join(root, '.freecut-workspace.json'))
  assert.equal(await workspaceFingerprint(root), null)
})

test('imports, probes, promotes atomically, associates a real project, and returns no absolute path', async (t) => {
  const root = workspace(t)
  const { body, bytes } = fixture(root, 'ролик.mp4')
  await createProjectResource(root, project)
  body.projectId = project.id
  const raw = Buffer.from(JSON.stringify(body))
  const result = await importWorkspaceMedia(root, body, {
    requestHash: requestHashOf(raw),
    probe,
  })
  assert.equal(result.status, 201)
  assert.deepEqual(Object.keys(result.response).sort(), [
    'apiVersion',
    'byteSize',
    'mediaId',
    'ok',
    'probe',
    'revision',
    'sourceSha256',
  ])
  assert.deepEqual(result.response.probe, {
    width: 1080,
    height: 1920,
    durationMs: 12345,
    frameRateNumerator: 2997,
    frameRateDenominator: 100,
    videoCodec: 'h264',
    audioCodec: 'aac',
  })
  assert.equal(JSON.stringify(result.response).includes(root), false)
  const media = await getMediaResource(root, body.mediaId)
  assert.equal(media.metadata.sourceSha256, sha256(bytes))
  assert.equal(media.metadata.audioCodec, 'aac')
  assert.equal(media.metadata.audioCodecSupported, true)
  assert.equal(media.metadata.videoCodecSupported, true)
  assert.deepEqual(media.projectIds, [project.id])
  assert.deepEqual(fs.readFileSync(path.join(root, 'media', body.mediaId, 'ролик.mp4')), bytes)
  assert.equal(
    fs.existsSync(path.join(root, '.freecut-headless', 'media-imports', requestHashOf(raw))),
    false,
  )
})

test('idempotency exact replay, payload conflict, and matching existing adoption are safe', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const raw = Buffer.from(JSON.stringify(body))
  let probes = 0
  const execute = ({ requestHash }) =>
    importWorkspaceMedia(root, body, {
      requestHash,
      probe: async (staged) => {
        probes++
        return probe(staged)
      },
    })
  const first = await withIdempotency(
    root,
    {
      key: 'key-1',
      method: 'POST',
      route: '/v1/media/import',
      requestBytes: raw,
    },
    execute,
  )
  const replay = await withIdempotency(
    root,
    {
      key: 'key-1',
      method: 'POST',
      route: '/v1/media/import',
      requestBytes: raw,
    },
    execute,
  )
  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.response, first.response)
  assert.equal(probes, 1)
  await assert.rejects(
    () =>
      withIdempotency(
        root,
        {
          key: 'key-1',
          method: 'POST',
          route: '/v1/media/import',
          requestBytes: Buffer.from(JSON.stringify({ ...body, projectId: 'other' })),
        },
        execute,
      ),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  )
  const adopted = await importWorkspaceMedia(root, body, {
    requestHash: requestHashOf(Buffer.from('different-key')),
    probe: async () => {
      throw new Error('must not probe')
    },
  })
  assert.equal(adopted.status, 200)
  assert.deepEqual(adopted.response, first.response)
})

test('crash-left pending idempotency receipt is reconciled through the route operation', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const raw = Buffer.from(JSON.stringify(body))
  const key = 'crash-key'
  const keyHash = crypto.createHash('sha256').update(key).digest('hex')
  const requestHash = requestHashOf(raw)
  const ledgerDir = path.join(root, '.freecut-headless', 'idempotency')
  fs.mkdirSync(ledgerDir, { recursive: true })
  fs.writeFileSync(
    path.join(ledgerDir, `${keyHash}.json`),
    JSON.stringify({
      method: 'POST',
      route: '/v1/media/import',
      requestHash,
      state: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )
  const execute = ({ requestHash: hash }) =>
    importWorkspaceMedia(root, body, { requestHash: hash, probe })
  const recovered = await withIdempotency(
    root,
    {
      key,
      method: 'POST',
      route: '/v1/media/import',
      requestBytes: raw,
      recoverPending: execute,
    },
    execute,
  )
  assert.equal(recovered.replayed, true)
  assert.equal(
    (await getMediaResource(root, body.mediaId)).metadata.sourceSha256,
    body.expectedSha256,
  )
  const receipt = JSON.parse(fs.readFileSync(path.join(ledgerDir, `${keyHash}.json`), 'utf8'))
  assert.equal(receipt.state, 'complete')
})

test('rejects symlinks, hash/size mismatch, missing identity, and leaves no partial media', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const run = (value, probeFn = probe) =>
    importWorkspaceMedia(root, value, {
      requestHash: requestHashOf(Buffer.from(JSON.stringify(value))),
      probe: probeFn,
    })
  await assert.rejects(
    () => run({ ...body, expectedByteSize: body.expectedByteSize + 1 }),
    (e) => e.code === 'MEDIA_SIZE_MISMATCH',
  )
  await assert.rejects(
    () => run({ ...body, expectedSha256: `sha256:${'0'.repeat(64)}` }),
    (e) => e.code === 'MEDIA_HASH_MISMATCH',
  )
  const link = path.join(root, 'recording', 'link.mp4')
  fs.symlinkSync(path.join(root, 'recording', 'source.mp4'), link)
  await assert.rejects(
    () => run({ ...body, sourceRelativePath: 'recording/link.mp4' }),
    (e) => e.code === 'INVALID_MEDIA_SOURCE',
  )
  await assert.rejects(
    () =>
      run(body, async () => {
        throw new Error('probe failed')
      }),
    /probe failed/,
  )
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), false)
  fs.writeFileSync(path.join(root, '.freecut-workspace.json'), '{bad')
  await assert.rejects(
    () => run(body),
    (e) => e.code === 'WORKSPACE_IDENTITY_UNAVAILABLE',
  )
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), false)
})

test('project association fails before media mutation when the project is absent', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  body.projectId = 'missing_project'
  await assert.rejects(
    () =>
      importWorkspaceMedia(root, body, {
        requestHash: requestHashOf(Buffer.from(JSON.stringify(body))),
        probe,
      }),
    (error) => error.code === 'PROJECT_NOT_FOUND',
  )
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), false)
})

test('concurrent imports serialize project media-links without losing either media id', async (t) => {
  const root = workspace(t)
  await createProjectResource(root, project)
  const first = fixture(root, 'first.mp4', Buffer.from('first-video')).body
  const second = fixture(root, 'second.mp4', Buffer.from('second-video')).body
  first.projectId = project.id
  second.mediaId = 'media_2'
  second.projectId = project.id
  await Promise.all(
    [first, second].map((body) =>
      importWorkspaceMedia(root, body, {
        requestHash: requestHashOf(Buffer.from(JSON.stringify(body))),
        probe,
      }),
    ),
  )
  const links = JSON.parse(
    fs.readFileSync(path.join(root, 'projects', project.id, 'media-links.json'), 'utf8'),
  )
  assert.deepEqual(links.mediaIds.map((entry) => entry.id).sort(), ['media_1', 'media_2'])
})

test('post-promotion failures retain pending idempotency and retry reconciles after repair', async (t) => {
  const root = workspace(t)
  await createProjectResource(root, project)
  const { body } = fixture(root)
  body.projectId = project.id
  fs.writeFileSync(path.join(root, 'projects', project.id, 'media-links.json'), '{malformed')
  const raw = Buffer.from(JSON.stringify(body))
  const key = 'post-commit-key'
  const keyHash = crypto.createHash('sha256').update(key).digest('hex')
  const execute = ({ requestHash }) => importWorkspaceMedia(root, body, { requestHash, probe })
  await assert.rejects(
    () =>
      withIdempotency(
        root,
        {
          key,
          method: 'POST',
          route: '/v1/media/import',
          requestBytes: raw,
          recoverPending: execute,
        },
        execute,
      ),
    SyntaxError,
  )
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), true)
  const ledger = path.join(root, '.freecut-headless', 'idempotency', `${keyHash}.json`)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'pending')
  fs.writeFileSync(
    path.join(root, 'projects', project.id, 'media-links.json'),
    JSON.stringify({ version: '1.0', mediaIds: [] }),
  )
  const recovered = await withIdempotency(
    root,
    {
      key,
      method: 'POST',
      route: '/v1/media/import',
      requestBytes: raw,
      recoverPending: execute,
    },
    execute,
  )
  assert.equal(recovered.replayed, true)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'complete')
  assert.deepEqual((await getMediaResource(root, body.mediaId)).projectIds, [project.id])
})

test('promotion fsyncs both rename parents before an injected crash boundary', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const raw = Buffer.from(JSON.stringify(body))
  const key = 'fsync-crash-key'
  const keyHash = crypto.createHash('sha256').update(key).digest('hex')
  const synced = []
  const execute = ({ requestHash }) =>
    importWorkspaceMedia(root, body, {
      requestHash,
      probe,
      syncDirectoryFn: async (directory) => synced.push(directory),
      afterPromotion: async () => {
        throw new Error('injected crash')
      },
    })
  await assert.rejects(
    () =>
      withIdempotency(
        root,
        { key, method: 'POST', route: '/v1/media/import', requestBytes: raw },
        execute,
      ),
    /injected crash/,
  )
  assert.deepEqual(
    synced.map((directory) => path.basename(directory)),
    [path.basename(root), requestHashOf(raw), 'media'],
  )
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), true)
  const ledger = path.join(root, '.freecut-headless', 'idempotency', `${keyHash}.json`)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'pending')
})

test('the staged media blob is flushed before any durable record describes it', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const raw = Buffer.from(JSON.stringify(body))
  const events = []
  await assert.rejects(
    () =>
      importWorkspaceMedia(root, body, {
        requestHash: requestHashOf(raw),
        probe,
        syncFileFn: async (file) => events.push(`sync:${path.basename(file)}`),
        afterPromotion: async () => {
          events.push('promoted')
          throw new Error('injected crash')
        },
      }),
    /injected crash/,
  )
  // The blob's own store is flushed before the promotion boundary, so a crash
  // right after it cannot leave a promoted file whose bytes never landed.
  assert.deepEqual(events, ['sync:source.mp4', 'promoted'])
  assert.equal(fs.existsSync(path.join(root, 'media', body.mediaId)), true)
})

test('tampered or colliding deterministic media ids fail closed', async (t) => {
  const root = workspace(t)
  const { body } = fixture(root)
  const raw = Buffer.from(JSON.stringify(body))
  await importWorkspaceMedia(root, body, { requestHash: requestHashOf(raw), probe })
  fs.writeFileSync(path.join(root, 'media', body.mediaId, 'source.mp4'), 'tampered')
  await assert.rejects(
    () =>
      importWorkspaceMedia(root, body, { requestHash: requestHashOf(Buffer.from('new')), probe }),
    (error) => error.code === 'MEDIA_ID_CONFLICT',
  )
  const different = fixture(root, 'other.mp4', Buffer.from('different-content')).body
  different.mediaId = body.mediaId
  await assert.rejects(
    () =>
      importWorkspaceMedia(root, different, {
        requestHash: requestHashOf(Buffer.from('other')),
        probe,
      }),
    (error) => error.code === 'MEDIA_ID_CONFLICT',
  )
})
