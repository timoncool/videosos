import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useMediaDependencyStore } from '@/features/preview/deps/timeline-store'
import type { TimelineTrack } from '@/types/timeline'
import { usePreviewMediaResolution } from './use-preview-media-resolution'

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn(() => new Promise<string | null>(() => {})),
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: (mediaId: string) => (mediaId === 'media-priority' ? 'blob:priority' : null),
    invalidateAll: vi.fn(),
  },
}))

const combinedTracks = [
  {
    id: 'track-video',
    items: [
      {
        id: 'item-priority',
        type: 'video',
        trackId: 'track-video',
        mediaId: 'media-priority',
        from: 0,
        durationInFrames: 120,
      },
      {
        id: 'item-slow',
        type: 'video',
        trackId: 'track-video',
        mediaId: 'media-slow',
        from: 3_000,
        durationInFrames: 120,
      },
    ],
  },
] as unknown as TimelineTrack[]

describe('usePreviewMediaResolution', () => {
  afterEach(() => {
    useMediaDependencyStore.setState({ mediaIds: [], mediaDependencyVersion: 0 })
  })

  it('releases the renderer gate when priority media resolves before the initial batch', async () => {
    useMediaDependencyStore.setState({
      mediaIds: ['media-priority', 'media-slow'],
      mediaDependencyVersion: 1,
    })

    const previewPerfRef = {
      current: {
        resolveSamples: 0,
        resolveTotalMs: 0,
        resolveTotalIds: 0,
        resolveLastMs: 0,
        resolveLastIds: 0,
      },
    }
    const isGizmoInteractingRef = { current: false }

    const { result, unmount } = renderHook(() =>
      usePreviewMediaResolution({
        fps: 30,
        combinedTracks,
        mediaResolveCostById: new Map(),
        mediaDependencyVersion: 1,
        blobUrlVersion: 0,
        brokenMediaCount: 0,
        previewPerfRef,
        isGizmoInteractingRef,
      }),
    )

    await waitFor(() => {
      expect(result.current.isResolving).toBe(true)
    })

    act(() => {
      result.current.setResolvedUrls(new Map([['media-priority', 'blob:priority']]))
    })

    await waitFor(() => {
      expect(result.current.isResolving).toBe(false)
    })

    unmount()
  })
})
