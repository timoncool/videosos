// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const fsMocks = vi.hoisted(() => ({
  readBlob: vi.fn(),
  readDirectoryFiles: vi.fn(),
  readJson: vi.fn(),
  writeBlob: vi.fn(),
  writeJsonAtomic: vi.fn(),
  removeEntry: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/infrastructure/storage/cache-version', () => ({
  getCacheMigration: vi.fn(() => ({
    needsMigration: false,
    markComplete: vi.fn(),
  })),
}))

vi.mock('@/infrastructure/storage/workspace-fs/fs-primitives', () => fsMocks)

vi.mock('@/infrastructure/storage/workspace-fs/root', () => ({
  requireWorkspaceRoot: vi.fn(() => 'workspace-root'),
}))

vi.mock('@/infrastructure/storage/workspace-fs/paths', () => ({
  filmstripDir: vi.fn((mediaId: string) => ['media', mediaId, 'cache', 'filmstrip']),
  filmstripFramePath: vi.fn((mediaId: string, index: number, ext: string) => [
    'media',
    mediaId,
    'cache',
    'filmstrip',
    `${index}.${ext}`,
  ]),
  filmstripMetaPath: vi.fn((mediaId: string) => [
    'media',
    mediaId,
    'cache',
    'filmstrip',
    'meta.json',
  ]),
}))

import { filmstripStorage } from './filmstrip-storage'

describe('filmstripStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      callback()
      return 1
    })

    let urlIndex = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:frame-${urlIndex++}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    fsMocks.readJson.mockResolvedValue({
      version: 2,
      width: 160,
      height: 90,
      isComplete: true,
      frameCount: 2,
    })
    fsMocks.listDirectory.mockResolvedValue([
      { kind: 'file', name: '0.jpg' },
      { kind: 'file', name: '1.jpg' },
    ])
    fsMocks.readBlob.mockResolvedValue(new Blob(['frame'], { type: 'image/jpeg' }))
    fsMocks.readDirectoryFiles.mockResolvedValue([
      { name: '0.jpg', blob: new Blob(['frame'], { type: 'image/jpeg' }) },
      { name: '1.jpg', blob: new Blob(['frame'], { type: 'image/jpeg' }) },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not revoke unrequested frame URLs during single-frame loads', async () => {
    await filmstripStorage.load('media-1')
    await filmstripStorage.loadSingleFrame('media-1', 1)

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-0')
  })

  it('yields while materializing persisted frame URLs', async () => {
    const storedFrames = Array.from({ length: 5 }, (_, index) => ({
      name: `${index}.jpg`,
      blob: new Blob([`frame-${index}`], { type: 'image/jpeg' }),
    }))
    fsMocks.readJson.mockResolvedValue({
      version: 2,
      width: 160,
      height: 90,
      isComplete: true,
      frameCount: storedFrames.length,
    })
    fsMocks.readDirectoryFiles.mockResolvedValue(storedFrames)

    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 5
      return now
    })
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const loaded = await filmstripStorage.load('media-yield')

    expect(timeoutSpy).toHaveBeenCalledTimes(storedFrames.length - 1)
    expect(loaded?.frames.map((frame) => frame.index)).toEqual([0, 1, 2, 3, 4])
    expect(loaded?.frames.map((frame) => frame.url)).toEqual([
      'blob:frame-0',
      'blob:frame-1',
      'blob:frame-2',
      'blob:frame-3',
      'blob:frame-4',
    ])
  })

  it('does not publish a full load after a newer single-frame load', async () => {
    let resumeFirstYield: (() => void) | undefined
    let markFirstYieldReached: (() => void) | undefined
    const firstYieldReached = new Promise<void>((resolve) => {
      markFirstYieldReached = resolve
    })
    let yieldCount = 0
    vi.stubGlobal('scheduler', {
      yield: vi.fn(() => {
        yieldCount++
        if (yieldCount !== 1) return Promise.resolve()
        markFirstYieldReached?.()
        return new Promise<void>((resolve) => {
          resumeFirstYield = resolve
        })
      }),
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 5
      return now
    })

    const staleLoad = filmstripStorage.load('media-single-frame-race')
    await firstYieldReached
    const newerFrame = await filmstripStorage.loadSingleFrame('media-single-frame-race', 1)
    resumeFirstYield?.()

    expect(await staleLoad).toBeNull()
    expect(newerFrame?.url).toBe('blob:frame-1')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-0')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-1')
  })

  it('does not let an older full load replace a newer full load', async () => {
    let resumeFirstYield: (() => void) | undefined
    let markFirstYieldReached: (() => void) | undefined
    const firstYieldReached = new Promise<void>((resolve) => {
      markFirstYieldReached = resolve
    })
    let yieldCount = 0
    vi.stubGlobal('scheduler', {
      yield: vi.fn(() => {
        yieldCount++
        if (yieldCount !== 1) return Promise.resolve()
        markFirstYieldReached?.()
        return new Promise<void>((resolve) => {
          resumeFirstYield = resolve
        })
      }),
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 5
      return now
    })

    const staleLoad = filmstripStorage.load('media-full-load-race')
    await firstYieldReached
    const newerLoad = await filmstripStorage.load('media-full-load-race')
    resumeFirstYield?.()

    expect(await staleLoad).toBeNull()
    expect(newerLoad?.frames.map((frame) => frame.url)).toEqual(['blob:frame-1', 'blob:frame-2'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-0')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-2')
  })

  it('does not publish a full load after its media URLs are cleared', async () => {
    let resumeYield: (() => void) | undefined
    let markYieldReached: (() => void) | undefined
    const yieldReached = new Promise<void>((resolve) => {
      markYieldReached = resolve
    })
    vi.stubGlobal('scheduler', {
      yield: vi.fn(() => {
        markYieldReached?.()
        return new Promise<void>((resolve) => {
          resumeYield = resolve
        })
      }),
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 5
      return now
    })

    const staleLoad = filmstripStorage.load('media-clear-race')
    await yieldReached
    filmstripStorage.revokeUrls('media-clear-race')
    resumeYield?.()

    expect(await staleLoad).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-0')
  })
})
