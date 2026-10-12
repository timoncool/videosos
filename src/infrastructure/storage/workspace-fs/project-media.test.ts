// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import '../test-utils/storage-test-mocks'

const mediaMocks = vi.hoisted(() => ({
  getMedia: vi.fn().mockResolvedValue(null),
}))

vi.mock('./media', () => mediaMocks)

import {
  associateMediaWithProject,
  getMediaForProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  removeMediaBatchFromProject,
  removeMediaFromProject,
} from './project-media'
import { createProject } from './projects'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'

function makeProject(id: string, updatedAt = 1000): Project {
  return {
    id,
    name: id,
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: updatedAt,
    updatedAt,
  } as Project
}

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs project-media', () => {
  it('shares concurrent project media loads during editor startup', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    const media = {
      id: 'm1',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
    } as MediaMetadata
    let resolveMedia!: (value: MediaMetadata) => void
    mediaMocks.getMedia.mockImplementation(
      () => new Promise<MediaMetadata>((resolve) => (resolveMedia = resolve)),
    )

    const first = getMediaForProject('p1')
    const second = getMediaForProject('p1')
    expect(first).toBe(second)
    await vi.waitFor(() => expect(mediaMocks.getMedia).toHaveBeenCalledOnce())
    resolveMedia(media)

    await expect(first).resolves.toEqual([media])
    await expect(second).resolves.toEqual([media])
    expect(mediaMocks.getMedia).toHaveBeenCalledOnce()
  })

  it('associateMediaWithProject writes media-links.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')

    const text = await readFileText(root, 'projects', 'p1', 'media-links.json')
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.mediaIds.map((e: { id: string }) => e.id)).toEqual(['m1'])
  })

  it('associateMediaWithProject is idempotent', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    await associateMediaWithProject('p1', 'm1')
    const ids = await getProjectMediaIds('p1')
    expect(ids).toEqual(['m1'])
  })

  it('removeMediaFromProject removes only the target mediaId', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    await associateMediaWithProject('p1', 'm2')
    await removeMediaFromProject('p1', 'm1')
    expect(await getProjectMediaIds('p1')).toEqual(['m2'])
  })

  it('removeMediaBatchFromProject removes all targets in one project', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')
    await associateMediaWithProject('p1', 'm2')
    await associateMediaWithProject('p1', 'm3')

    await removeMediaBatchFromProject('p1', ['m1', 'm3'])

    expect(await getProjectMediaIds('p1')).toEqual(['m2'])
  })

  it('getProjectMediaIds returns empty for projects with no associations', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await getProjectMediaIds('p1')).toEqual([])
  })

  it('getMediaForProject fails the load (and preserves the link) when a metadata read throws', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'm1')

    mediaMocks.getMedia.mockReset()
    mediaMocks.getMedia.mockRejectedValue(new Error('disk locked'))

    // A genuine read error must reject rather than silently drop the item.
    await expect(getMediaForProject('p1')).rejects.toThrow()
    // The association must survive — the item is not a confirmed orphan.
    expect(await getProjectMediaIds('p1')).toEqual(['m1'])

    mediaMocks.getMedia.mockReset()
    mediaMocks.getMedia.mockResolvedValue(null)
  })

  it('getMediaForProject orphans only media whose metadata is confirmed missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await associateMediaWithProject('p1', 'good')
    await associateMediaWithProject('p1', 'gone')

    mediaMocks.getMedia.mockReset()
    mediaMocks.getMedia.mockImplementation(async (id: string) =>
      id === 'good' ? ({ id: 'good' } as MediaMetadata) : null,
    )

    const media = await getMediaForProject('p1')
    expect(media.map((m) => m.id)).toEqual(['good'])
    // 'gone' had no metadata → cleaned up as an orphan association.
    expect(await getProjectMediaIds('p1')).toEqual(['good'])

    mediaMocks.getMedia.mockReset()
    mediaMocks.getMedia.mockResolvedValue(null)
  })

  it('getProjectsUsingMedia scans projects for reverse lookup', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    await createProject(makeProject('c'))
    await associateMediaWithProject('a', 'shared')
    await associateMediaWithProject('c', 'shared')
    await associateMediaWithProject('b', 'only-b')

    const usingShared = await getProjectsUsingMedia('shared')
    expect(new Set(usingShared)).toEqual(new Set(['a', 'c']))
    expect(await getProjectsUsingMedia('only-b')).toEqual(['b'])
    expect(await getProjectsUsingMedia('nobody')).toEqual([])
  })
})
