/**
 * Filesystem primitives over FileSystemDirectoryHandle.
 *
 * Every higher-level storage module in workspace-fs calls these. They:
 *  - resolve path segments via nested getDirectoryHandle({ create: true })
 *  - read/write JSON and binary blobs
 *  - write JSON atomically (tmp-file + replace) so index.json / project.json
 *    don't tear on crash
 *  - convert NotFoundError to typed null returns so callers don't have to
 *    do try/catch everywhere
 *  - detect NotAllowedError (permission revoked) and emit a signal so UI
 *    can prompt re-grant
 *
 * Path inputs are arrays of segments — consistent with paths.ts.
 */

import { createLogger } from '@/shared/logging/logger'
import { notifyPermissionLost } from './root'
import { describeStorageEnvironment } from './storage-environment'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS')

/** A file exists but its content is not valid JSON. */
export class WorkspaceFileCorruptError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`Corrupt JSON at ${path}`)
    this.name = 'WorkspaceFileCorruptError'
    this.cause = cause
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function isNotSupported(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotSupportedError'
}

function wrap<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (isNotAllowed(error)) {
      notifyPermissionLost()
    }
    logger.warn(`${operation} failed`, error)
    throw error
  })
}

/**
 * Walk a path of directory segments, creating each if missing.
 * Last segment is returned as the directory handle.
 */
async function resolveDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create })
  }
  return dir
}

/**
 * Resolve segments to (parent dir, file name). Segments must have length >= 1.
 */
async function resolveFileParent(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<{ parent: FileSystemDirectoryHandle; fileName: string }> {
  if (segments.length === 0) {
    throw new Error('fs-primitives: empty path segments')
  }
  const parentSegments = segments.slice(0, -1)
  const fileName = segments[segments.length - 1]!
  const parent = await resolveDir(root, parentSegments, create)
  return { parent, fileName }
}

/* ────────────────────────────── Read helpers ─────────────────────────── */

export async function readJson<T>(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<T | null> {
  return wrap('readJson', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      const file = await parent.getFileHandle(fileName, { create: false })
      const blob = await file.getFile()
      const text = await blob.text()
      if (text.length === 0) return null
      try {
        return JSON.parse(text) as T
      } catch (error) {
        throw new WorkspaceFileCorruptError(segments.join('/'), error)
      }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  })
}

export async function readBlob(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<Blob | null> {
  return wrap('readBlob', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      const file = await parent.getFileHandle(fileName, { create: false })
      return await file.getFile()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  })
}

export async function readArrayBuffer(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<ArrayBuffer | null> {
  const blob = await readBlob(root, segments)
  if (!blob) return null
  return blob.arrayBuffer()
}

/* ────────────────────────────── Write helpers ────────────────────────── */

/**
 * Atomic JSON write: writes to `{name}.tmp`, then replaces the target.
 * Protects against torn writes on crash. Uses FileSystemFileHandle.move
 * (Chromium) when available, falls back to write-then-remove-tmp.
 *
 * Serialized per-path by an in-memory lock. Without this, two concurrent
 * callers racing on the same path can deadlock each other's move():
 *   - A: open tmp writable, write, close → begin .move()
 *   - B: open tmp writable (A has closed, so B succeeds) → write
 *   - A: .move() throws NoModificationAllowedError — "cannot move while
 *     the handle is locked" (B's writable is open on the same tmp)
 * The lock scope is one tab; cross-tab races on the same path are still
 * last-write-wins but can't produce the locked-handle error because each
 * tab has its own tmp writable lifecycle.
 */
function writeJsonAtomicLockKey(segments: string[]): string {
  return `writeJsonAtomic:${segments.join('/')}`
}

type MovableHandle = FileSystemFileHandle & {
  move?: (parent: FileSystemDirectoryHandle, newName: string) => Promise<void>
}

/**
 * Workspace roots whose `FileSystemFileHandle.move()` rejected as unsupported.
 *
 * `move` is always present on the prototype in Chromium, yet calling it can
 * still reject with NotSupportedError. This is not a blanket "not implemented":
 * Chromium has shipped move() for local files since M111. The spec permits
 * rejection when the file "does not correspond to a file on the underlying file
 * system", which covers cloud-synced and network folders, and pre-M111 engines
 * reject every non-OPFS move. Our root always comes from showDirectoryPicker(),
 * so we are never on the guaranteed-OPFS path.
 *
 * Presence is therefore NOT support; the only way to find out is to call it. We
 * remember the answer so at most one doomed move() happens per workspace rather
 * than one per write.
 *
 * Keyed on the root handle, NOT module-global: `setWorkspaceRoot` can swap the
 * active root mid-session (reconnect, or "choose a different folder" after this
 * very failure). A session-global flag would strand a freshly picked local
 * folder — where move() works fine — on the non-atomic fallback for the rest of
 * the page. A WeakSet also lets a discarded root be collected.
 *
 * Never un-set for a given root: a handle that rejects move() once will keep
 * rejecting it, since the answer is a property of the underlying filesystem.
 */
const rootsRejectingMove = new WeakSet<FileSystemDirectoryHandle>()

/**
 * Replace `fileName` with the already-written `tmpName` in `parent`.
 * Prefers rename (truly atomic), degrades to copy + delete.
 */
async function commitTmpFile(
  root: FileSystemDirectoryHandle,
  parent: FileSystemDirectoryHandle,
  tmpHandle: FileSystemFileHandle,
  tmpName: string,
  fileName: string,
  json: string,
): Promise<void> {
  const movable = tmpHandle as MovableHandle
  if (!rootsRejectingMove.has(root) && typeof movable.move === 'function') {
    try {
      await movable.move(parent, fileName)
      return
    } catch (error) {
      if (!isNotSupported(error)) throw error
      rootsRejectingMove.add(root)
      // Logged once per workspace (the set short-circuits later writes). Carries
      // the environment because the error alone cannot say *why* it rejected.
      logger.warn(
        'writeJsonAtomic: FileSystemFileHandle.move() rejected as unsupported — ' +
          'falling back to a non-atomic copy+delete for this workspace',
        { environment: describeStorageEnvironment() },
        error,
      )
    }
  }

  // Fallback: copy tmp → target, then remove tmp. Not atomic — a crash between
  // the two closes leaves a torn target — but it is the only option available.
  const targetHandle = await parent.getFileHandle(fileName, { create: true })
  const targetWritable = await targetHandle.createWritable()
  await targetWritable.write(json)
  await targetWritable.close()
  try {
    await parent.removeEntry(tmpName)
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

export async function writeJsonAtomic(
  root: FileSystemDirectoryHandle,
  segments: string[],
  data: unknown,
): Promise<number> {
  return wrap('writeJsonAtomic', () =>
    withKeyLock(writeJsonAtomicLockKey(segments), async () => {
      const { parent, fileName } = await resolveFileParent(root, segments, true)
      const tmpName = `${fileName}.tmp`
      const json = JSON.stringify(data, null, 2)

      const tmpHandle = await parent.getFileHandle(tmpName, { create: true })
      const writable = await tmpHandle.createWritable()
      await writable.write(json)
      await writable.close()

      await commitTmpFile(root, parent, tmpHandle, tmpName, fileName, json)

      return json.length
    }),
  )
}

export async function writeBlob(
  root: FileSystemDirectoryHandle,
  segments: string[],
  data: Blob | ArrayBuffer | Uint8Array | string,
): Promise<void> {
  // Serialized per-path for the same reason as writeJsonAtomic: two
  // concurrent writers on the same file race on the writable lock. In
  // writeBlob's case the loser fails at createWritable with
  // NoModificationAllowedError rather than at move(), but the fix is
  // identical. Different paths use different lock keys, so this does
  // not constrain parallelism of unrelated writes.
  return wrap('writeBlob', () =>
    withKeyLock(`writeBlob:${segments.join('/')}`, async () => {
      const { parent, fileName } = await resolveFileParent(root, segments, true)
      const fh = await parent.getFileHandle(fileName, { create: true })
      const writable = await fh.createWritable()
      await writable.write(data as FileSystemWriteChunkType)
      await writable.close()
    }),
  )
}

/* ────────────────────────────── Delete helpers ───────────────────────── */

/**
 * Remove a file or a whole subtree. No-op when missing.
 */
export async function removeEntry(
  root: FileSystemDirectoryHandle,
  segments: string[],
  options: { recursive?: boolean } = {},
): Promise<void> {
  if (segments.length === 0) {
    throw new Error('fs-primitives: refusing to remove empty path')
  }
  return wrap('removeEntry', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      await parent.removeEntry(fileName, { recursive: options.recursive ?? false })
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
  })
}

/* ────────────────────────────── Enumeration ──────────────────────────── */

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}

export async function listDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<DirectoryEntry[]> {
  return wrap('listDirectory', async () => {
    try {
      const dir = await resolveDir(root, segments, false)
      const entries: DirectoryEntry[] = []
      for await (const entry of dir.values()) {
        entries.push({ name: entry.name, kind: entry.kind })
      }
      return entries
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  })
}

/**
 * List a directory and read all matching files in a single resolved-dir pass.
 *
 * Calling readBlob() per file forces resolveDir() to re-walk the segments
 * (4 getDirectoryHandle calls for typical media paths) on every read. For
 * directories with many files this dominates wall time. This helper resolves
 * the parent dir once and reuses its file-handle iterator, then reads all
 * files concurrently.
 */
export async function readDirectoryFiles(
  root: FileSystemDirectoryHandle,
  segments: string[],
  filter?: (entry: DirectoryEntry) => boolean,
): Promise<Array<{ name: string; blob: Blob }>> {
  return wrap('readDirectoryFiles', async () => {
    try {
      const dir = await resolveDir(root, segments, false)
      const fileHandles: Array<{ name: string; handle: FileSystemFileHandle }> = []
      for await (const entry of dir.values()) {
        if (entry.kind !== 'file') continue
        if (filter && !filter({ name: entry.name, kind: entry.kind })) continue
        fileHandles.push({ name: entry.name, handle: entry as FileSystemFileHandle })
      }
      const results = await Promise.all(
        fileHandles.map(async ({ name, handle }) => {
          try {
            const file = await handle.getFile()
            return { name, blob: file as Blob }
          } catch (error) {
            // A file can disappear between iterating dir.values() and calling
            // getFile() (e.g. concurrent delete). Skip it instead of failing
            // the whole batch.
            if (isNotFound(error)) return null
            throw error
          }
        }),
      )
      return results.filter((r): r is { name: string; blob: Blob } => r !== null)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  })
}

export async function exists(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<boolean> {
  try {
    const { parent, fileName } = await resolveFileParent(root, segments, false)
    try {
      await parent.getFileHandle(fileName, { create: false })
      return true
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    try {
      await parent.getDirectoryHandle(fileName, { create: false })
      return true
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    return false
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}
