import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { canonicalJsonBytes, qualifiedSha256 } from './contract.mjs'
import { HttpError, assertSinglePathComponent, resolveContained } from './http-security.mjs'
import { resolveMediaFile } from './workspace.mjs'

const locks = new Map()
const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/x-m4a',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/lottie+json',
  '.lottie': 'application/lottie+json',
}

export function assertPortableId(id, label = 'id') {
  assertSinglePathComponent(id, label)
  if (!PORTABLE_ID.test(id)) throw new HttpError(400, 'INVALID_ID', `${label} is not portable`)
  return id
}

export const revisionOf = (bytes) =>
  `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`

export async function withResourceLock(key, fn) {
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  locks.set(key, tail)
  try {
    return await run
  } finally {
    if (locks.get(key) === tail) locks.delete(key)
  }
}

export async function atomicWriteFile(target, bytes, { beforeCommit } = {}) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  let handle
  try {
    handle = await fs.promises.open(temp, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await beforeCommit?.()
    await fs.promises.rename(temp, target)
    let directoryHandle
    try {
      directoryHandle = await fs.promises.open(path.dirname(target), 'r')
      await directoryHandle.sync()
    } catch (error) {
      if (process.platform !== 'win32') throw error
    } finally {
      await directoryHandle?.close().catch(() => {})
    }
  } finally {
    await handle?.close().catch(() => {})
    await fs.promises.rm(temp, { force: true }).catch(() => {})
  }
}

async function readResource(file, notFoundCode, message) {
  let bytes
  try {
    bytes = await fs.promises.readFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, notFoundCode, message)
    throw error
  }
  return { value: JSON.parse(bytes.toString('utf8')), revision: revisionOf(bytes), bytes }
}

function projectFile(workspace, id) {
  assertPortableId(id, 'project id')
  return resolveContained(path.join(workspace, 'projects'), path.join(id, 'project.json'))
}

async function rebuildIndex(workspace) {
  const projectsRoot = path.join(workspace, 'projects')
  const projects = []
  for (const entry of await fs.promises
    .readdir(projectsRoot, { withFileTypes: true })
    .catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
    if (!entry.isDirectory() || !PORTABLE_ID.test(entry.name)) continue
    try {
      const { value } = await readResource(
        projectFile(workspace, entry.name),
        'PROJECT_NOT_FOUND',
        'Project not found',
      )
      projects.push({ id: entry.name, name: value.name, updatedAt: value.updatedAt })
    } catch {}
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  const index = Buffer.from(
    `${JSON.stringify({ version: '1.0', updatedAt: Date.now(), projects }, null, 2)}\n`,
  )
  await atomicWriteFile(path.join(workspace, 'index.json'), index)
}

export async function getProjectResource(workspace, id) {
  const resource = await readResource(
    projectFile(workspace, id),
    'PROJECT_NOT_FOUND',
    'Project not found',
  )
  return { id, revision: resource.revision, project: resource.value }
}

export function projectForEngine(project) {
  const { checkpointApplicationReceipts: _internalReceipts, ...engineProject } = project
  return engineProject
}

export function publicProjectResource(resource) {
  return resource?.project ? { ...resource, project: projectForEngine(resource.project) } : resource
}

export async function listProjectResources(workspace) {
  const root = path.join(workspace, 'projects')
  const results = []
  for (const entry of await fs.promises
    .readdir(root, { withFileTypes: true })
    .catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
    if (!entry.isDirectory() || !PORTABLE_ID.test(entry.name)) continue
    try {
      const resource = await getProjectResource(workspace, entry.name)
      results.push({
        id: entry.name,
        projectId: resource.project.id,
        name: resource.project.name,
        updatedAt: resource.project.updatedAt,
        revision: resource.revision,
      })
    } catch {}
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

function checkRevision(actual, expected, force) {
  if (!force && !expected)
    throw new HttpError(
      400,
      'EXPECTED_REVISION_REQUIRED',
      'expectedRevision is required unless force is true',
    )
  if (!force && actual !== expected) {
    const error = new HttpError(409, 'REVISION_CONFLICT', 'Project revision does not match')
    error.expectedRevision = expected
    error.actualRevision = actual
    throw error
  }
}

export async function createProjectResource(workspace, project) {
  return withResourceLock(`project:${project.id}`, async () => {
    const file = projectFile(workspace, project.id)
    if (fs.existsSync(file)) throw new HttpError(409, 'ALREADY_EXISTS', 'Project already exists')
    const bytes = Buffer.from(`${JSON.stringify(project, null, 2)}\n`)
    await atomicWriteFile(file, bytes, {
      beforeCommit: async () => {
        if (fs.existsSync(file))
          throw new HttpError(409, 'ALREADY_EXISTS', 'Project already exists')
      },
    })
    const warnings = []
    try {
      await withResourceLock('projects:index', () => rebuildIndex(workspace))
    } catch {
      warnings.push('INDEX_REPAIR_REQUIRED')
    }
    return { id: project.id, revision: revisionOf(bytes), project, warnings }
  })
}

export async function saveProjectResource(
  workspace,
  id,
  project,
  { expectedRevision, force = false } = {},
) {
  return withResourceLock(`project:${id}`, async () => {
    const current = await getProjectResource(workspace, id)
    checkRevision(current.revision, expectedRevision, force)
    const next = {
      ...project,
      id,
      createdAt: current.project.createdAt,
      updatedAt: Date.now(),
      ...(current.project.checkpointApplicationReceipts
        ? { checkpointApplicationReceipts: current.project.checkpointApplicationReceipts }
        : {}),
    }
    const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    await atomicWriteFile(projectFile(workspace, id), bytes, {
      beforeCommit: async () => {
        const latest = await getProjectResource(workspace, id)
        checkRevision(latest.revision, current.revision, false)
      },
    })
    const warnings = []
    try {
      await withResourceLock('projects:index', () => rebuildIndex(workspace))
    } catch {
      warnings.push('INDEX_REPAIR_REQUIRED')
    }
    return { id, revision: revisionOf(bytes), project: next, warnings }
  })
}

function checkpointApplicationReceiptFor(project, operationId) {
  return project?.checkpointApplicationReceipts?.[operationId] ?? null
}

export async function saveProjectResourceWithCheckpointReceipt(
  workspace,
  id,
  project,
  { expectedRevision, receipt, afterCommit } = {},
) {
  assertPortableId(id, 'project id')
  if (
    !receipt ||
    typeof receipt.operationId !== 'string' ||
    typeof receipt.requestSha256 !== 'string' ||
    typeof receipt.recipeSha256 !== 'string' ||
    typeof receipt.priorRevision !== 'string'
  ) {
    throw new TypeError('A complete checkpoint application receipt is required')
  }
  if (receipt.priorRevision !== expectedRevision) {
    throw new TypeError('Checkpoint receipt priorRevision must equal expectedRevision')
  }
  return withResourceLock(`project:${id}`, async () => {
    const current = await getProjectResource(workspace, id)
    checkRevision(current.revision, expectedRevision, false)
    const existing = checkpointApplicationReceiptFor(current.project, receipt.operationId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
        throw new HttpError(
          409,
          'CHECKPOINT_RECEIPT_MISMATCH',
          'Project contains a different receipt for this checkpoint operation',
        )
      }
      return current
    }
    const nextEngineProject = {
      ...projectForEngine(project),
      id,
      createdAt: current.project.createdAt,
      updatedAt: Date.now(),
    }
    const committedReceipt = {
      ...receipt,
      appliedProjectSha256: qualifiedSha256(canonicalJsonBytes(nextEngineProject)),
    }
    const next = {
      ...nextEngineProject,
      checkpointApplicationReceipts: {
        ...(current.project.checkpointApplicationReceipts ?? {}),
        [receipt.operationId]: committedReceipt,
      },
    }
    const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    const revision = revisionOf(bytes)
    await atomicWriteFile(projectFile(workspace, id), bytes, {
      beforeCommit: async () => {
        const latest = await getProjectResource(workspace, id)
        checkRevision(latest.revision, current.revision, false)
      },
    })
    await afterCommit?.({ id, revision, project: next })
    const warnings = []
    try {
      await withResourceLock('projects:index', () => rebuildIndex(workspace))
    } catch {
      warnings.push('INDEX_REPAIR_REQUIRED')
    }
    return { id, revision, project: next, receipt: committedReceipt, warnings }
  })
}

function localPidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM') return true
    return null
  }
}

function readLockRecord(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  } catch {
    throw new HttpError(503, 'WORKSPACE_LOCKED', 'Workspace writer lock is unreadable')
  }
}

/** A lock is only breakable when its owner is a dead local process. */
function assertLockOwnerIsGone(recorded) {
  const localHost = !recorded.hostname || recorded.hostname === os.hostname()
  const alive = localHost ? localPidIsAlive(recorded.pid) : null
  if (alive !== false) {
    throw new HttpError(
      503,
      'WORKSPACE_LOCKED',
      alive
        ? 'Workspace already has a live agent writer'
        : 'Workspace writer cannot be confirmed stale',
    )
  }
}

function assertLockIsStale(recorded, { breakLock, staleGraceMs }) {
  const age = Date.now() - Number(recorded.createdAt)
  if (!breakLock && (!Number.isFinite(age) || age < staleGraceMs)) {
    throw new HttpError(
      503,
      'WORKSPACE_LOCKED',
      'Workspace writer lock is within the stale-lock grace period',
    )
  }
}

/**
 * Take the abandoned lock by renaming it aside first: if the token changed
 * underneath us another writer won the race, so we put it back and give up.
 */
async function reclaimStaleLock(dir, lockPath, recorded) {
  const recoveryPath = path.join(dir, `writer.lock.recover.${process.pid}.${crypto.randomUUID()}`)
  try {
    await fs.promises.rename(lockPath, recoveryPath)
    const claimed = JSON.parse(await fs.promises.readFile(recoveryPath, 'utf8'))
    if (claimed.token !== recorded.token) {
      await fs.promises.rename(recoveryPath, lockPath).catch(() => {})
      throw new HttpError(503, 'WORKSPACE_LOCKED', 'Workspace writer changed during recovery')
    }
    await fs.promises.rm(recoveryPath, { force: true })
    return await fs.promises.open(lockPath, 'wx', 0o600)
  } catch (retryError) {
    if (retryError.code === 'EEXIST')
      throw new HttpError(503, 'WORKSPACE_LOCKED', 'Workspace writer lock was reacquired')
    throw retryError
  }
}

async function openWriterLock(dir, lockPath, options) {
  try {
    return await fs.promises.open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const recorded = readLockRecord(lockPath)
    assertLockOwnerIsGone(recorded)
    assertLockIsStale(recorded, options)
    return reclaimStaleLock(dir, lockPath, recorded)
  }
}

export async function acquireWriterLock(
  workspace,
  { breakLock = false, staleGraceMs = 60_000 } = {},
) {
  const dir = path.join(workspace, '.freecut-headless')
  await fs.promises.mkdir(dir, { recursive: true })
  const lockPath = path.join(dir, 'writer.lock')
  const handle = await openWriterLock(dir, lockPath, { breakLock, staleGraceMs })
  const token = crypto.randomUUID()
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, hostname: os.hostname(), token, createdAt: Date.now() }),
  )
  await handle.sync()
  await handle.close()
  const cleanupOnExit = () => {
    try {
      const value = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      if (value.token === token) fs.rmSync(lockPath, { force: true })
    } catch {}
  }
  process.once('exit', cleanupOnExit)
  return async () => {
    process.off('exit', cleanupOnExit)
    try {
      const value = JSON.parse(await fs.promises.readFile(lockPath, 'utf8'))
      if (value.token === token) await fs.promises.rm(lockPath, { force: true })
    } catch {}
  }
}

export async function assertAtomicReplace(workspace) {
  const dir = path.join(workspace, '.freecut-headless')
  await fs.promises.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'atomic-test')
  try {
    await atomicWriteFile(file, Buffer.from('one'))
    await atomicWriteFile(file, Buffer.from('two'))
    if ((await fs.promises.readFile(file, 'utf8')) !== 'two')
      throw new Error('replace did not commit')
  } catch (cause) {
    throw new HttpError(
      503,
      'ATOMIC_REPLACE_UNAVAILABLE',
      `Atomic replacement unavailable: ${cause.message}`,
    )
  } finally {
    await fs.promises.rm(file, { force: true }).catch(() => {})
  }
}

function sanitizeFileName(name) {
  const cleaned = [...name]
    .map((character) =>
      character.codePointAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character,
    )
    .join('')
    .replace(/^\s+|[\s.]+$/g, '')
  return (cleaned || 'source.bin').slice(0, 200)
}

export async function listMediaResources(workspace) {
  const root = path.join(workspace, 'media')
  const results = []
  for (const entry of await fs.promises
    .readdir(root, { withFileTypes: true })
    .catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
    if (!entry.isDirectory() || !PORTABLE_ID.test(entry.name)) continue
    try {
      results.push(await getMediaResource(workspace, entry.name))
    } catch {}
  }
  return results
}

export async function getMediaResource(workspace, id) {
  assertPortableId(id, 'media id')
  const file = resolveContained(path.join(workspace, 'media'), path.join(id, 'metadata.json'))
  const resource = await readResource(file, 'MEDIA_NOT_FOUND', 'Media not found')
  const projectIds = []
  const projectsRoot = path.join(workspace, 'projects')
  for (const entry of await fs.promises
    .readdir(projectsRoot, { withFileTypes: true })
    .catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
    if (!entry.isDirectory() || !PORTABLE_ID.test(entry.name)) continue
    try {
      const links = JSON.parse(
        await fs.promises.readFile(path.join(projectsRoot, entry.name, 'media-links.json'), 'utf8'),
      )
      if (links.mediaIds?.some((link) => (typeof link === 'string' ? link : link.id) === id))
        projectIds.push(entry.name)
    } catch {}
  }
  return {
    id,
    revision: resource.revision,
    metadata: resource.value,
    sourceAvailable: Boolean(resolveMediaFile(workspace, id)),
    projectIds,
  }
}

export async function updateMediaMetadata(
  workspace,
  id,
  probe,
  { expectedRevision, force = false } = {},
) {
  return withResourceLock(`media:${id}`, async () => {
    const current = await getMediaResource(workspace, id)
    checkRevision(current.revision, expectedRevision, force)
    const details = probe.metadata ?? probe
    const next = {
      ...current.metadata,
      mimeType: probe.mimeType ?? current.metadata.mimeType,
      ...('duration' in details ? { duration: details.duration } : {}),
      ...('width' in details ? { width: details.width } : {}),
      ...('height' in details ? { height: details.height } : {}),
      ...(details.type === 'video' || 'fps' in details ? { fps: details.fps ?? 0 } : {}),
      ...('codec' in details ? { codec: details.codec } : {}),
      ...('bitrate' in details ? { bitrate: details.bitrate } : {}),
      ...('audioCodec' in details ? { audioCodec: details.audioCodec } : {}),
      ...('audioCodecSupported' in details
        ? { audioCodecSupported: details.audioCodecSupported }
        : {}),
      ...('videoCodecSupported' in details
        ? { videoCodecSupported: details.videoCodecSupported }
        : {}),
      ...('keyframeTimestamps' in details
        ? { keyframeTimestamps: details.keyframeTimestamps }
        : {}),
      ...('gopInterval' in details ? { gopInterval: details.gopInterval } : {}),
      updatedAt: Date.now(),
    }
    delete next.fileHandle
    delete next.opfsPath
    const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    const target = resolveContained(path.join(workspace, 'media'), path.join(id, 'metadata.json'))
    await atomicWriteFile(target, bytes, {
      beforeCommit: async () => {
        const latest = await getMediaResource(workspace, id)
        checkRevision(latest.revision, current.revision, false)
      },
    })
    return { ...(await getMediaResource(workspace, id)), revision: revisionOf(bytes) }
  })
}

export async function stageLocalMedia(
  workspace,
  sourcePath,
  id = crypto.randomUUID(),
  { maxBytes = 20 * 1024 ** 3 } = {},
) {
  assertPortableId(id, 'media id')
  const source = path.resolve(sourcePath)
  const stat = await fs.promises.lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new HttpError(
      400,
      'INVALID_MEDIA_SOURCE',
      'Media source must be a regular non-symlink file',
    )
  if (stat.size === 0 || stat.size > maxBytes)
    throw new HttpError(413, 'MEDIA_SIZE_LIMIT', 'Media source exceeds size limits')
  const ext = path.extname(source).toLowerCase()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
  if ((ext === '.json' || ext === '.lottie') && stat.size > 50 * 1024 ** 2)
    throw new HttpError(413, 'MEDIA_SIZE_LIMIT', 'Lottie source exceeds 50 MiB')
  const dir = resolveContained(path.join(workspace, 'media'), id)
  if (fs.existsSync(dir)) throw new HttpError(409, 'ALREADY_EXISTS', 'Media already exists')
  await fs.promises.mkdir(path.join(workspace, 'media'), { recursive: true })
  await fs.promises.mkdir(dir, { recursive: false })
  const target = path.join(dir, sanitizeFileName(path.basename(source)))
  try {
    await pipeline(
      fs.createReadStream(source),
      fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    )
    return {
      id,
      dir,
      target,
      fileName: path.basename(source),
      fileSize: stat.size,
      fileLastModified: stat.mtimeMs,
      mimeType,
    }
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true })
    throw error
  }
}

export async function commitStagedMedia(staged, probe, { projectId, workspace }) {
  const metadata = probe.metadata
  const now = Date.now()
  const value = {
    id: staged.id,
    storageType: 'workspace',
    fileName: staged.fileName,
    fileSize: staged.fileSize,
    fileLastModified: staged.fileLastModified,
    mimeType: probe.mimeType,
    duration: 'duration' in metadata ? metadata.duration : 0,
    width: 'width' in metadata ? metadata.width : 0,
    height: 'height' in metadata ? metadata.height : 0,
    fps: metadata.type === 'video' ? metadata.fps : 0,
    codec: metadata.codec ?? 'unknown',
    bitrate: metadata.bitrate ?? 0,
    ...(metadata.type === 'video'
      ? {
          audioCodec: metadata.audioCodec,
          audioCodecSupported: metadata.audioCodecSupported,
          videoCodecSupported: metadata.videoCodecSupported,
          keyframeTimestamps: metadata.keyframeTimestamps,
          gopInterval: metadata.gopInterval,
        }
      : {}),
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  await atomicWriteFile(path.join(staged.dir, 'metadata.json'), bytes)
  if (projectId) {
    assertPortableId(projectId, 'project id')
    await getProjectResource(workspace, projectId)
    const linksFile = resolveContained(
      path.join(workspace, 'projects'),
      path.join(projectId, 'media-links.json'),
    )
    let links = { version: '1.0', mediaIds: [] }
    try {
      links = JSON.parse(await fs.promises.readFile(linksFile, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    if (!links.mediaIds.some((entry) => entry.id === staged.id))
      links.mediaIds.push({ id: staged.id, addedAt: now })
    await atomicWriteFile(linksFile, Buffer.from(`${JSON.stringify(links, null, 2)}\n`))
  }
  return getMediaResource(workspace, staged.id)
}

export async function rollbackStagedMedia(staged) {
  await fs.promises.rm(staged.dir, { recursive: true, force: true })
}
