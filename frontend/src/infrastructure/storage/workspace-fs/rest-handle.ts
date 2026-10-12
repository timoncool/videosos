/**
 * The workspace on the VideoSOS server, behind the File System Access shape the
 * storage layer already speaks.
 *
 * Every workspace-fs module walks one root `FileSystemDirectoryHandle`; in the
 * desktop app that root is `data/workspace` on disk, owned by the Rust server,
 * so the server, MCP tools and finished generations see the same files. Each
 * handle call maps to one `/api/fs/*` route; a failed call rethrows the
 * DOMException the server names, because callers branch on those names
 * (`NotFoundError`, `TypeMismatchError`, `NotSupportedError`, ...).
 */

const API = '/api/fs'

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function join(parent: string, name: string): string {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Name is not allowed: ${name}`)
  }
  return parent ? `${parent}/${name}` : name
}

async function fail(response: Response): Promise<never> {
  let name = 'InvalidStateError'
  let message = `${response.status} ${response.statusText}`
  try {
    const body = (await response.json()) as { name?: string; message?: string }
    if (body.name) name = body.name
    if (body.message) message = body.message
  } catch {
    // a body that is not the server's JSON keeps the status line as the message
  }
  throw new DOMException(message, name)
}

async function call(method: string, route: string, params: Record<string, string>, body?: BodyInit): Promise<Response> {
  const response = await fetch(`${API}/${route}?${query(params)}`, { method, body, cache: 'no-store' })
  if (!response.ok) await fail(response)
  return response
}

interface Stat {
  kind: 'file' | 'directory'
  size: number | null
  modified: number | null
}

async function stat(path: string): Promise<Stat> {
  return (await (await call('GET', 'stat', { path })).json()) as Stat
}

/** The URL the server streams the file from, with byte ranges. */
function restFileUrl(path: string): string {
  return `${API}/read?${query({ path })}`
}

type WriteChunk = string | BufferSource | Blob | { type?: string; data?: unknown; position?: number; size?: number }

class RestWritable {
  private parts: BlobPart[] = []
  private closed = false

  constructor(private readonly path: string) {}

  async write(chunk: WriteChunk): Promise<void> {
    if (this.closed) throw new DOMException('The stream is closed', 'InvalidStateError')
    if (chunk && typeof chunk === 'object' && !(chunk instanceof Blob) && !ArrayBuffer.isView(chunk) && !(chunk instanceof ArrayBuffer)) {
      const command = chunk as { type?: string; data?: unknown; position?: number }
      if (command.type !== 'write' || command.position !== undefined) {
        throw new DOMException(`Writable command ${command.type ?? 'unknown'} is not supported here`, 'NotSupportedError')
      }
      await this.write(command.data as WriteChunk)
      return
    }
    this.parts.push(chunk as BlobPart)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await call('PUT', 'write', { path: this.path }, new Blob(this.parts))
    this.parts = []
  }

  async abort(): Promise<void> {
    this.closed = true
    this.parts = []
  }
}

abstract class RestHandle {
  abstract readonly kind: 'file' | 'directory'

  constructor(
    readonly path: string,
    readonly name: string,
  ) {}

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof RestHandle && other.kind === this.kind && other.path === this.path
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

class RestFileHandle extends RestHandle {
  readonly kind = 'file' as const

  async getFile(): Promise<File> {
    const response = await call('GET', 'read', { path: this.path })
    const blob = await response.blob()
    const modified = Date.parse(response.headers.get('last-modified') ?? '')
    return new File([blob], this.name, {
      type: blob.type,
      lastModified: Number.isFinite(modified) ? modified : Date.now(),
    })
  }

  /** Byte ranges of the file without reading it whole (video decoding, waveforms). */
  get url(): string {
    return restFileUrl(this.path)
  }

  async createWritable(): Promise<RestWritable> {
    return new RestWritable(this.path)
  }

  async move(target: RestDirectoryHandle | string, newName?: string): Promise<void> {
    const parent = typeof target === 'string' ? this.path.split('/').slice(0, -1).join('/') : target.path
    const name = typeof target === 'string' ? target : (newName ?? this.name)
    const to = join(parent, name)
    await call('POST', 'move', { from: this.path, to })
    ;(this as { path: string }).path = to
    ;(this as { name: string }).name = name
  }

  async remove(): Promise<void> {
    await call('DELETE', 'remove', { path: this.path })
  }
}

class RestDirectoryHandle extends RestHandle {
  readonly kind = 'directory' as const

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<RestDirectoryHandle> {
    const path = join(this.path, name)
    if (options.create) {
      await call('POST', 'mkdir', { path })
    } else {
      const found = await stat(path)
      if (found.kind !== 'directory') throw new DOMException(`${path} is a file`, 'TypeMismatchError')
    }
    return new RestDirectoryHandle(path, name)
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<RestFileHandle> {
    const path = join(this.path, name)
    if (options.create) {
      await call('POST', 'touch', { path })
    } else {
      const found = await stat(path)
      if (found.kind !== 'file') throw new DOMException(`${path} is a folder`, 'TypeMismatchError')
    }
    return new RestFileHandle(path, name)
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    await call('DELETE', 'remove', { path: join(this.path, name), recursive: String(Boolean(options.recursive)) })
  }

  async resolve(possibleDescendant: RestHandle): Promise<string[] | null> {
    if (!(possibleDescendant instanceof RestHandle)) return null
    if (possibleDescendant.path === this.path) return []
    const prefix = this.path ? `${this.path}/` : ''
    if (!possibleDescendant.path.startsWith(prefix)) return null
    return possibleDescendant.path.slice(prefix.length).split('/')
  }

  private async list(): Promise<RestHandle[]> {
    const response = await call('GET', 'list', { path: this.path })
    const entries = (await response.json()) as Array<{ name: string; kind: 'file' | 'directory' }>
    return entries.map((entry) =>
      entry.kind === 'directory'
        ? new RestDirectoryHandle(join(this.path, entry.name), entry.name)
        : new RestFileHandle(join(this.path, entry.name), entry.name),
    )
  }

  async *values(): AsyncIterableIterator<RestHandle> {
    for (const handle of await this.list()) yield handle
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const handle of await this.list()) yield handle.name
  }

  async *entries(): AsyncIterableIterator<[string, RestHandle]> {
    for (const handle of await this.list()) yield [handle.name, handle]
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, RestHandle]> {
    return this.entries()
  }
}

/** The workspace root of the server this page was served from. */
export function createServerWorkspaceRoot(): FileSystemDirectoryHandle {
  return new RestDirectoryHandle('', 'workspace') as unknown as FileSystemDirectoryHandle
}

/** Whether this page runs inside VideoSOS, with its server behind the same origin. */
export async function detectServerWorkspace(): Promise<boolean> {
  try {
    const response = await fetch('/api/info', { cache: 'no-store' })
    if (!response.ok) return false
    const info = (await response.json()) as { app?: string }
    return info.app === 'videosos'
  } catch {
    return false
  }
}
