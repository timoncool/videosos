import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { canonicalJsonBytes, qualifiedSha256 } from './contract.mjs'
import { HttpError, resolveContained } from './http-security.mjs'
import { atomicWriteFile, withResourceLock } from './lifecycle-store.mjs'

const CHECKPOINT_PHASES = Object.freeze([
  'queued',
  'revision_verified',
  'applying_recipe',
  'project_committed',
  'rendering',
  'artifact_committed',
  'succeeded',
  'failed',
])

const TERMINAL_PHASES = new Set(['succeeded', 'failed'])
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/

class CheckpointOperationError extends HttpError {
  constructor(statusCode, code, message) {
    super(statusCode, code, message)
    this.name = 'CheckpointOperationError'
  }
}

/** Test/integration hook error representing abrupt process loss, not an operation failure. */
export class CheckpointProcessCrash extends Error {
  constructor(boundary) {
    super(`simulated process crash at ${boundary}`)
    this.name = 'CheckpointProcessCrash'
    this.boundary = boundary
  }
}

class CheckpointRetryableError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'CheckpointRetryableError'
  }
}

const recordBytes = (record) => Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
const keyHash = (key) => crypto.createHash('sha256').update(key).digest('hex')

function validateIdentity(operationId, idempotencyKey) {
  if (typeof operationId !== 'string' || !UUID_V7.test(operationId)) {
    throw new CheckpointOperationError(
      400,
      'INVALID_OPERATION_ID',
      'operationId must be a canonical lowercase UUIDv7',
    )
  }
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 128 ||
    !/^[\x20-\x7e]+$/.test(idempotencyKey)
  ) {
    throw new CheckpointOperationError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key must be 1-128 printable ASCII characters',
    )
  }
}

/**
 * Validate on every platform, not merely according to the host path parser.
 * Backslashes are rejected instead of being treated as ordinary POSIX filename bytes.
 */
export function resolveCheckpointOutputPath(workspace, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length < 1 ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.startsWith('//')
  ) {
    throw new CheckpointOperationError(400, 'INVALID_OUTPUT_PATH', 'Output path is not contained')
  }
  const segments = relativePath.split('/')
  if (
    segments[0] !== 'artifacts' ||
    segments.length < 2 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new CheckpointOperationError(400, 'INVALID_OUTPUT_PATH', 'Output path is not contained')
  }
  try {
    const artifactsRoot = path.resolve(workspace, 'artifacts')
    try {
      const rootInfo = fs.lstatSync(artifactsRoot)
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('invalid root')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return resolveContained(artifactsRoot, segments.slice(1).join('/'))
  } catch {
    throw new CheckpointOperationError(400, 'INVALID_OUTPUT_PATH', 'Output path is not contained')
  }
}

function operationRoot(workspace) {
  return resolveContained(workspace, '.freecut-headless/checkpoint-operations')
}

function operationFile(workspace, operationId) {
  return resolveContained(operationRoot(workspace), `${operationId}.json`)
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const hasExactKeys = (value, keys) => {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
const isArtifact = (value, { pending = false, operationId } = {}) => {
  const keys = [
    ...(pending ? ['operationId'] : []),
    'relativePath',
    'sha256',
    'byteSize',
    'mimeType',
    ...(value?.mediaProbe ? ['mediaProbe'] : []),
  ]
  return (
    hasExactKeys(value, keys) &&
    (!pending || value.operationId === operationId) &&
    typeof value.relativePath === 'string' &&
    SHA256.test(value.sha256) &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize >= 0 &&
    typeof value.mimeType === 'string' &&
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.mimeType) &&
    (!value.mediaProbe || isMediaProbe(value.mediaProbe))
  )
}

const isMediaProbe = (value) => {
  if (
    !hasExactKeys(value, [
      'width',
      'height',
      'durationMillis',
      'videoCodec',
      'pixelFormat',
      'frameRate',
      'audioCodec',
      'audioSampleRateHz',
      'audioChannels',
    ]) ||
    !hasExactKeys(value.frameRate, ['numerator', 'denominator'])
  )
    return false
  return [
    Number.isSafeInteger(value.width),
    value.width > 0,
    Number.isSafeInteger(value.height),
    value.height > 0,
    Number.isSafeInteger(value.durationMillis),
    value.durationMillis >= 0,
    typeof value.videoCodec === 'string',
    value.videoCodec.length > 0,
    typeof value.pixelFormat === 'string',
    value.pixelFormat.length > 0,
    Number.isSafeInteger(value.frameRate.numerator),
    value.frameRate.numerator > 0,
    Number.isSafeInteger(value.frameRate.denominator),
    value.frameRate.denominator > 0,
    typeof value.audioCodec === 'string',
    value.audioCodec.length > 0,
    Number.isSafeInteger(value.audioSampleRateHz),
    value.audioSampleRateHz > 0,
    Number.isSafeInteger(value.audioChannels),
    value.audioChannels > 0,
  ].every(Boolean)
}

const matchesFinalRenderProfile = (request, artifact) => {
  if (!artifact) return false
  const probe = artifact.mediaProbe
  if (!isMediaProbe(probe)) return false
  return [
    artifact.mimeType === 'video/mp4',
    probe.width === request.renderProfile.width,
    probe.height === request.renderProfile.height,
    probe.videoCodec === request.renderProfile.codec,
    probe.pixelFormat === request.renderProfile.pixelFormat,
    probe.frameRate.numerator === request.renderProfile.frameRate.numerator,
    probe.frameRate.denominator === request.renderProfile.frameRate.denominator,
    probe.audioCodec === request.renderProfile.audioCodec,
    probe.audioSampleRateHz === request.renderProfile.audioSampleRateHz,
    probe.audioChannels === request.renderProfile.audioChannels,
  ].every(Boolean)
}

const RECORD_COMMON_KEYS = [
  'version',
  'operationId',
  'idempotencyKeyHashes',
  'requestSha256',
  'canonicalRequest',
  'phase',
  'state',
  'createdAt',
  'updatedAt',
]
const RECORD_OPTIONAL_KEYS = ['resultingRevision', 'pendingArtifact', 'artifact', 'error']

function corruptRecord() {
  return new CheckpointOperationError(
    500,
    'CHECKPOINT_RECORD_CORRUPT',
    'Checkpoint record is corrupt',
  )
}

function hasValidIdempotencyKeys(record) {
  const hashes = record?.idempotencyKeyHashes
  return (
    Array.isArray(hashes) &&
    hashes.length > 0 &&
    new Set(hashes).size === hashes.length &&
    hashes.every((value) => /^[0-9a-f]{64}$/.test(value))
  )
}

function hasValidTimestamps(record) {
  return (
    Number.isSafeInteger(record?.createdAt) &&
    record.createdAt >= 0 &&
    Number.isSafeInteger(record?.updatedAt) &&
    record.updatedAt >= record.createdAt
  )
}

/** Identity, key set and scalar shape — everything checkable without parsing the request. */
function assertRecordShape(record, expectedId) {
  const keysValid =
    isPlainObject(record) &&
    Object.keys(record).every(
      (key) => RECORD_COMMON_KEYS.includes(key) || RECORD_OPTIONAL_KEYS.includes(key),
    )
  if (
    !keysValid ||
    record.version !== 1 ||
    record.operationId !== expectedId ||
    !UUID_V7.test(record.operationId) ||
    !CHECKPOINT_PHASES.includes(record.phase) ||
    !hasValidIdempotencyKeys(record) ||
    !hasValidTimestamps(record) ||
    typeof record.canonicalRequest !== 'string' ||
    !SHA256.test(record.requestSha256)
  ) {
    throw corruptRecord()
  }
}

/** The stored request must round-trip to its own hash, byte for byte. */
function parseCanonicalRequest(record, expectedId) {
  try {
    const bytes = Buffer.from(record.canonicalRequest)
    const request = JSON.parse(record.canonicalRequest)
    if (
      qualifiedSha256(bytes) !== record.requestSha256 ||
      !canonicalJsonBytes(request).equals(bytes) ||
      request.operationId !== expectedId
    )
      throw new Error()
    return request
  } catch {
    throw corruptRecord()
  }
}

/**
 * Which optional fields each phase may carry. `f` is the field snapshot built by
 * `recordFields`; keeping one predicate per phase turns an eight-way boolean chain
 * into a lookup, so a new phase is a new row rather than another branch.
 */
const PHASE_INVARIANTS = {
  queued: (f) => f.state === 'queued' && !f.revisionPresent && f.noArtifacts && !f.errorPresent,
  applying_recipe: (f) =>
    !f.finalRender && f.running && !f.revisionPresent && f.noArtifacts && !f.errorPresent,
  project_committed: (f) =>
    !f.finalRender && f.running && f.hasRevision && f.noArtifacts && !f.errorPresent,
  revision_verified: (f) =>
    f.finalRender && f.running && f.hasRevision && f.noArtifacts && !f.errorPresent,
  rendering: (f) =>
    f.running &&
    f.hasRevision &&
    (!f.pendingPresent || f.pendingValid) &&
    !f.artifactPresent &&
    !f.errorPresent,
  artifact_committed: (f) =>
    f.running && f.hasRevision && f.pendingValid && f.artifactValid && !f.errorPresent,
  succeeded: (f) =>
    f.state === 'succeeded' &&
    f.hasRevision &&
    f.pendingValid &&
    f.artifactValid &&
    !f.errorPresent,
  failed: (f) =>
    f.state === 'failed' &&
    f.hasError &&
    (!f.revisionPresent || f.hasRevision) &&
    (!f.pendingPresent || f.pendingValid) &&
    (!f.artifactPresent || f.artifactValid),
}

function recordFields(record, request, expectedId) {
  const finalRender = request.kind === 'final_render'
  const hasPending = isArtifact(record.pendingArtifact, { pending: true, operationId: expectedId })
  const hasArtifact = isArtifact(record.artifact)
  const pendingPresent = Object.hasOwn(record, 'pendingArtifact')
  const artifactPresent = Object.hasOwn(record, 'artifact')
  return {
    state: record.state,
    running: record.state === 'running',
    finalRender,
    hasRevision: SHA256.test(record.resultingRevision ?? ''),
    revisionPresent: Object.hasOwn(record, 'resultingRevision'),
    pendingPresent,
    artifactPresent,
    noArtifacts: !pendingPresent && !artifactPresent,
    pendingValid:
      hasPending && (!finalRender || matchesFinalRenderProfile(request, record.pendingArtifact)),
    artifactValid:
      hasArtifact && (!finalRender || matchesFinalRenderProfile(request, record.artifact)),
    errorPresent: Object.hasOwn(record, 'error'),
    hasError:
      hasExactKeys(record.error, ['code', 'message']) &&
      typeof record.error.code === 'string' &&
      typeof record.error.message === 'string',
  }
}

function assertRecord(record, expectedId) {
  assertRecordShape(record, expectedId)
  const request = parseCanonicalRequest(record, expectedId)
  const invariant = PHASE_INVARIANTS[record.phase]
  if (!invariant?.(recordFields(record, request, expectedId))) throw corruptRecord()
  return record
}

/**
 * Durable operation store. Call submit() before queue dispatch. `request` must already have passed
 * the closed wire-schema validation; the store independently verifies identity and recipe hashes.
 */
export function createCheckpointOperationStore({ workspace, now = () => Date.now() }) {
  const root = operationRoot(workspace)
  const storeLock = `checkpoint-store:${path.resolve(workspace)}`

  const read = async (operationId) => {
    if (!UUID_V7.test(operationId ?? '')) {
      throw new CheckpointOperationError(400, 'INVALID_OPERATION_ID', 'Invalid operation ID')
    }
    try {
      return assertRecord(
        JSON.parse(await fs.promises.readFile(operationFile(workspace, operationId), 'utf8')),
        operationId,
      )
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new CheckpointOperationError(
          404,
          'CHECKPOINT_NOT_FOUND',
          'Checkpoint operation not found',
        )
      }
      if (error instanceof CheckpointOperationError) throw error
      throw new CheckpointOperationError(
        500,
        'CHECKPOINT_RECORD_CORRUPT',
        'Checkpoint record is corrupt',
      )
    }
  }

  const list = async ({ unfinishedOnly = false } = {}) => {
    const entries = await fs.promises
      .readdir(root, { withFileTypes: true })
      .catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
    const records = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const match = /^([0-9a-f-]{36})\.json$/.exec(entry.name)
      if (!entry.isFile() || !match) continue
      const record = await read(match[1])
      if (!unfinishedOnly || !TERMINAL_PHASES.has(record.phase)) records.push(record)
    }
    return records
  }

  const submit = async ({ request, idempotencyKey, beforeCreate }) => {
    validateIdentity(request?.operationId, idempotencyKey)
    if (!SHA256.test(request?.expectedRevision ?? '')) {
      throw new CheckpointOperationError(
        400,
        'INVALID_EXPECTED_REVISION',
        'expectedRevision must be an exact qualified SHA-256 revision',
      )
    }
    const canonicalRequest = canonicalJsonBytes(request)
    const requestSha256 = qualifiedSha256(canonicalRequest)
    if (
      request.kind !== 'final_render' &&
      qualifiedSha256(canonicalJsonBytes(request.recipe)) !== request.recipeSha256
    ) {
      throw new CheckpointOperationError(
        400,
        'RECIPE_HASH_MISMATCH',
        'recipeSha256 does not match recipe',
      )
    }
    if (
      request.kind === 'final_render' &&
      qualifiedSha256(canonicalJsonBytes(request.renderProfile)) !== request.renderProfileSha256
    ) {
      throw new CheckpointOperationError(
        400,
        'RENDER_PROFILE_HASH_MISMATCH',
        'renderProfileSha256 does not match renderProfile',
      )
    }
    if (request.kind === 'final_render' && !request.outputRelativePath.endsWith('.mp4')) {
      throw new CheckpointOperationError(
        400,
        'INVALID_OUTPUT_PATH',
        'Final render output path must end in .mp4',
      )
    }
    const idempotencyKeyHash = keyHash(idempotencyKey)
    /** Submit is serialised on the store lock: read, dedupe by idempotency key, append. */
    const submitUnderLock = async () => {
      const records = await list()
      const byId = records.find((record) => record.operationId === request.operationId)
      const byKey = records.find((record) =>
        record.idempotencyKeyHashes.includes(idempotencyKeyHash),
      )
      for (const existing of [byId, byKey].filter(Boolean)) {
        if (
          existing.requestSha256 !== requestSha256 ||
          existing.operationId !== request.operationId
        ) {
          throw new CheckpointOperationError(
            409,
            'CHECKPOINT_IDEMPOTENCY_CONFLICT',
            'Operation ID or Idempotency-Key is bound to a different request',
          )
        }
      }
      if (byId) {
        if (byId.idempotencyKeyHashes.includes(idempotencyKeyHash)) {
          return { created: false, operation: byId }
        }
        const aliased = {
          ...byId,
          idempotencyKeyHashes: [...byId.idempotencyKeyHashes, idempotencyKeyHash].sort(),
          updatedAt: now(),
        }
        await atomicWriteFile(operationFile(workspace, request.operationId), recordBytes(aliased))
        return { created: false, operation: aliased }
      }
      resolveCheckpointOutputPath(workspace, request.outputRelativePath)
      await beforeCreate?.()
      const timestamp = now()
      const record = {
        version: 1,
        operationId: request.operationId,
        idempotencyKeyHashes: [idempotencyKeyHash],
        requestSha256,
        canonicalRequest: canonicalRequest.toString('utf8'),
        phase: 'queued',
        state: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await atomicWriteFile(operationFile(workspace, request.operationId), recordBytes(record))
      return { created: true, operation: record }
    }
    return withResourceLock(storeLock, submitUnderLock)
  }

  const update = (operationId, mutate) =>
    withResourceLock(storeLock, async () => {
      const current = await read(operationId)
      const next = mutate(structuredClone(current))
      if (
        !next ||
        next.operationId !== operationId ||
        next.requestSha256 !== current.requestSha256
      ) {
        throw new Error('Invalid checkpoint record update')
      }
      next.updatedAt = now()
      assertRecord(next, operationId)
      await atomicWriteFile(operationFile(workspace, operationId), recordBytes(next))
      return next
    })

  return { workspace, submit, get: read, list, update }
}

function expectedReceiptBinding(record, request) {
  return {
    operationId: record.operationId,
    requestSha256: record.requestSha256,
    recipeSha256: request.recipeSha256,
    priorRevision: request.expectedRevision,
  }
}

const engineProjectSha256 = (project) => {
  const { checkpointApplicationReceipts: _internalReceipts, ...engineProject } = project
  return qualifiedSha256(canonicalJsonBytes(engineProject))
}

const receiptMatches = (actual, expected) => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const keys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => actual[key] === expected[key])
  )
}

const receiptBindingMatches = (actual, expected) =>
  Boolean(actual) &&
  SHA256.test(actual.appliedProjectSha256 ?? '') &&
  Object.entries(expected).every(([key, value]) => actual[key] === value)

const defaultReceiptReader = (resource, operationId) =>
  resource.receipt ?? resource.project?.checkpointApplicationReceipts?.[operationId]

function publicFailure(error) {
  if (error instanceof CheckpointOperationError) return { code: error.code, message: error.message }
  return { code: 'CHECKPOINT_OPERATION_FAILED', message: 'Checkpoint operation failed' }
}

function assertFinalRenderEvidence(request, rendered) {
  if (!matchesFinalRenderProfile(request, rendered)) {
    throw new CheckpointOperationError(
      409,
      'RENDER_PROFILE_MISMATCH',
      'Rendered artifact or media probe does not match the fixed final render profile',
    )
  }
  return rendered.mediaProbe
}

async function inspectArtifact(file) {
  let info
  try {
    info = await fs.promises.lstat(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new CheckpointOperationError(
      409,
      'ARTIFACT_COLLISION',
      'Artifact path is not a regular file',
    )
  }
  const handle = await fs.promises.open(file, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile())
      throw new CheckpointOperationError(
        500,
        'INVALID_RENDER_ARTIFACT',
        'Render did not produce a regular file',
      )
    await handle.sync()
    const digest = crypto.createHash('sha256')
    const stream = fs.createReadStream(file, { fd: handle.fd, autoClose: false, start: 0 })
    for await (const chunk of stream) digest.update(chunk)
    return { sha256: `sha256:${digest.digest('hex')}`, byteSize: opened.size }
  } finally {
    await handle.close()
  }
}

async function fsyncDirectory(directory) {
  let handle
  try {
    handle = await fs.promises.open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (process.platform !== 'win32') throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Create a restartable runner.
 *
 * Required adapters:
 * - loadProject(projectId) -> { project, revision, receipt? }
 * - applyRecipe({ project, recipe, operation }) -> edited project
 * - commitProject({ projectId, expectedRevision, project, receipt, operation })
 *   -> { revision, receipt: { ...receipt, appliedProjectSha256 } }
 *   The adapter MUST atomically persist the edited project and exact receipt in one project write.
 * - renderArtifact({ project, revision, recipe, operation, tempPath }) -> { mimeType }
 */
/** A pre-existing final file may only be adopted when it is byte-identical evidence. */
function assertArtifactMatches(existing, artifact) {
  if (existing.sha256 !== artifact.sha256 || existing.byteSize !== artifact.byteSize) {
    throw new CheckpointOperationError(
      409,
      'ARTIFACT_COLLISION',
      'Existing artifact is not owned by this operation',
    )
  }
}

/** A temp file left by a crashed run is reusable only if it matches the pending evidence. */
async function reusableTempArtifact(tempPath, artifact) {
  const temp = artifact ? await inspectArtifact(tempPath) : null
  if (!temp) return null
  if (temp.sha256 !== artifact.sha256 || temp.byteSize !== artifact.byteSize) {
    await fs.promises.rm(tempPath, { force: true })
    return null
  }
  return temp
}

/** The renderer must report a syntactically valid MIME type for the bytes it produced. */
function assertRenderedMimeType(rendered) {
  const mimeType = rendered?.mimeType
  if (typeof mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) {
    throw new CheckpointOperationError(
      500,
      'INVALID_RENDER_ARTIFACT',
      'Render did not provide a valid MIME type',
    )
  }
  return mimeType
}

export function createCheckpointOperationRunner({
  store,
  loadProject,
  applyRecipe,
  commitProject,
  renderArtifact,
  probeFinalRenderArtifact,
  readApplicationReceipt = defaultReceiptReader,
  syncArtifactDirectory = fsyncDirectory,
  onBoundary = async () => {},
}) {
  const runLock = (id) => `checkpoint-runner:${path.resolve(store.workspace)}:${id}`

  const boundary = async (name, record) => onBoundary(name, structuredClone(record))

  /** Final renders are only trusted once their bytes have been probed. */
  const probeRenderedBytes = async (tempPath) => {
    if (typeof probeFinalRenderArtifact !== 'function') {
      throw new CheckpointOperationError(
        500,
        'FINAL_RENDER_PROBE_UNAVAILABLE',
        'Final render byte probe is unavailable',
      )
    }
    try {
      return await probeFinalRenderArtifact(tempPath)
    } catch {
      throw new CheckpointOperationError(
        500,
        'INVALID_RENDER_ARTIFACT',
        'Final render byte probe failed',
      )
    }
  }

  const persistPhase = async (record, phase, extra = {}) => {
    const next = await store.update(record.operationId, (current) => ({
      ...current,
      ...extra,
      phase,
      state: phase === 'queued' ? 'queued' : TERMINAL_PHASES.has(phase) ? phase : 'running',
    }))
    await boundary(`after_${phase}`, next)
    return next
  }

  const commitArtifact = async (record, request, tempPath, artifact) => {
    let finalPath = resolveCheckpointOutputPath(store.workspace, request.outputRelativePath)
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true })
    // Re-resolve after directory creation so a newly materialized symlink is checked.
    finalPath = resolveCheckpointOutputPath(store.workspace, request.outputRelativePath)
    const existing = await inspectArtifact(finalPath)
    if (existing) {
      if (
        record.pendingArtifact?.operationId !== record.operationId ||
        existing.sha256 !== artifact.sha256 ||
        existing.byteSize !== artifact.byteSize
      ) {
        throw new CheckpointOperationError(
          409,
          'ARTIFACT_COLLISION',
          'Existing artifact is not owned by this operation',
        )
      }
      try {
        await syncArtifactDirectory(path.dirname(finalPath))
      } catch (error) {
        throw new CheckpointRetryableError('Artifact publication is not durably verified', error)
      }
      return
    }
    const verifiedTemp = await inspectArtifact(tempPath)
    if (
      !verifiedTemp ||
      verifiedTemp.sha256 !== artifact.sha256 ||
      verifiedTemp.byteSize !== artifact.byteSize
    ) {
      throw new CheckpointOperationError(
        500,
        'ARTIFACT_VERIFICATION_FAILED',
        'Rendered artifact verification failed',
      )
    }
    try {
      // link(2) is an atomic no-replace publication. A plain rename can silently
      // overwrite a target created after the collision check on POSIX.
      await fs.promises.link(tempPath, finalPath)
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new CheckpointOperationError(
          409,
          'ARTIFACT_COLLISION',
          'Existing artifact is not owned by this operation',
        )
      }
      throw error
    }
    await fs.promises.unlink(tempPath).catch(() => {})
    try {
      await syncArtifactDirectory(path.dirname(finalPath))
    } catch (error) {
      throw new CheckpointRetryableError('Artifact publication is not durably verified', error)
    }
    await boundary('after_artifact_rename', record)
  }

  /** queued -> revision_verified (final render) or applying_recipe (recipe run). */
  const stepQueued = async (record, request, finalRender) => {
    if (finalRender) {
      const resource = await loadProject(request.projectId)
      if (resource.revision !== request.expectedRevision) {
        throw new CheckpointOperationError(
          409,
          'REVISION_CONFLICT',
          'Project revision does not match expectedRevision',
        )
      }
      record = await persistPhase(record, 'revision_verified', {
        resultingRevision: resource.revision,
      })
    } else {
      record = await persistPhase(record, 'applying_recipe')
    }
    return record
  }

  /** applying_recipe -> project_committed, verifying the receipt the commit left behind. */
  const stepApplyingRecipe = async (record, request, operationId) => {
    const receiptBinding = expectedReceiptBinding(record, request)
    let resource = await loadProject(request.projectId)
    const embedded = readApplicationReceipt(resource, operationId)
    if (resource.revision === request.expectedRevision) {
      if (embedded !== undefined) {
        throw new CheckpointOperationError(
          409,
          'PROJECT_RECEIPT_MISMATCH',
          'Project application receipt is inconsistent',
        )
      }
      const project = await applyRecipe({
        project: structuredClone(resource.project),
        recipe: request.recipe,
        operation: record,
      })
      const committed = await commitProject({
        projectId: request.projectId,
        expectedRevision: request.expectedRevision,
        project,
        receipt: receiptBinding,
        operation: record,
      })
      await boundary('after_project_write', record)
      resource = await loadProject(request.projectId)
      if (
        resource.revision !== committed.revision ||
        !receiptBindingMatches(committed.receipt, receiptBinding) ||
        !receiptMatches(readApplicationReceipt(resource, operationId), committed.receipt) ||
        committed.receipt.appliedProjectSha256 !== engineProjectSha256(resource.project)
      ) {
        throw new CheckpointOperationError(
          500,
          'PROJECT_COMMIT_UNVERIFIED',
          'Committed project receipt could not be verified',
        )
      }
    } else if (embedded === undefined) {
      throw new CheckpointOperationError(
        409,
        'REVISION_CONFLICT',
        'Project revision does not match expectedRevision',
      )
    } else if (
      !receiptBindingMatches(embedded, receiptBinding) ||
      embedded.appliedProjectSha256 !== engineProjectSha256(resource.project)
    ) {
      throw new CheckpointOperationError(
        409,
        'PROJECT_RECEIPT_MISMATCH',
        'Project contains a different or stale application receipt',
      )
    }
    record = await persistPhase(record, 'project_committed', {
      resultingRevision: resource.revision,
    })
    return record
  }

  /** rendering -> artifact_committed, resuming from a pending artifact when one survived. */
  /**
   * Render into the temp path and turn the result into pending-artifact evidence.
   * Split out of stepRendering so the phase driver stays readable; returns the
   * artifact rather than mutating the caller's record.
   */
  const renderPendingArtifact = async ({
    record,
    request,
    operationId,
    finalRender,
    resource,
    tempPath,
    artifact,
  }) => {
    await fs.promises.rm(tempPath, { force: true })
    const renderResource = finalRender ? await loadProject(request.projectId) : resource
    if (renderResource.revision !== record.resultingRevision) {
      throw new CheckpointOperationError(
        409,
        'RENDER_REVISION_MISMATCH',
        'Project no longer matches the verified revision',
      )
    }
    const rendered = await renderArtifact({
      project: renderResource.project,
      revision: renderResource.revision,
      ...(finalRender ? { renderProfile: request.renderProfile } : { recipe: request.recipe }),
      operation: record,
      tempPath,
    })
    await boundary('after_render', record)
    const temp = await inspectArtifact(tempPath)
    if (!temp) {
      throw new CheckpointOperationError(
        500,
        'INVALID_RENDER_ARTIFACT',
        'Render did not produce an artifact',
      )
    }
    const mimeType = assertRenderedMimeType(rendered)
    const mediaProbe = finalRender ? await probeRenderedBytes(tempPath) : undefined
    const nextArtifact = {
      operationId,
      relativePath: request.outputRelativePath,
      ...temp,
      mimeType,
      ...(finalRender
        ? {
            mediaProbe: assertFinalRenderEvidence(request, {
              mimeType,
              mediaProbe,
            }),
          }
        : {}),
    }
    if (
      artifact &&
      (artifact.sha256 !== nextArtifact.sha256 ||
        artifact.byteSize !== nextArtifact.byteSize ||
        artifact.mimeType !== nextArtifact.mimeType ||
        JSON.stringify(artifact.mediaProbe) !== JSON.stringify(nextArtifact.mediaProbe))
    ) {
      throw new CheckpointOperationError(
        409,
        'NONDETERMINISTIC_RENDER',
        'Recovered render did not match persisted artifact evidence',
      )
    }
    return nextArtifact
  }

  const stepRendering = async (record, request, operationId, finalRender) => {
    const resource = await loadProject(request.projectId)
    if (resource.revision !== record.resultingRevision) {
      throw new CheckpointOperationError(
        409,
        'RENDER_REVISION_MISMATCH',
        'Project no longer matches the committed revision',
      )
    }
    const tempRoot = resolveContained(operationRoot(store.workspace), 'tmp')
    await fs.promises.mkdir(tempRoot, { recursive: true })
    const tempPath = resolveContained(tempRoot, `${operationId}.artifact.tmp`)
    const finalPath = resolveCheckpointOutputPath(store.workspace, request.outputRelativePath)

    let artifact = record.pendingArtifact
    const finalExisting = await inspectArtifact(finalPath)
    if (finalExisting && artifact) {
      assertArtifactMatches(finalExisting, artifact)
      await commitArtifact(record, request, tempPath, artifact)
    } else if (!finalExisting) {
      const temp = await reusableTempArtifact(tempPath, artifact)
      if (!temp) {
        artifact = await renderPendingArtifact({
          record,
          request,
          operationId,
          finalRender,
          resource,
          tempPath,
          artifact,
        })
        record = await store.update(operationId, (current) => ({
          ...current,
          pendingArtifact: artifact,
        }))
        await boundary('after_pending_artifact', record)
      }
      await commitArtifact(record, request, tempPath, artifact)
    }
    if (!artifact) {
      throw new CheckpointOperationError(
        409,
        'ARTIFACT_COLLISION',
        'Existing artifact has no persisted operation binding',
      )
    }
    record = await persistPhase(record, 'artifact_committed', {
      artifact: {
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        mimeType: artifact.mimeType,
        ...(artifact.mediaProbe ? { mediaProbe: artifact.mediaProbe } : {}),
      },
    })
    return record
  }

  const execute = async (operationId) => {
    /** One durable operation attempt, serialised on the per-operation run lock. */
    const runOperation = async () => {
      let record = await store.get(operationId)
      if (TERMINAL_PHASES.has(record.phase)) return record
      const request = JSON.parse(record.canonicalRequest)
      const finalRender = request.kind === 'final_render'
      try {
        if (record.phase === 'queued') record = await stepQueued(record, request, finalRender)
        if (record.phase === 'applying_recipe')
          record = await stepApplyingRecipe(record, request, operationId)
        if (record.phase === 'project_committed' || record.phase === 'revision_verified')
          record = await persistPhase(record, 'rendering')
        if (record.phase === 'rendering')
          record = await stepRendering(record, request, operationId, finalRender)
        if (record.phase === 'artifact_committed') record = await persistPhase(record, 'succeeded')
        return record
      } catch (error) {
        if (error instanceof CheckpointProcessCrash || error instanceof CheckpointRetryableError)
          throw error
        const latest = await store.get(operationId)
        if (TERMINAL_PHASES.has(latest.phase)) return latest
        return persistPhase(latest, 'failed', { error: publicFailure(error) })
      }
    }
    return withResourceLock(runLock(operationId), runOperation)
  }

  const reconcile = async () => {
    const results = []
    for (const record of await store.list({ unfinishedOnly: true })) {
      results.push(await execute(record.operationId))
    }
    return results
  }

  return { execute, reconcile }
}
