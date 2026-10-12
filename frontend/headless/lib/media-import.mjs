import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { HttpError, resolveContained } from './http-security.mjs'
import {
  assertPortableId,
  atomicWriteFile,
  getMediaResource,
  getProjectResource,
  withResourceLock,
} from './lifecycle-store.mjs'

const MAX_MEDIA_BYTES = 20 * 1024 ** 3
const MIME_BY_EXT = new Map([
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
  ['.avi', 'video/x-msvideo'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.aac', 'audio/aac'],
  ['.m4a', 'audio/x-m4a'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/lottie+json'],
  ['.lottie', 'application/lottie+json'],
])

const digest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`
const bareDigest = (value) => value.replace(/^sha256:/, '')

function safeSourcePath(workspace, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.startsWith('//') ||
    relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new HttpError(400, 'INVALID_SOURCE_PATH', 'Media source path is not workspace-relative')
  }
  const source = resolveContained(workspace, relativePath)
  // Node exposes O_NOFOLLOW for the final component but no descriptor-relative
  // openat(2) walk. We therefore reject every symlink component, open the final
  // file by FD, and repeat canonical path + dev/ino identity after streaming.
  // A restored parent-directory ABA still fails unless it resolves to the exact
  // inode that was read, in which case the bytes and their digest are identical.
  let current = path.resolve(workspace)
  try {
    for (const segment of relativePath.split('/')) {
      current = path.join(current, segment)
      const info = fs.lstatSync(current)
      if (info.isSymbolicLink())
        throw new HttpError(400, 'INVALID_MEDIA_SOURCE', 'Media source must not contain symlinks')
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      throw new HttpError(404, 'MEDIA_SOURCE_NOT_FOUND', 'Media source was not found')
    throw error
  }
  return source
}

function importRoot(workspace, requestHash) {
  if (!/^[0-9a-f]{64}$/.test(requestHash)) throw new Error('Invalid internal request hash')
  return resolveContained(path.join(workspace, '.freecut-headless', 'media-imports'), requestHash)
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256')
  await pipeline(
    fs.createReadStream(file),
    new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        callback()
      },
    }),
  )
  return `sha256:${hash.digest('hex')}`
}

async function stageImport(workspace, body, requestHash, syncFileFn = syncFile) {
  const source = safeSourcePath(workspace, body.sourceRelativePath)
  const extension = path.extname(source).toLowerCase()
  const mimeType = MIME_BY_EXT.get(extension)
  if (!mimeType) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')

  const root = importRoot(workspace, requestHash)
  await fs.promises.rm(root, { recursive: true, force: true })
  const resourceDir = path.join(root, 'resource')
  await fs.promises.mkdir(resourceDir, { recursive: true })
  const target = path.join(resourceDir, path.basename(source))
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  let sourceHandle
  try {
    sourceHandle = await fs.promises.open(source, flags)
    const before = await sourceHandle.stat()
    if (!before.isFile())
      throw new HttpError(400, 'INVALID_MEDIA_SOURCE', 'Media source must be a regular file')
    if (before.size === 0 || before.size > MAX_MEDIA_BYTES)
      throw new HttpError(413, 'MEDIA_SIZE_LIMIT', 'Media source exceeds size limits')
    if (before.size !== body.expectedByteSize)
      throw new HttpError(422, 'MEDIA_SIZE_MISMATCH', 'Media source byte size does not match')

    const hash = crypto.createHash('sha256')
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      hasher,
      fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    )
    const after = await sourceHandle.stat()
    const canonicalAfter = safeSourcePath(workspace, body.sourceRelativePath)
    const pathAfter = await fs.promises.lstat(canonicalAfter)
    if (
      canonicalAfter !== source ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino
    ) {
      throw new HttpError(409, 'MEDIA_SOURCE_CHANGED', 'Media source changed during import')
    }
    const sourceSha256 = `sha256:${hash.digest('hex')}`
    if (sourceSha256 !== body.expectedSha256)
      throw new HttpError(422, 'MEDIA_HASH_MISMATCH', 'Media source hash does not match')
    const staged = {
      id: body.mediaId,
      root,
      resourceDir,
      target,
      fileName: path.basename(source),
      fileSize: after.size,
      fileLastModified: after.mtimeMs,
      mimeType,
      sourceSha256,
      requestHash,
      sourceRelativePath: body.sourceRelativePath,
    }
    // The blob must be durable before receipt.json (and later metadata.json)
    // can describe it, otherwise a crash between the two leaves a promoted
    // directory whose media file does not match its recorded size/hash.
    await syncFileFn(target)
    await atomicWriteFile(
      path.join(root, 'receipt.json'),
      Buffer.from(
        `${JSON.stringify(
          {
            state: 'staged',
            body,
            staged: {
              fileName: staged.fileName,
              fileSize: staged.fileSize,
              mimeType,
              sourceSha256,
            },
          },
          null,
          2,
        )}\n`,
      ),
    )
    return staged
  } catch (error) {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    await sourceHandle?.close().catch(() => {})
  }
}

async function associateProject(workspace, projectId, mediaId) {
  if (!projectId) return
  const linkProjectMedia = async () => {
    await getProjectResource(workspace, projectId)
    const linksFile = resolveContained(
      path.join(workspace, 'projects'),
      path.join(projectId, 'media-links.json'),
    )
    let links = { version: '1.0', mediaIds: [] }
    try {
      links = JSON.parse(await fs.promises.readFile(linksFile, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (!Array.isArray(links.mediaIds)) links.mediaIds = []
    if (
      !links.mediaIds.some((entry) => (typeof entry === 'string' ? entry : entry.id) === mediaId)
    ) {
      links.mediaIds.push({ id: mediaId, addedAt: Date.now() })
      await atomicWriteFile(linksFile, Buffer.from(`${JSON.stringify(links, null, 2)}\n`))
    }
  }
  await withResourceLock(`project:${projectId}:media-links`, linkProjectMedia)
}

async function syncDirectory(directory) {
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
 * Flush a written file's data to stable storage.
 *
 * `syncDirectory` only makes the *names* in a directory durable, so a promoted
 * media blob needs its own sync before any durable record describes it: without
 * it a crash can leave `media/<id>` with an empty or partial file while its
 * metadata claims the full size and hash, and the retry path rejects that id as
 * MEDIA_ID_CONFLICT. Opened read-write because FlushFileBuffers needs a
 * writable handle on Windows.
 */
async function syncFile(file) {
  const handle = await fs.promises.open(file, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function markMayHaveCommitted(error) {
  if (error && typeof error === 'object') error.idempotencyCommitState = 'may-have-committed'
  return error
}

function assertMatchingResource(resource, body) {
  if (
    resource.metadata.sourceSha256 !== body.expectedSha256 ||
    resource.metadata.fileSize !== body.expectedByteSize ||
    !resource.metadata.importProbe
  ) {
    throw new HttpError(409, 'MEDIA_ID_CONFLICT', 'Media id already contains different content')
  }
}

function gcd(left, right) {
  while (right) [left, right] = [right, left % right]
  return left
}

function normalizeProbe(probeResult) {
  const details = probeResult?.metadata
  if (
    details?.type !== 'video' ||
    details.videoCodecSupported === false ||
    details.audioCodecSupported === false ||
    !Number.isInteger(details.width) ||
    !Number.isInteger(details.height) ||
    !Number.isFinite(details.duration) ||
    !Number.isFinite(details.fps) ||
    details.width <= 0 ||
    details.height <= 0 ||
    details.duration <= 0 ||
    details.fps <= 0 ||
    typeof details.codec !== 'string' ||
    details.codec.length === 0
  ) {
    throw new HttpError(422, 'MEDIA_PROBE_FAILED', 'Media probe did not return supported video')
  }
  const denominatorBase = 1000
  const numeratorBase = Math.round(details.fps * denominatorBase)
  const durationMs = Math.round(details.duration * 1000)
  if (numeratorBase <= 0 || durationMs <= 0)
    throw new HttpError(422, 'MEDIA_PROBE_FAILED', 'Media probe returned invalid timing')
  const divisor = gcd(numeratorBase, denominatorBase)
  return {
    width: Math.round(details.width),
    height: Math.round(details.height),
    durationMs,
    frameRateNumerator: numeratorBase / divisor,
    frameRateDenominator: denominatorBase / divisor,
    videoCodec: details.codec,
    audioCodec:
      typeof details.audioCodec === 'string' && details.audioCodec.length > 0
        ? details.audioCodec
        : null,
  }
}

function responseFor(resource, body) {
  return {
    ok: true,
    apiVersion: 1,
    mediaId: body.mediaId,
    revision: resource.revision,
    sourceSha256: body.expectedSha256,
    byteSize: body.expectedByteSize,
    probe: resource.metadata.importProbe,
  }
}

export async function importWorkspaceMedia(
  workspace,
  body,
  {
    requestHash,
    probe,
    registerTransient = () => () => {},
    syncDirectoryFn = syncDirectory,
    syncFileFn = syncFile,
    afterPromotion,
  },
) {
  assertPortableId(body.mediaId, 'media id')
  if (!(await workspaceFingerprint(workspace)))
    throw new HttpError(
      409,
      'WORKSPACE_IDENTITY_UNAVAILABLE',
      'FreeCut workspace identity unavailable',
    )
  if (body.projectId) await getProjectResource(workspace, body.projectId)
  /** Whole import runs under the media lock: stage, promote, associate. */
  const importUnderLock = async () => {
    let existing
    try {
      existing = await getMediaResource(workspace, body.mediaId)
    } catch (error) {
      if (error.code !== 'MEDIA_NOT_FOUND') throw error
    }
    if (existing) {
      await verifyImportedResource(workspace, body)
      try {
        await associateProject(workspace, body.projectId, body.mediaId)
        await fs.promises.rm(importRoot(workspace, requestHash), { recursive: true, force: true })
        return {
          status: 200,
          response: responseFor(await getMediaResource(workspace, body.mediaId), body),
        }
      } catch (error) {
        throw markMayHaveCommitted(error)
      }
    }

    const staged = await stageImport(workspace, body, requestHash, syncFileFn)
    let unregister = () => {}
    let promoted = false
    try {
      unregister = registerTransient(body.mediaId, staged.target)
      const probeResult = await probe(staged)
      const metadata = buildImportedMetadata(body, staged, probeResult)
      await atomicWriteFile(
        path.join(staged.resourceDir, 'metadata.json'),
        Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
      )
      const mediaRoot = path.join(workspace, 'media')
      await fs.promises.mkdir(mediaRoot, { recursive: true })
      await syncDirectoryFn(workspace)
      const targetDir = resolveContained(mediaRoot, body.mediaId)
      await fs.promises.rename(staged.resourceDir, targetDir)
      promoted = true
      await syncDirectoryFn(staged.root)
      await syncDirectoryFn(mediaRoot)
      await afterPromotion?.()
      await associateProject(workspace, body.projectId, body.mediaId)
      const resource = await getMediaResource(workspace, body.mediaId)
      return { status: 201, response: responseFor(resource, body) }
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
        const resource = await verifyImportedResource(workspace, body)
        promoted = true
        try {
          await associateProject(workspace, body.projectId, body.mediaId)
          return { status: 200, response: responseFor(resource, body) }
        } catch (adoptionError) {
          throw markMayHaveCommitted(adoptionError)
        }
      }
      throw promoted ? markMayHaveCommitted(error) : error
    } finally {
      unregister()
      await fs.promises.rm(staged.root, { recursive: true, force: true }).catch(() => {})
    }
  }
  return withResourceLock(`media:${body.mediaId}`, importUnderLock)
}

/** Optional probe fields are copied through only when the probe actually reported them. */
const OPTIONAL_PROBE_FIELDS = [
  'audioCodec',
  'audioCodecSupported',
  'videoCodecSupported',
  'keyframeTimestamps',
  'gopInterval',
]

function buildImportedMetadata(body, staged, probeResult) {
  const details = probeResult.metadata ?? probeResult
  const now = Date.now()
  const optional = {}
  for (const field of OPTIONAL_PROBE_FIELDS) {
    if (field in details) optional[field] = details[field]
  }
  return {
    id: body.mediaId,
    storageType: 'workspace',
    fileName: staged.fileName,
    fileSize: staged.fileSize,
    fileLastModified: staged.fileLastModified,
    mimeType: probeResult.mimeType ?? staged.mimeType,
    sourceSha256: staged.sourceSha256,
    sourceRelativePath: staged.sourceRelativePath,
    importProbe: normalizeProbe(probeResult),
    duration: details.duration ?? 0,
    width: details.width ?? 0,
    height: details.height ?? 0,
    fps: details.type === 'video' ? (details.fps ?? 0) : 0,
    codec: details.codec ?? 'unknown',
    bitrate: details.bitrate ?? 0,
    ...optional,
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

const WORKSPACE_MARKER_MAX_BYTES = 64 * 1024

/** Read at most one buffer's worth; a marker larger than the buffer is rejected by the caller. */
async function readMarkerBytes(handle, buffer) {
  let length = 0
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
    if (bytesRead === 0) break
    length += bytesRead
  }
  return length
}

/**
 * The file we read must still be the same inode, same size and same mtime we
 * stat'ed before reading, and must not have become a symlink underneath us.
 */
function markerUnchanged({ before, after, pathAfter, length }) {
  return (
    pathAfter.isFile() &&
    !pathAfter.isSymbolicLink() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    after.dev === pathAfter.dev &&
    after.ino === pathAfter.ino &&
    length === after.size
  )
}

function parseWorkspaceMarker(bytes) {
  const value = JSON.parse(bytes.toString('utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.schemaVersion !== 'string' ||
    value.schemaVersion.length === 0
  )
    return null
  return { schemaVersion: value.schemaVersion, fingerprint: digest(bytes) }
}

/** A missing, unreadable or malformed marker is "no fingerprint", not an error. */
function isAbsentMarker(error) {
  return (
    error.code === 'ENOENT' ||
    error.code === 'ELOOP' ||
    error.code === 'ENOTDIR' ||
    error instanceof SyntaxError
  )
}

export async function workspaceFingerprint(workspace) {
  let handle
  try {
    const canonicalWorkspace = await fs.promises.realpath(workspace)
    const marker = path.join(canonicalWorkspace, '.freecut-workspace.json')
    handle = await fs.promises.open(marker, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const before = await handle.stat()
    if (!before.isFile() || before.size === 0 || before.size > WORKSPACE_MARKER_MAX_BYTES)
      return null
    const buffer = Buffer.allocUnsafe(WORKSPACE_MARKER_MAX_BYTES + 1)
    const length = await readMarkerBytes(handle, buffer)
    if (length > WORKSPACE_MARKER_MAX_BYTES) return null
    const after = await handle.stat()
    const pathAfter = await fs.promises.lstat(marker)
    if (!markerUnchanged({ before, after, pathAfter, length })) return null
    return parseWorkspaceMarker(buffer.subarray(0, length))
  } catch (error) {
    if (isAbsentMarker(error)) return null
    throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

export const requestHashOf = (bytes) => bareDigest(digest(bytes))

async function verifyImportedResource(workspace, body) {
  const resource = await getMediaResource(workspace, body.mediaId)
  assertMatchingResource(resource, body)
  const source = resolveContained(
    path.join(workspace, 'media'),
    path.join(body.mediaId, resource.metadata.fileName),
  )
  const info = await fs.promises.lstat(source)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== body.expectedByteSize)
    throw new HttpError(409, 'MEDIA_ID_CONFLICT', 'Existing media resource is incomplete')
  if ((await hashFile(source)) !== body.expectedSha256)
    throw new HttpError(409, 'MEDIA_ID_CONFLICT', 'Existing media source hash does not match')
  return resource
}
