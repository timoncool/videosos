import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
  }
}

function isSinglePathComponent(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('\0') &&
    path.posix.basename(value) === value &&
    path.win32.basename(value) === value
  )
}

export function assertSinglePathComponent(value, label = 'id') {
  if (!isSinglePathComponent(value))
    throw new HttpError(400, 'INVALID_ID', `${label} must be a single path component`)
  return value
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  )
}

const MISSING_PATH_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR'])

function resolveThroughNearestExistingAncestor(target, missingSegments = []) {
  try {
    return path.resolve(fs.realpathSync.native(target), ...missingSegments)
  } catch (error) {
    if (!MISSING_PATH_ERROR_CODES.has(Reflect.get(Object(error), 'code'))) throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return resolveThroughNearestExistingAncestor(parent, [
      path.basename(target),
      ...missingSegments,
    ])
  }
}

/** Resolve a path under root. Existing symlinks are allowed only when their canonical target remains under root. */
export function resolveContained(root, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new HttpError(403, 'PATH_OUTSIDE_ROOT', 'Path is outside the allowed root')
  }
  const resolvedRoot = path.resolve(root)
  const candidate = path.resolve(resolvedRoot, relativePath)
  if (!isContained(resolvedRoot, candidate)) {
    throw new HttpError(403, 'PATH_OUTSIDE_ROOT', 'Path is outside the allowed root')
  }
  const canonicalRoot = resolveThroughNearestExistingAncestor(resolvedRoot)
  const canonicalCandidate = resolveThroughNearestExistingAncestor(candidate)
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new HttpError(403, 'PATH_OUTSIDE_ROOT', 'Symlink target is outside the allowed root')
  }
  return canonicalCandidate
}

export function decodeRequestPath(req) {
  const raw = (req.url ?? '/').split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new HttpError(400, 'INVALID_URL_ENCODING', 'Malformed URL encoding')
  }
}

export function requireGetOrHead(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('method not allowed')
  return false
}

function parseSingleByteRange(header, size) {
  if (header === undefined) return null
  if (typeof header !== 'string' || header.includes(',')) return false
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size === 0) return false
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    requestedEnd < start
  )
    return false
  return { start, end: Math.min(requestedEnd, size - 1) }
}

export async function serveFile(req, res, filePath, { contentType, allowRange = false } = {}) {
  let info
  try {
    info = await fs.promises.stat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')
      throw new HttpError(404, 'NOT_FOUND', 'not found')
    throw error
  }
  if (!info.isFile()) throw new HttpError(404, 'NOT_FOUND', 'not found')
  const size = info.size
  if (contentType) res.setHeader('Content-Type', contentType)
  if (allowRange) res.setHeader('Accept-Ranges', 'bytes')
  const range = allowRange ? parseSingleByteRange(req.headers.range, size) : null
  if (range === false) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': 0 })
    res.end()
    return
  }
  const status = range ? 206 : 200
  const start = range?.start
  const end = range?.end
  const length = range ? end - start + 1 : size
  const headers = { 'Content-Length': length }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  res.writeHead(status, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(filePath, range ? { start, end } : undefined)
  const abort = () => stream.destroy()
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    await pipeline(stream, res)
  } catch (error) {
    if (!req.aborted && !res.destroyed) throw error
  } finally {
    req.off('aborted', abort)
    res.off('close', abort)
  }
}

export function sendHttpError(res, error) {
  if (res.headersSent || res.destroyed) {
    res.destroy()
    return
  }
  const status = error instanceof HttpError ? error.statusCode : 500
  const message = error instanceof HttpError ? error.message : 'internal server error'
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(message),
    ...(status === 408 || status === 413 ? { Connection: 'close' } : {}),
  })
  res.end(message)
}

export function readJsonBody(req, { maxBytes = 64 * 1024 * 1024, timeoutMs = 30_000 } = {}) {
  return readJsonBodyWithBytes(req, { maxBytes, timeoutMs }).then(({ value }) => value)
}

/** Read a JSON body while retaining the exact bytes for idempotency hashing. */
export function readJsonBodyWithBytes(
  req,
  { maxBytes = 64 * 1024 * 1024, timeoutMs = 30_000 } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let bytes = 0
    const chunks = []
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
      fn(value)
    }
    const onData = (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        req.pause()
        finish(reject, new HttpError(413, 'BODY_TOO_LARGE', 'Request body too large'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      try {
        const rawBytes = Buffer.concat(chunks)
        const data = rawBytes.toString('utf8')
        finish(resolve, { value: data ? JSON.parse(data) : {}, rawBytes })
      } catch (error) {
        finish(reject, new HttpError(400, 'INVALID_JSON', `Invalid JSON body: ${error.message}`))
      }
    }
    const onError = (error) => finish(reject, error)
    const onAborted = () => finish(reject, new HttpError(400, 'REQUEST_ABORTED', 'Request aborted'))
    const timer = setTimeout(() => {
      req.pause()
      finish(reject, new HttpError(408, 'BODY_TIMEOUT', 'Request body timed out'))
    }, timeoutMs)
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
    const declaredLength = Number(req.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.pause()
      finish(reject, new HttpError(413, 'BODY_TOO_LARGE', 'Request body too large'))
    }
  })
}

export function setHttpTimeouts(
  server,
  { headersTimeoutMs = 10_000, requestTimeoutMs = 30_000 } = {},
) {
  server.headersTimeout = headersTimeoutMs
  server.requestTimeout = requestTimeoutMs
}
