import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
}
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  ;(globalThis as unknown as { OffscreenCanvas: typeof FakeOffscreenCanvas }).OffscreenCanvas =
    FakeOffscreenCanvas
}

const selectionState = vi.hoisted(() => ({ selectedItemIds: ['compound-item'] }))
const graphSignatureMock = vi.hoisted(() => vi.fn(() => 'graph-signature'))
const buildInputMock = vi.hoisted(() => vi.fn())
const acquireSessionMock = vi.hoisted(() => vi.fn())
const compositionState = vi.hoisted(() => {
  const composition = {
    id: 'compound-composition',
    name: 'Compound',
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 90,
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
  }
  return {
    composition,
    compositionById: { [composition.id]: composition },
  }
})

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: (selector: (state: typeof selectionState) => unknown) =>
    selector(selectionState),
}))

vi.mock('@/features/preview/deps/timeline-contract', () => ({
  useCompositionsStore: (selector: (state: typeof compositionState) => unknown) =>
    selector(compositionState),
  buildSubCompositionInput: buildInputMock,
  buildSubCompositionPreviewSignature: graphSignatureMock,
  getSynchronizedLinkedItems: (items: TimelineItem[], itemId: string) => {
    const anchor = items.find((item) => item.id === itemId)
    if (!anchor) return []
    return items.filter(
      (item) =>
        item.id === anchor.id ||
        (item.linkedGroupId === anchor.linkedGroupId &&
          item.from === anchor.from &&
          item.durationInFrames === anchor.durationInFrames &&
          item.sourceStart === anchor.sourceStart &&
          item.sourceEnd === anchor.sourceEnd &&
          (item.speed ?? 1) === (anchor.speed ?? 1)),
    )
  },
}))

vi.mock('./comparison-composition-render-session', () => ({
  acquireComparisonCompositionRenderSession: acquireSessionMock,
}))

import { useSelectedComparisonCompositionPrewarm } from './use-selected-comparison-composition-prewarm'

describe('useSelectedComparisonCompositionPrewarm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectionState.selectedItemIds = ['compound-item']
    const input: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1280,
      height: 720,
      tracks: [],
      transitions: [],
      keyframes: [],
      backgroundColor: '#000000',
    }
    buildInputMock.mockReturnValue(input)
    acquireSessionMock.mockImplementation(() => ({
      requestFrame: vi.fn(),
      release: vi.fn(),
    }))
  })

  afterEach(() => cleanup())

  it('warms the selected compound IN and OUT frames before an edit overlay mounts', async () => {
    const item = {
      id: 'compound-item',
      type: 'composition',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 20,
      compositionId: 'compound-composition',
      compositionWidth: 1280,
      compositionHeight: 720,
      sourceStart: 5,
      sourceFps: 30,
      speed: 1,
    } as TimelineItem

    const view = renderHook(() =>
      useSelectedComparisonCompositionPrewarm({
        fps: 30,
        items: [item],
        useProxyMedia: true,
        blobUrlVersion: 3,
      }),
    )

    await waitFor(() => expect(acquireSessionMock).toHaveBeenCalledTimes(2))
    expect(acquireSessionMock.mock.calls.map(([request]) => request.priorityFrame)).toEqual([5, 24])
    expect(acquireSessionMock.mock.calls[0]?.[0]).toMatchObject({
      key: 'compound-composition:graph-signature:proxy:3:1280x720',
      compositionId: 'compound-composition',
      useProxyMedia: true,
    })

    const releases = acquireSessionMock.mock.results.map((result) => result.value.release)
    view.unmount()
    for (const release of releases) expect(release).toHaveBeenCalledOnce()
  })

  it('warms the linked compound visual when its audio wrapper is selected', async () => {
    selectionState.selectedItemIds = ['compound-audio']
    const compoundVisual = {
      id: 'compound-item',
      type: 'composition',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 20,
      compositionId: 'compound-composition',
      compositionWidth: 1280,
      compositionHeight: 720,
      sourceStart: 5,
      sourceEnd: 25,
      sourceFps: 30,
      speed: 1,
      linkedGroupId: 'compound-pair',
    } as TimelineItem
    const compoundAudio = {
      ...compoundVisual,
      id: 'compound-audio',
      type: 'audio',
      trackId: 'audio-track',
    } as TimelineItem

    renderHook(() =>
      useSelectedComparisonCompositionPrewarm({
        fps: 30,
        items: [compoundAudio, compoundVisual],
        useProxyMedia: true,
        blobUrlVersion: 3,
      }),
    )

    await waitFor(() => expect(acquireSessionMock).toHaveBeenCalledTimes(2))
    expect(acquireSessionMock.mock.calls.map(([request]) => request.priorityFrame)).toEqual([5, 24])
  })
})
