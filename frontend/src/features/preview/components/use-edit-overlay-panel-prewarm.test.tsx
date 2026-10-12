import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { CompositionItem, VideoItem } from '@/types/timeline'

const backgroundBatchPreseekMock = vi.hoisted(() => vi.fn())
const resolveMediaUrlMock = vi.hoisted(() => vi.fn())
const resolveProxyUrlMock = vi.hoisted(() => vi.fn())
const buildSubCompositionInputMock = vi.hoisted(() => vi.fn())
const compositionState = vi.hoisted(() => ({
  compositionById: {} as Record<string, unknown>,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  useBlobUrlVersion: () => 0,
}))

vi.mock('@/features/preview/utils/decoder-prewarm', () => ({
  backgroundBatchPreseek: backgroundBatchPreseekMock,
  getCachedPredecodedBitmap: vi.fn(() => null),
}))

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: resolveMediaUrlMock,
  resolveProxyUrl: resolveProxyUrlMock,
}))

vi.mock('../deps/timeline-contract', () => ({
  buildSubCompositionInput: buildSubCompositionInputMock,
  useCompositionsStore: {
    getState: () => compositionState,
  },
  timelineToSourceFrames: (
    timelineFrames: number,
    speed: number,
    timelineFps: number,
    sourceFps: number,
  ) => Math.round((timelineFrames / timelineFps) * sourceFps * speed),
}))

import { useEditOverlayPanelPrewarm } from './use-edit-overlay-panel-prewarm'

describe('useEditOverlayPanelPrewarm', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const leafVideo = {
      id: 'leaf-video',
      type: 'video',
      trackId: 'inner-track',
      from: 0,
      durationInFrames: 90,
      mediaId: 'media-1',
      src: '',
      label: 'Leaf',
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
    } as VideoItem
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      trackId: 'root-track',
      from: 0,
      durationInFrames: 90,
      compositionId: 'inner-composition',
      compositionWidth: 1920,
      compositionHeight: 1080,
      label: 'Inner',
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
    } as CompositionItem
    const rootInput: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      tracks: [
        {
          id: 'root-track',
          name: 'Root',
          order: 0,
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          items: [nestedWrapper],
        },
      ],
    }

    compositionState.compositionById = {
      'root-composition': {
        id: 'root-composition',
        fps: 30,
        items: [nestedWrapper],
      },
      'inner-composition': {
        id: 'inner-composition',
        fps: 30,
        items: [leafVideo],
      },
    }
    buildSubCompositionInputMock.mockReturnValue(rootInput)
    resolveProxyUrlMock.mockReturnValue('blob:proxy-media-1')
    resolveMediaUrlMock.mockResolvedValue('blob:source-media-1')
    backgroundBatchPreseekMock.mockResolvedValue(undefined)
  })

  it('preseeks the visible video leaf inside nested composition panels', async () => {
    const wrapper = {
      id: 'outer-wrapper',
      type: 'composition',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 90,
      compositionId: 'root-composition',
      compositionWidth: 1920,
      compositionHeight: 1080,
      label: 'Root',
    } as CompositionItem

    const { unmount } = renderHook(() =>
      useEditOverlayPanelPrewarm([{ item: wrapper, sourceFrame: 10, sourceTime: 10 / 30 }]),
    )

    await waitFor(() => {
      expect(backgroundBatchPreseekMock).toHaveBeenCalledWith('blob:proxy-media-1', [10 / 30], {
        signal: expect.any(AbortSignal),
      })
    })
    const signal = backgroundBatchPreseekMock.mock.calls[0]?.[2]?.signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
