import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECKPOINT_RECIPE_SCHEMA_SHA256,
  CHECKPOINT_RECIPE_SCHEMA_VERSION,
  canonicalJsonBytes,
  capabilities,
  checkpointOperationRequestSchema,
  checkpointRecipeJsonSchema,
  FINAL_RENDER_PROFILE,
  FINAL_RENDER_PROFILE_SHA256,
  lifecycleEditRequestSchema,
  mediaProbeRequestSchema,
  projectCreateRequestSchema,
  projectSaveRequestSchema,
  qualifiedSha256,
} from './lib/contract.mjs'

test('lifecycle project requests are strict and revision guarded', () => {
  assert.equal(
    projectCreateRequestSchema.safeParse({ name: 'Demo', surprise: true }).success,
    false,
  )
  const project = {
    id: 'demo',
    name: 'Demo',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 30 },
  }
  assert.equal(projectSaveRequestSchema.safeParse({ project, force: true }).success, true)
  assert.equal(projectSaveRequestSchema.safeParse({ project: {}, force: true }).success, false)
  assert.equal(
    projectSaveRequestSchema.safeParse({
      project: { ...project, rootFolderHandle: {} },
      force: true,
    }).success,
    false,
  )
  assert.equal(
    projectSaveRequestSchema.safeParse({ project: { ...project, surprise: true }, force: true })
      .success,
    false,
  )
  assert.equal(
    projectSaveRequestSchema.safeParse({
      project: { ...project, checkpointApplicationReceipts: {} },
      force: true,
    }).success,
    false,
  )
  assert.equal(projectSaveRequestSchema.safeParse({ project: {} }).success, false)
  assert.equal(mediaProbeRequestSchema.safeParse({ persist: true }).success, false)
  assert.equal(mediaProbeRequestSchema.safeParse({ persist: true, force: true }).success, true)
})

test('lifecycle edits require unique caller ids and accept id references', () => {
  const valid = lifecycleEditRequestSchema.safeParse({
    ops: [
      { callerId: 'create', op: 'addText', text: 'hello', from: 0 },
      { callerId: 'move', op: 'moveItem', id: { $ref: 'create#/detail/created/0/id' }, from: 4 },
    ],
  })
  assert.equal(valid.success, true, JSON.stringify(valid.error?.issues))
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        { callerId: 'same', op: 'addText', text: 'a', from: 0 },
        { callerId: 'same', op: 'addText', text: 'b', from: 1 },
      ],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [{ callerId: 'bad', op: 'addText', text: 'a', from: 0, surprise: true }],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        {
          callerId: 'bad',
          op: 'addText',
          text: { $ref: 'later#/detail/id' },
          from: 0,
        },
        { callerId: 'later', op: 'addText', text: 'later', from: 1 },
      ],
    }).success,
    false,
  )
})

test('capabilities publish lifecycle constraints', () => {
  const result = capabilities()
  assert.equal(result.lifecycle.httpMediaUpload, false)
  assert.equal(result.lifecycle.workspaceMediaImport, true)
  assert.equal(result.lifecycle.deleteProject, false)
  assert.equal(result.lifecycle.writerMode, 'exclusive')
  assert.ok(result.lifecycle.routes.includes('POST /v1/projects/:id/edit'))
  assert.ok(result.lifecycle.routes.includes('GET /v1/status'))
  assert.deepEqual(result.lifecycle.status, {
    transport: 'poll',
    route: 'GET /v1/status',
    renderProgress: true,
  })
})

const validCheckpointRecipe = {
  schemaVersion: '1.1',
  operations: [
    { callerId: 'track_1', op: 'addTrack', kind: 'video' },
    {
      callerId: 'clip_1',
      op: 'addClip',
      mediaId: 'media_1',
      trackId: { $ref: 'track_1#/detail/trackId' },
      from: 0,
      durationInFrames: 30,
    },
  ],
  render: { codec: 'h264', container: 'mp4', quality: 'high' },
}

const validCheckpointRequest = () => ({
  operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10',
  projectId: 'project_1',
  expectedRevision: `sha256:${'1'.repeat(64)}`,
  recipe: structuredClone(validCheckpointRecipe),
  recipeSha256: qualifiedSha256(canonicalJsonBytes(validCheckpointRecipe)),
  outputRelativePath: 'artifacts/project_1/checkpoint.mp4',
})

const validFinalRenderRequest = () => ({
  kind: 'final_render',
  operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b11',
  projectId: 'project_1',
  expectedRevision: `sha256:${'1'.repeat(64)}`,
  renderProfile: structuredClone(FINAL_RENDER_PROFILE),
  renderProfileSha256: FINAL_RENDER_PROFILE_SHA256,
  approvalBindingSha256: `sha256:${'2'.repeat(64)}`,
  outputRelativePath: 'artifacts/project_1/final.mp4',
})

test('checkpoint recipe is closed, versioned, and reference ordered', () => {
  assert.equal(checkpointOperationRequestSchema.safeParse(validCheckpointRequest()).success, true)
  const unknownField = validCheckpointRequest()
  unknownField.recipe.operations[0].surprise = true
  assert.equal(checkpointOperationRequestSchema.safeParse(unknownField).success, false)
  const unknownOperation = validCheckpointRequest()
  unknownOperation.recipe.operations[0] = { callerId: 'x', op: 'updateItem', id: 'item_1' }
  assert.equal(checkpointOperationRequestSchema.safeParse(unknownOperation).success, false)
  const futureVersion = validCheckpointRequest()
  futureVersion.recipe.schemaVersion = '2.0'
  assert.equal(checkpointOperationRequestSchema.safeParse(futureVersion).success, false)
  const forwardReference = validCheckpointRequest()
  forwardReference.recipe.operations[0] = {
    callerId: 'move_1',
    op: 'moveItem',
    id: { $ref: 'clip_1#/detail/id' },
    from: 0,
  }
  assert.equal(checkpointOperationRequestSchema.safeParse(forwardReference).success, false)
  const unknownPointer = validCheckpointRequest()
  unknownPointer.recipe.operations[1].trackId = { $ref: 'track_1#/detail/id' }
  unknownPointer.recipeSha256 = qualifiedSha256(canonicalJsonBytes(unknownPointer.recipe))
  assert.equal(checkpointOperationRequestSchema.safeParse(unknownPointer).success, false)
})

test('checkpoint recipe 1.1 requires explicit linked control for linked-sensitive operations', () => {
  for (const operation of [
    { callerId: 'remove_1', op: 'removeItems', ids: ['item_1'] },
    { callerId: 'split_1', op: 'split', id: 'item_1', frame: 1 },
    { callerId: 'trim_start_1', op: 'trimStart', id: 'item_1', amount: 1 },
    { callerId: 'trim_end_1', op: 'trimEnd', id: 'item_1', amount: 1 },
  ]) {
    const missing = validCheckpointRequest()
    missing.recipe.operations = [operation]
    missing.recipeSha256 = qualifiedSha256(canonicalJsonBytes(missing.recipe))
    assert.equal(checkpointOperationRequestSchema.safeParse(missing).success, false, operation.op)

    const explicit = validCheckpointRequest()
    explicit.recipe.operations = [{ ...operation, linked: false }]
    explicit.recipeSha256 = qualifiedSha256(canonicalJsonBytes(explicit.recipe))
    assert.equal(checkpointOperationRequestSchema.safeParse(explicit).success, true, operation.op)
  }
})

test('checkpoint request validates canonical ids, hashes, and portable output paths', () => {
  const uppercaseUuid = validCheckpointRequest()
  uppercaseUuid.operationId = uppercaseUuid.operationId.toUpperCase()
  assert.equal(checkpointOperationRequestSchema.safeParse(uppercaseUuid).success, false)
  const wrongHash = validCheckpointRequest()
  wrongHash.recipeSha256 = `sha256:${'0'.repeat(64)}`
  assert.equal(checkpointOperationRequestSchema.safeParse(wrongHash).success, false)
  for (const outputRelativePath of [
    '/tmp/out.mp4',
    'C:\\tmp\\out.mp4',
    '\\\\server\\share\\out.mp4',
    'artifacts/../out.mp4',
    'artifacts\\..\\out.mp4',
    'artifacts\0out.mp4',
    'projects/project_1/project.json',
    '.freecut-headless/checkpoint-operations/record.json',
  ]) {
    const request = validCheckpointRequest()
    request.outputRelativePath = outputRelativePath
    assert.equal(
      checkpointOperationRequestSchema.safeParse(request).success,
      false,
      outputRelativePath,
    )
  }
})

test('final render request is closed and bound to the fixed shorts profile', () => {
  assert.equal(checkpointOperationRequestSchema.safeParse(validFinalRenderRequest()).success, true)
  assert.deepEqual(FINAL_RENDER_PROFILE.frameRate, { numerator: 25, denominator: 1 })
  assert.equal(FINAL_RENDER_PROFILE.pixelFormat, 'yuv420p')
  assert.equal(FINAL_RENDER_PROFILE.audioSampleRateHz, 48000)
  assert.equal(FINAL_RENDER_PROFILE.audioChannels, 2)
  for (const mutate of [
    (request) => (request.renderProfile.width = 1920),
    (request) => (request.renderProfileSha256 = `sha256:${'0'.repeat(64)}`),
    (request) => (request.kind = 'future_render'),
    (request) => (request.surprise = true),
    (request) => (request.outputRelativePath = 'artifacts/demo/final.webm'),
  ]) {
    const request = validFinalRenderRequest()
    mutate(request)
    assert.equal(checkpointOperationRequestSchema.safeParse(request).success, false)
  }
})

test('capabilities advertise the canonical checkpoint recipe schema hash', () => {
  const result = capabilities()
  assert.equal(result.checkpointRecipe.schemaVersion, CHECKPOINT_RECIPE_SCHEMA_VERSION)
  assert.equal(result.checkpointRecipe.schemaSha256, CHECKPOINT_RECIPE_SCHEMA_SHA256)
  assert.equal(
    result.checkpointRecipe.schemaSha256,
    qualifiedSha256(canonicalJsonBytes(checkpointRecipeJsonSchema)),
  )
  assert.ok(result.lifecycle.routes.includes('POST /v1/checkpoint-operations'))
  assert.equal(result.finalRender.kind, 'final_render')
  assert.equal(result.finalRender.renderProfileSha256, FINAL_RENDER_PROFILE_SHA256)
  assert.equal(result.finalRender.approvalBinding, 'sha256')
  assert.deepEqual(result.finalRender.phases, [
    'queued',
    'revision_verified',
    'rendering',
    'artifact_committed',
    'succeeded',
    'failed',
  ])
  assert.deepEqual(result.finalRender.artifactMediaProbeKeys, [
    'width',
    'height',
    'durationMillis',
    'videoCodec',
    'pixelFormat',
    'frameRate',
    'audioCodec',
    'audioSampleRateHz',
    'audioChannels',
  ])
  assert.equal(result.schemas.finalRenderOperation.properties.kind.const, 'final_render')
  assert.deepEqual(
    result.schemas.finalRenderOperation.properties.renderProfile.const,
    FINAL_RENDER_PROFILE,
  )
  assert.equal(result.schemas.finalRenderOperation.additionalProperties, false)
  assert.deepEqual(Object.keys(result.schemas.finalRenderOperation.properties).sort(), [
    'approvalBindingSha256',
    'expectedRevision',
    'kind',
    'operationId',
    'outputRelativePath',
    'projectId',
    'renderProfile',
    'renderProfileSha256',
  ])
})
