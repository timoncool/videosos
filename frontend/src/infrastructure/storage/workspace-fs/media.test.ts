// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { handlesMocks } from '../test-utils/storage-test-mocks'

import * as fsPrimitives from './fs-primitives'
import {
  createMedia,
  deleteMedia,
  getAllMedia,
  getAllMediaMetadata,
  getMedia,
  updateMedia,
  validateMediaHandle,
} from './media'
import { setWorkspaceRoot } from './root'
import { type MemDir, asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

function makeMedia(id: string, overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id,
    storageType: 'opfs',
    opfsPath: `content/${id}`,
    fileName: `${id}.mp4`,
    fileSize: 1000,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000000,
    ...overrides,
  } as MediaMetadata
}

beforeEach(() => {
  handlesMocks.getHandle.mockReset().mockResolvedValue(null)
  handlesMocks.saveHandle.mockClear()
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs media', () => {
  it('createMedia writes metadata.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    const text = await readFileText(root, 'media', 'm1', 'metadata.json')
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.id).toBe('m1')
    expect(parsed.fileName).toBe('m1.mp4')
  })

  it('createMedia rejects duplicate ids', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await expect(createMedia(makeMedia('m1'))).rejects.toThrow(/already exists/)
  })

  it('getMedia returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getMedia('missing')).toBeUndefined()
  })

  it('getAllMedia returns every metadata.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('a'))
    await createMedia(makeMedia('b'))
    const all = await getAllMedia()
    expect(new Set(all.map((m) => m.id))).toEqual(new Set(['a', 'b']))
  })

  it('getAllMediaMetadata skips handle restoration for import duplicate scans', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const fakeHandle = { name: 'clip.mp4' } as FileSystemFileHandle
    await createMedia(makeMedia('m1', { storageType: 'handle', fileHandle: fakeHandle }))

    handlesMocks.getHandle.mockClear()
    const all = await getAllMediaMetadata()

    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe('m1')
    expect(all[0]?.fileHandle).toBeUndefined()
    expect(handlesMocks.getHandle).not.toHaveBeenCalled()
  })

  it('updateMedia merges fields', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1', { fileName: 'orig.mp4' }))
    await updateMedia('m1', { fileName: 'renamed.mp4' })
    const after = await getMedia('m1')
    expect(after!.fileName).toBe('renamed.mp4')
  })

  it('updateMedia throws when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(updateMedia('nope', { fileName: 'x' })).rejects.toThrow(/not found/)
  })

  it('deleteMedia removes the whole media folder', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await deleteMedia('m1')
    expect(await readFileText(root, 'media', 'm1', 'metadata.json')).toBeNull()
  })

  it('stashes FileSystemFileHandle in handles-db and strips it from JSON', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const fakeHandle = { name: 'clip.mp4' } as FileSystemFileHandle
    await createMedia(makeMedia('m1', { storageType: 'handle', fileHandle: fakeHandle }))
    const text = await readFileText(root, 'media', 'm1', 'metadata.json')
    const parsed = JSON.parse(text!)
    expect(parsed.fileHandle).toBeUndefined()
    expect(handlesMocks.saveHandle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'media', id: 'm1', handle: fakeHandle }),
    )
  })

  it('restores FileSystemFileHandle from handles-db on read', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    const fakeHandle = { name: 'restored.mp4' } as FileSystemFileHandle
    handlesMocks.getHandle.mockImplementation(async (kind: string, id: string) =>
      kind === 'media' && id === 'm1'
        ? { kind, id, handle: fakeHandle, name: 'restored.mp4', key: `${kind}:${id}`, pickedAt: 0 }
        : null,
    )
    const loaded = await getMedia('m1')
    expect(loaded!.fileHandle).toBe(fakeHandle)
  })

  it('does not mark handle-backed media changed for mtime-only drift', async () => {
    const fileHandle = {
      getFile: vi.fn(async () => ({ size: 1000, lastModified: 2222 })),
    } as unknown as FileSystemFileHandle
    handlesMocks.getHandle.mockResolvedValue({
      kind: 'media',
      id: 'm1',
      handle: fileHandle,
      name: 'network-drive.mp4',
      key: 'media:m1',
      pickedAt: 0,
      lastSeenSize: 1000,
      lastSeenMtime: 1111,
    })

    await expect(validateMediaHandle('m1')).resolves.toEqual({ kind: 'ok' })
  })

  it('marks handle-backed media changed when byte size differs', async () => {
    const fileHandle = {
      getFile: vi.fn(async () => ({ size: 1200, lastModified: 2222 })),
    } as unknown as FileSystemFileHandle
    handlesMocks.getHandle.mockResolvedValue({
      kind: 'media',
      id: 'm1',
      handle: fileHandle,
      name: 'changed.mp4',
      key: 'media:m1',
      pickedAt: 0,
      lastSeenSize: 1000,
      lastSeenMtime: 1111,
    })

    await expect(validateMediaHandle('m1')).resolves.toEqual({
      kind: 'changed',
      currentSize: 1200,
      currentMtime: 2222,
    })
  })

  it('getAllMedia skips a corrupt metadata.json and returns healthy entries', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await createMedia(makeMedia('m2'))
    await corruptFile(root, 'media', 'm2', 'metadata.json')

    const all = await getAllMedia()
    expect(all.map((m) => m.id)).toEqual(['m1'])
  })

  it('getAllMediaMetadata skips a corrupt metadata.json and returns healthy entries', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('m1'))
    await createMedia(makeMedia('m2'))
    await corruptFile(root, 'media', 'm2', 'metadata.json')

    const all = await getAllMediaMetadata()
    expect(all.map((m) => m.id)).toEqual(['m1'])
  })

  it('getAllMedia preserves directory-listing order under parallel reads', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5']
    for (const id of ids) {
      await createMedia(makeMedia(id))
    }

    // Intercept readJson and resolve in reverse order to prove index-preserving
    // concurrency (mapWithConcurrency writes results by index, not by arrival)
    const real = fsPrimitives.readJson.bind(fsPrimitives)
    let callOrder = 0
    const spy = vi.spyOn(fsPrimitives, 'readJson').mockImplementation(async (root, segments) => {
      const delay = (ids.length - callOrder++) * 2 // first call delays most
      await new Promise((r) => setTimeout(r, delay))
      return real(root, segments)
    })

    const all = await getAllMedia()
    spy.mockRestore()

    expect(all.map((m) => m.id)).toEqual(ids)
  })

  it('getAllMedia skips corrupt entries alongside valid ones under parallelism', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const ids = ['q1', 'q2', 'q3', 'q4']
    for (const id of ids) {
      await createMedia(makeMedia(id))
    }
    // Corrupt the second and fourth entries
    await corruptFile(root, 'media', 'q2', 'metadata.json')
    await corruptFile(root, 'media', 'q4', 'metadata.json')

    const all = await getAllMedia()
    expect(all.map((m) => m.id)).toEqual(['q1', 'q3'])
  })

  it('getAllMedia rejects with wrapped error when a non-corrupt readJson error occurs', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createMedia(makeMedia('r1'))
    await createMedia(makeMedia('r2'))

    const boom = new Error('disk read error')
    const spy = vi.spyOn(fsPrimitives, 'readJson').mockRejectedValueOnce(boom)

    await expect(getAllMedia()).rejects.toThrow('Failed to load media from workspace')
    spy.mockRestore()
  })
})

/** Overwrite a file in the in-memory FS with arbitrary raw text. */
async function corruptFile(dir: MemDir, ...segments: string[]): Promise<void> {
  let current = dir
  for (let i = 0; i < segments.length - 1; i++) {
    current = await current.getDirectoryHandle(segments[i]!)
  }
  const filename = segments[segments.length - 1]!
  const fh = await current.getFileHandle(filename, { create: true })
  const writable = await fh.createWritable()
  await writable.write('{not json')
  await writable.close()
}
