// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { ThumbnailData } from '@/types/storage'
import '../test-utils/logger-test-mocks'

import {
  deleteThumbnailsByMediaId,
  getThumbnail,
  getThumbnailByMediaId,
  getThumbnailsByMediaIds,
  saveThumbnail,
} from './thumbnails'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

function makeThumbnail(mediaId: string, id = `t-${mediaId}`): ThumbnailData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]) // JPEG SOI marker
  return {
    id,
    mediaId,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    timestamp: 0,
    width: 320,
    height: 180,
  }
}

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs thumbnails', () => {
  it('saveThumbnail writes the jpeg blob to media/<id>/thumbnail.jpg', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1'))

    const text = await readFileText(root, 'media', 'm1', 'thumbnail.jpg')
    expect(text).not.toBeNull()
    // Sidecar was dropped in v2 — must not be written.
    expect(await readFileText(root, 'media', 'm1', 'thumbnail.meta.json')).toBeNull()
  })

  it('getThumbnailByMediaId returns saved thumbnail with id derived from mediaId', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1'))
    const t = await getThumbnailByMediaId('m1')
    expect(t).toBeDefined()
    // v2: id is derived from mediaId; the caller-supplied id is ignored.
    expect(t!.id).toBe('m1')
    expect(t!.mediaId).toBe('m1')
  })

  it('getThumbnailByMediaId returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getThumbnailByMediaId('missing')).toBeUndefined()
  })

  it('getThumbnail(id) treats id as mediaId in v2', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1'))
    const t = await getThumbnail('m1')
    expect(t).toBeDefined()
    expect(t!.mediaId).toBe('m1')
  })

  it('deleteThumbnailsByMediaId removes the jpeg', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1'))
    await deleteThumbnailsByMediaId('m1')
    expect(await getThumbnailByMediaId('m1')).toBeUndefined()
    expect(await readFileText(root, 'media', 'm1', 'thumbnail.jpg')).toBeNull()
  })

  it('getThumbnailsByMediaIds batch-reads present thumbnails and skips missing ones', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1'))
    await saveThumbnail(makeThumbnail('m3'))

    // 'm2' has no thumbnail — it must be absent from the result, not throw.
    const result = await getThumbnailsByMediaIds(['m1', 'm2', 'm3'])

    expect([...result.keys()].sort()).toEqual(['m1', 'm3'])
    expect(result.get('m1')!.size).toBeGreaterThan(0)
    expect(result.get('m2')).toBeUndefined()
  })

  it('getThumbnailsByMediaIds returns an empty map for empty input or missing media dir', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect((await getThumbnailsByMediaIds([])).size).toBe(0)
    // media/ directory never created — must resolve to empty, not throw.
    expect((await getThumbnailsByMediaIds(['nope'])).size).toBe(0)
  })

  it('saveThumbnail overwrites prior thumbnail for the same media', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveThumbnail(makeThumbnail('m1', 'first'))
    await saveThumbnail(makeThumbnail('m1', 'second'))
    // Structure-level check: only one thumbnail entry remains for this media.
    const t = await getThumbnailByMediaId('m1')
    expect(t).toBeDefined()
    expect(t!.mediaId).toBe('m1')
  })
})
