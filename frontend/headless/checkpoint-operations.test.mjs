import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalJsonBytes, qualifiedSha256 } from './lib/contract.mjs'
import { FINAL_RENDER_PROFILE, FINAL_RENDER_PROFILE_SHA256 } from './lib/contract.mjs'
import {
  atomicWriteFile,
  createProjectResource,
  getProjectResource,
  revisionOf,
  saveProjectResourceWithCheckpointReceipt,
} from './lib/lifecycle-store.mjs'
import {
  CheckpointProcessCrash,
  createCheckpointOperationRunner,
  createCheckpointOperationStore,
  resolveCheckpointOutputPath,
} from './lib/checkpoint-operations.mjs'

const OPERATION_ID = '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10'
const tempWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-checkpoint-'))
const projectPath = (root) => path.join(root, 'projects', 'p1', 'project.json')
const finalMediaProbe = (overrides = {}) => ({
  width: 1080,
  height: 1920,
  durationMillis: 2000,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  frameRate: { numerator: 25, denominator: 1 },
  audioCodec: 'aac',
  audioSampleRateHz: 48000,
  audioChannels: 2,
  ...overrides,
})

function request() {
  const recipe = {
    schemaVersion: '1.1',
    operations: [{ callerId: 'clip_1', op: 'addClip', mediaId: 'm1' }],
    render: { codec: 'h264', container: 'mp4', quality: 'high' },
  }
  return {
    operationId: OPERATION_ID,
    projectId: 'p1',
    expectedRevision: '',
    recipe,
    recipeSha256: qualifiedSha256(canonicalJsonBytes(recipe)),
    outputRelativePath: 'artifacts/p1/checkpoint.mp4',
  }
}

function finalRenderRequest(expectedRevision) {
  return {
    kind: 'final_render',
    operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b11',
    projectId: 'p1',
    expectedRevision,
    renderProfile: structuredClone(FINAL_RENDER_PROFILE),
    renderProfileSha256: FINAL_RENDER_PROFILE_SHA256,
    approvalBindingSha256: `sha256:${'a'.repeat(64)}`,
    outputRelativePath: 'artifacts/p1/final.mp4',
  }
}

async function finalRenderHarness(root, { crashAt, mutateBeforeRender } = {}) {
  const file = projectPath(root)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file))
    await atomicWriteFile(file, Buffer.from(`${JSON.stringify({ id: 'p1' }, null, 2)}\n`))
  const loadProject = async () => {
    const bytes = await fs.promises.readFile(file)
    return { project: JSON.parse(bytes), revision: revisionOf(bytes) }
  }
  const req = finalRenderRequest((await loadProject()).revision)
  const store = createCheckpointOperationStore({ workspace: root })
  let renders = 0
  const runner = createCheckpointOperationRunner({
    store,
    loadProject,
    applyRecipe: async () => assert.fail('final render must not apply a recipe'),
    commitProject: async () => assert.fail('final render must not commit a project'),
    renderArtifact: async ({ tempPath, renderProfile }) => {
      renders++
      assert.deepEqual(renderProfile, FINAL_RENDER_PROFILE)
      await mutateBeforeRender?.({ file, loadProject })
      await fs.promises.writeFile(tempPath, 'fixed-final-render')
      return { mimeType: 'video/mp4' }
    },
    probeFinalRenderArtifact: async () => finalMediaProbe(),
    onBoundary: async (name) => {
      if (name === crashAt) throw new CheckpointProcessCrash(name)
    },
  })
  return { req, store, runner, loadProject, counts: () => ({ renders }) }
}

async function harness(root, { crashAt, syncArtifactDirectory } = {}) {
  const file = projectPath(root)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file))
    await atomicWriteFile(
      file,
      Buffer.from(`${JSON.stringify({ id: 'p1', clips: [] }, null, 2)}\n`),
    )
  const req = request()
  req.expectedRevision = revisionOf(await fs.promises.readFile(file))
  const store = createCheckpointOperationStore({ workspace: root })
  let applications = 0
  let renders = 0
  const loadProject = async () => {
    const bytes = await fs.promises.readFile(file)
    const project = JSON.parse(bytes)
    return {
      project,
      revision: revisionOf(bytes),
      receipt: project.checkpointApplicationReceipts?.[OPERATION_ID],
    }
  }
  const runner = createCheckpointOperationRunner({
    store,
    loadProject,
    applyRecipe: async ({ project }) => {
      applications++
      project.clips.push('m1')
      return project
    },
    commitProject: async ({ project, receipt, expectedRevision }) => {
      assert.equal((await loadProject()).revision, expectedRevision)
      const committedReceipt = {
        ...receipt,
        appliedProjectSha256: qualifiedSha256(canonicalJsonBytes(project)),
      }
      project.checkpointApplicationReceipts = { [OPERATION_ID]: committedReceipt }
      const bytes = Buffer.from(`${JSON.stringify(project, null, 2)}\n`)
      await atomicWriteFile(file, bytes)
      return { revision: revisionOf(bytes), receipt: committedReceipt }
    },
    renderArtifact: async ({ tempPath, revision }) => {
      renders++
      await fs.promises.writeFile(tempPath, `render:${revision}`)
      return { mimeType: 'video/mp4' }
    },
    ...(syncArtifactDirectory ? { syncArtifactDirectory } : {}),
    onBoundary: async (name) => {
      if (name === crashAt) throw new CheckpointProcessCrash(name)
    },
  })
  return { req, store, runner, counts: () => ({ applications, renders }), loadProject }
}

test('submission durably binds canonical request to operation ID and idempotency key', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { req, store } = await harness(root)
  const first = await store.submit({ request: req, idempotencyKey: 'key-1' })
  assert.equal(first.created, true)
  assert.equal(first.operation.requestSha256, qualifiedSha256(canonicalJsonBytes(req)))
  assert.equal(JSON.parse(first.operation.canonicalRequest).operationId, OPERATION_ID)
  assert.equal((await store.submit({ request: req, idempotencyKey: 'key-1' })).created, false)
  let mutableValidationCalls = 0
  const replay = await store.submit({
    request: req,
    idempotencyKey: 'key-1',
    beforeCreate: async () => {
      mutableValidationCalls++
      throw new Error('mutable dependency disappeared')
    },
  })
  assert.equal(replay.created, false)
  assert.equal(mutableValidationCalls, 0)
  const outside = tempWorkspace()
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  fs.symlinkSync(outside, path.join(root, 'artifacts'))
  const replayAfterFilesystemChange = await store.submit({
    request: req,
    idempotencyKey: 'key-1',
    beforeCreate: async () => {
      mutableValidationCalls++
    },
  })
  assert.equal(replayAfterFilesystemChange.created, false)
  assert.equal(mutableValidationCalls, 0)
  fs.unlinkSync(path.join(root, 'artifacts'))
  const newRequest = { ...req, operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b12' }
  await assert.rejects(
    () =>
      store.submit({
        request: newRequest,
        idempotencyKey: 'new-key',
        beforeCreate: async () => {
          mutableValidationCalls++
          throw new Error('mutable dependency disappeared')
        },
      }),
    /mutable dependency disappeared/,
  )
  assert.equal(mutableValidationCalls, 1)
  await assert.rejects(
    () => store.get(newRequest.operationId),
    (error) => error.statusCode === 404,
  )
  await assert.rejects(
    () =>
      store.submit({
        request: { ...req, outputRelativePath: 'artifacts/p1/other.mp4' },
        idempotencyKey: 'key-1',
      }),
    (error) => error.code === 'CHECKPOINT_IDEMPOTENCY_CONFLICT',
  )
  assert.equal(
    (await store.submit({ request: req, idempotencyKey: 'key-2' })).operation.operationId,
    OPERATION_ID,
  )
  const changedOperation = { ...req, operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b11' }
  await assert.rejects(
    () => store.submit({ request: changedOperation, idempotencyKey: 'key-2' }),
    (error) => error.code === 'CHECKPOINT_IDEMPOTENCY_CONFLICT',
  )
  await Promise.all([
    store.submit({ request: req, idempotencyKey: 'key-3' }),
    store.update(OPERATION_ID, (record) => ({
      ...record,
      phase: 'applying_recipe',
      state: 'running',
    })),
  ])
  const concurrentlyUpdated = await store.get(OPERATION_ID)
  assert.equal(concurrentlyUpdated.phase, 'applying_recipe')
  assert.equal(concurrentlyUpdated.idempotencyKeyHashes.length, 3)
})

test('final render follows render-only durable phases and exact replay semantics', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const setup = await finalRenderHarness(root)
  const seen = []
  const runner = createCheckpointOperationRunner({
    store: setup.store,
    loadProject: setup.loadProject,
    applyRecipe: async () => assert.fail(),
    commitProject: async () => assert.fail(),
    renderArtifact: async ({ tempPath }) => {
      await fs.promises.writeFile(tempPath, 'fixed-final-render')
      return { mimeType: 'video/mp4' }
    },
    probeFinalRenderArtifact: async () => finalMediaProbe(),
    onBoundary: async (name) => seen.push(name),
  })
  await setup.store.submit({ request: setup.req, idempotencyKey: 'final-key' })
  assert.equal(
    (await setup.store.submit({ request: setup.req, idempotencyKey: 'final-key' })).created,
    false,
  )
  await assert.rejects(
    () =>
      setup.store.submit({
        request: { ...setup.req, approvalBindingSha256: `sha256:${'b'.repeat(64)}` },
        idempotencyKey: 'final-key',
      }),
    (error) => error.code === 'CHECKPOINT_IDEMPOTENCY_CONFLICT',
  )
  const operation = await runner.execute(setup.req.operationId)
  assert.equal(operation.phase, 'succeeded')
  assert.deepEqual(operation.artifact.mediaProbe, finalMediaProbe())
  assert.deepEqual(
    seen.filter((name) => name.startsWith('after_') && !name.includes('pending')),
    [
      'after_revision_verified',
      'after_rendering',
      'after_render',
      'after_artifact_rename',
      'after_artifact_committed',
      'after_succeeded',
    ],
  )
})

test('final render re-verifies revision immediately before render and fails closed on probe mismatch', async (t) => {
  await t.test('revision changed before renderer call', async (t) => {
    const root = tempWorkspace()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const setup = await finalRenderHarness(root, { crashAt: 'after_rendering' })
    await setup.store.submit({ request: setup.req, idempotencyKey: 'revision-change' })
    await assert.rejects(() => setup.runner.execute(setup.req.operationId), CheckpointProcessCrash)
    await atomicWriteFile(
      projectPath(root),
      Buffer.from(`${JSON.stringify({ id: 'p1', changed: true })}\n`),
    )
    const recovered = await finalRenderHarness(root)
    const operation = await recovered.runner.execute(setup.req.operationId)
    assert.equal(operation.phase, 'failed')
    assert.equal(operation.error.code, 'RENDER_REVISION_MISMATCH')
    assert.equal(recovered.counts().renders, 0)
  })

  await t.test('fixed profile probe mismatch', async (t) => {
    const root = tempWorkspace()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const setup = await finalRenderHarness(root)
    await setup.store.submit({ request: setup.req, idempotencyKey: 'probe-mismatch' })
    const runner = createCheckpointOperationRunner({
      store: setup.store,
      loadProject: setup.loadProject,
      applyRecipe: async () => assert.fail(),
      commitProject: async () => assert.fail(),
      renderArtifact: async ({ tempPath }) => {
        await fs.promises.writeFile(tempPath, 'wrong-profile')
        return { mimeType: 'video/mp4' }
      },
      probeFinalRenderArtifact: async () => finalMediaProbe({ width: 1920, height: 1080 }),
    })
    const operation = await runner.execute(setup.req.operationId)
    assert.equal(operation.phase, 'failed')
    assert.equal(operation.error.code, 'RENDER_PROFILE_MISMATCH')
    assert.equal(fs.existsSync(path.join(root, setup.req.outputRelativePath)), false)
  })
})

test('final render restart never promotes merely rendered or unbound files to success', async (t) => {
  await t.test('crash after render reruns from durable evidence', async (t) => {
    const root = tempWorkspace()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const crashed = await finalRenderHarness(root, { crashAt: 'after_render' })
    await crashed.store.submit({ request: crashed.req, idempotencyKey: 'render-crash' })
    await assert.rejects(
      () => crashed.runner.execute(crashed.req.operationId),
      CheckpointProcessCrash,
    )
    assert.equal((await crashed.store.get(crashed.req.operationId)).phase, 'rendering')
    const recovered = await finalRenderHarness(root)
    const operation = await recovered.runner.execute(crashed.req.operationId)
    assert.equal(operation.phase, 'succeeded')
    assert.equal(crashed.counts().renders + recovered.counts().renders, 2)
  })

  await t.test('unbound final file is a collision', async (t) => {
    const root = tempWorkspace()
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const setup = await finalRenderHarness(root)
    await setup.store.submit({ request: setup.req, idempotencyKey: 'file-only' })
    const finalPath = path.join(root, setup.req.outputRelativePath)
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true })
    await fs.promises.writeFile(finalPath, 'file-only')
    const operation = await setup.runner.execute(setup.req.operationId)
    assert.equal(operation.phase, 'failed')
    assert.equal(operation.error.code, 'ARTIFACT_COLLISION')
    assert.equal(setup.counts().renders, 0)
  })
})

test('final render preserves observed media probe across every crash/restart boundary', async (t) => {
  const boundaries = [
    'after_revision_verified',
    'after_rendering',
    'after_render',
    'after_pending_artifact',
    'after_artifact_rename',
    'after_artifact_committed',
    'after_succeeded',
  ]
  for (const crashAt of boundaries) {
    await t.test(crashAt, async (t) => {
      const root = tempWorkspace()
      t.after(() => fs.rmSync(root, { recursive: true, force: true }))
      const crashed = await finalRenderHarness(root, { crashAt })
      await crashed.store.submit({ request: crashed.req, idempotencyKey: `final-${crashAt}` })
      await assert.rejects(
        () => crashed.runner.execute(crashed.req.operationId),
        CheckpointProcessCrash,
      )
      const recovered = await finalRenderHarness(root)
      const results = await recovered.runner.reconcile()
      const operation = results[0] ?? (await recovered.store.get(crashed.req.operationId))
      assert.equal(operation.phase, 'succeeded')
      assert.deepEqual(operation.pendingArtifact.mediaProbe, finalMediaProbe())
      assert.deepEqual(operation.artifact.mediaProbe, finalMediaProbe())
      const bytes = await fs.promises.readFile(path.join(root, operation.artifact.relativePath))
      assert.equal(operation.artifact.sha256, qualifiedSha256(bytes))
    })
  }
})

test('reconcile adopts the exact project receipt after a crash without double application', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const crashed = await harness(root, { crashAt: 'after_project_write' })
  await crashed.store.submit({ request: crashed.req, idempotencyKey: 'key' })
  await assert.rejects(() => crashed.runner.execute(OPERATION_ID), CheckpointProcessCrash)
  assert.equal(crashed.counts().applications, 1)
  assert.deepEqual((await crashed.loadProject()).project.clips, ['m1'])

  const recovered = await harness(root)
  const [operation] = await recovered.runner.reconcile()
  assert.equal(operation.phase, 'succeeded')
  assert.equal(recovered.counts().applications, 0)
  assert.deepEqual((await recovered.loadProject()).project.clips, ['m1'])
})

test('real lifecycle store computes the receipt from exact persisted engine state', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const created = await createProjectResource(root, {
    id: 'p1',
    name: 'Before',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 30 },
  })
  const req = request()
  req.expectedRevision = created.revision
  const store = createCheckpointOperationStore({ workspace: root })
  await store.submit({ request: req, idempotencyKey: 'real-store' })
  let applications = 0
  const makeRunner = (crashAfterWrite) =>
    createCheckpointOperationRunner({
      store,
      loadProject: (projectId) => getProjectResource(root, projectId),
      applyRecipe: async ({ project }) => {
        applications++
        return { ...project, name: 'Applied' }
      },
      commitProject: ({ projectId, expectedRevision, project, receipt }) =>
        saveProjectResourceWithCheckpointReceipt(root, projectId, project, {
          expectedRevision,
          receipt,
        }),
      renderArtifact: async ({ tempPath }) => {
        await fs.promises.writeFile(tempPath, 'real-store-render')
        return { mimeType: 'video/mp4' }
      },
      onBoundary: async (boundary) => {
        if (crashAfterWrite && boundary === 'after_project_write') {
          throw new CheckpointProcessCrash(boundary)
        }
      },
    })
  await assert.rejects(() => makeRunner(true).execute(OPERATION_ID), CheckpointProcessCrash)
  const operation = await makeRunner(false).execute(OPERATION_ID)
  assert.equal(operation.phase, 'succeeded')
  assert.equal(applications, 1)
  assert.equal((await getProjectResource(root, 'p1')).project.name, 'Applied')
})

test('reconcile rejects a later project mutation that merely preserves the old receipt', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const crashed = await harness(root, { crashAt: 'after_project_write' })
  await crashed.store.submit({ request: crashed.req, idempotencyKey: 'key' })
  await assert.rejects(() => crashed.runner.execute(OPERATION_ID), CheckpointProcessCrash)
  const file = projectPath(root)
  const later = { ...(await crashed.loadProject()).project, name: 'foreign later edit' }
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(later, null, 2)}\n`))

  const recovered = await harness(root)
  const [operation] = await recovered.runner.reconcile()
  assert.equal(operation.phase, 'failed')
  assert.equal(operation.error.code, 'PROJECT_RECEIPT_MISMATCH')
  assert.equal(recovered.counts().applications, 0)
})

test('revision conflict fails closed with a safe durable error', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const setup = await harness(root)
  await setup.store.submit({ request: setup.req, idempotencyKey: 'key' })
  const file = projectPath(root)
  const changed = { ...(await setup.loadProject()).project, clips: ['foreign'] }
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(changed, null, 2)}\n`))
  const operation = await setup.runner.execute(OPERATION_ID)
  assert.equal(operation.phase, 'failed')
  assert.deepEqual(operation.error, {
    code: 'REVISION_CONFLICT',
    message: 'Project revision does not match expectedRevision',
  })
  assert.equal(setup.counts().applications, 0)
})

test('a receipt for the same operation with changed binding fails closed', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const setup = await harness(root)
  await setup.store.submit({ request: setup.req, idempotencyKey: 'key' })
  const file = projectPath(root)
  const changed = {
    ...(await setup.loadProject()).project,
    checkpointApplicationReceipts: {
      [OPERATION_ID]: {
        operationId: OPERATION_ID,
        requestSha256: `sha256:${'0'.repeat(64)}`,
        recipeSha256: setup.req.recipeSha256,
        priorRevision: setup.req.expectedRevision,
      },
    },
  }
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(changed, null, 2)}\n`))
  const operation = await setup.runner.execute(OPERATION_ID)
  assert.equal(operation.phase, 'failed')
  assert.equal(operation.error.code, 'PROJECT_RECEIPT_MISMATCH')
  assert.equal(setup.counts().applications, 0)
})

test('phase records missing required durable evidence are rejected as corrupt', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const setup = await harness(root)
  await setup.store.submit({ request: setup.req, idempotencyKey: 'key' })
  const recordFile = path.join(
    root,
    '.freecut-headless',
    'checkpoint-operations',
    `${OPERATION_ID}.json`,
  )
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
  await atomicWriteFile(
    recordFile,
    Buffer.from(
      `${JSON.stringify(
        {
          ...record,
          phase: 'artifact_committed',
          state: 'running',
          resultingRevision: setup.req.expectedRevision,
        },
        null,
        2,
      )}\n`,
    ),
  )
  await assert.rejects(
    () => setup.store.get(OPERATION_ID),
    (error) => error.code === 'CHECKPOINT_RECORD_CORRUPT',
  )
})

test('every durable runner boundary resumes safely and final collisions are never overwritten', async (t) => {
  const boundaries = [
    'after_applying_recipe',
    'after_project_write',
    'after_project_committed',
    'after_rendering',
    'after_render',
    'after_pending_artifact',
    'after_artifact_rename',
    'after_artifact_committed',
    'after_succeeded',
  ]
  for (const crashAt of boundaries) {
    await t.test(crashAt, async (t) => {
      const root = tempWorkspace()
      t.after(() => fs.rmSync(root, { recursive: true, force: true }))
      const crashed = await harness(root, { crashAt })
      await crashed.store.submit({ request: crashed.req, idempotencyKey: 'key' })
      await assert.rejects(() => crashed.runner.execute(OPERATION_ID), CheckpointProcessCrash)
      const recovered = await harness(root)
      const results = await recovered.runner.reconcile()
      const operation = results[0] ?? (await recovered.store.get(OPERATION_ID))
      assert.equal(operation.phase, 'succeeded')
      assert.ok(crashed.counts().applications + recovered.counts().applications <= 1)
      assert.equal((await recovered.loadProject()).project.clips.length, 1)
      const artifact = fs.readFileSync(path.join(root, operation.artifact.relativePath))
      assert.equal(qualifiedSha256(artifact), operation.artifact.sha256)
    })
  }

  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const setup = await harness(root)
  await setup.store.submit({ request: setup.req, idempotencyKey: 'key' })
  const final = path.join(root, setup.req.outputRelativePath)
  fs.mkdirSync(path.dirname(final), { recursive: true })
  fs.writeFileSync(final, 'foreign')
  const operation = await setup.runner.execute(OPERATION_ID)
  assert.equal(operation.phase, 'failed')
  assert.equal(operation.error.code, 'ARTIFACT_COLLISION')
  assert.equal(fs.readFileSync(final, 'utf8'), 'foreign')
})

test('a post-publication fsync failure remains retryable instead of terminally poisoning output', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let syncAttempts = 0
  const setup = await harness(root, {
    syncArtifactDirectory: async () => {
      syncAttempts++
      if (syncAttempts === 1) throw new Error('injected directory fsync failure')
    },
  })
  await setup.store.submit({ request: setup.req, idempotencyKey: 'key' })
  await assert.rejects(
    () => setup.runner.execute(OPERATION_ID),
    (error) => error.name === 'CheckpointRetryableError',
  )
  assert.equal((await setup.store.get(OPERATION_ID)).phase, 'rendering')
  assert.equal(fs.existsSync(path.join(root, setup.req.outputRelativePath)), true)
  const recovered = await setup.runner.execute(OPERATION_ID)
  assert.equal(recovered.phase, 'succeeded')
  assert.equal(syncAttempts, 2)
})

test('output containment rejects cross-platform traversal and symlink escapes', async (t) => {
  const root = tempWorkspace()
  const outside = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  for (const candidate of [
    '../escape.mp4',
    'artifacts/../escape.mp4',
    'artifacts\\..\\escape.mp4',
    'C:\\escape.mp4',
    '\\\\server\\share\\escape.mp4',
    '//server/share/escape.mp4',
    'projects/p1/project.json',
    '.freecut-headless/checkpoint-operations/018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10.json',
  ]) {
    assert.throws(() => resolveCheckpointOutputPath(root, candidate), {
      code: 'INVALID_OUTPUT_PATH',
    })
  }
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
  fs.symlinkSync(outside, path.join(root, 'artifacts', 'escape-link'))
  assert.throws(() => resolveCheckpointOutputPath(root, 'artifacts/escape-link/output.mp4'), {
    code: 'INVALID_OUTPUT_PATH',
  })
  fs.unlinkSync(path.join(root, 'artifacts', 'escape-link'))
  for (const protectedName of ['projects', 'media', '.freecut-headless']) {
    fs.mkdirSync(path.join(root, protectedName), { recursive: true })
    const link = path.join(root, 'artifacts', `internal-${protectedName.replace('.', '')}`)
    fs.symlinkSync(path.join(root, protectedName), link)
    assert.throws(
      () => resolveCheckpointOutputPath(root, `artifacts/${path.basename(link)}/output.mp4`),
      { code: 'INVALID_OUTPUT_PATH' },
    )
  }
})
