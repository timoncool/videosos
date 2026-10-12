import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { createJSONStorage } from 'zustand/middleware'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { setTimelineState } from '@/features/preview/deps/timeline-test-helpers-contract'
import { useGizmoStore } from '@/features/preview/stores/gizmo-store'
import { useVisualTransforms } from './use-visual-transform'
import type { TimelineItem } from '@/types/timeline'

const localStorageState = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return localStorageState.size
  },
  clear() {
    localStorageState.clear()
  },
  getItem(key) {
    return localStorageState.get(key) ?? null
  },
  key(index) {
    return Array.from(localStorageState.keys())[index] ?? null
  },
  removeItem(key) {
    localStorageState.delete(key)
  },
  setItem(key, value) {
    localStorageState.set(key, value)
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

usePlaybackStore.persist.setOptions({
  storage: createJSONStorage(() => localStorageMock),
})

const PROJECT_SIZE = { width: 1920, height: 1080 } as const

const ITEM = {
  id: 'item-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 200,
  label: 'Test Item',
  text: 'Hello',
  color: '#ffffff',
  transform: {
    x: 0,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
  },
} as unknown as TimelineItem

const WRAPPED_TEXT_ITEM = {
  ...ITEM,
  id: 'item-2',
  text: 'line one\nline two\nline three\nline four',
  fontSize: 48,
  lineHeight: 1.2,
  fontFamily: 'Inter',
  fontWeight: 'normal',
  fontStyle: 'normal',
  transform: {
    ...ITEM.transform,
    width: 200,
    height: 80,
  },
} as unknown as TimelineItem

const CORNER_PINNED_WRAPPED_TEXT_ITEM = {
  ...WRAPPED_TEXT_ITEM,
  id: 'item-3',
  cornerPin: {
    topLeft: [0, 0],
    topRight: [12, -8],
    bottomRight: [10, 14],
    bottomLeft: [-10, 6],
  },
} as unknown as TimelineItem

let probeRenderCount = 0

function VisualTransformsProbe({ item = ITEM }: { item?: TimelineItem }) {
  probeRenderCount += 1
  const transforms = useVisualTransforms([item], PROJECT_SIZE)
  const resolved = transforms.get(item.id)
  return (
    <div
      data-testid="visual-probe"
      data-x={String(resolved?.x ?? Number.NaN)}
      data-height={String(resolved?.height ?? Number.NaN)}
    />
  )
}

function FrozenVisualTransformsProbe({ frame }: { frame: number }) {
  probeRenderCount += 1
  const transforms = useVisualTransforms([ITEM], PROJECT_SIZE, undefined, frame)
  return <div data-testid="frozen-visual-probe" data-x={String(transforms.get(ITEM.id)?.x)} />
}

function resetStores() {
  if (typeof localStorage !== 'undefined') {
    if (typeof localStorage.clear === 'function') {
      localStorage.clear()
    } else if (typeof localStorage.removeItem === 'function') {
      localStorage.removeItem('playback-store')
      localStorage.removeItem('editor-store')
    }
  }

  resetPlaybackPreviewState(10)

  setTimelineState({
    keyframes: [
      {
        itemId: ITEM.id,
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-10', frame: 10, value: 110, easing: 'linear' },
              { id: 'kf-20', frame: 20, value: 220, easing: 'linear' },
              { id: 'kf-30', frame: 30, value: 330, easing: 'linear' },
            ],
          },
        ],
      },
    ],
  })

  useGizmoStore.setState({
    activeGizmo: null,
    previewTransform: null,
    preview: null,
    snapLines: [],
    canvasBackgroundPreview: null,
  })
}

describe('useVisualTransforms skimming frame resolution', () => {
  beforeEach(() => {
    probeRenderCount = 0
    resetStores()
  })

  it('does not re-render for requested frames until the visible frame advances', async () => {
    usePreviewBridgeStore.getState().setDisplayedFrame(10)
    render(<VisualTransformsProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110')
    })
    const rendersBeforeRequest = probeRenderCount

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20)
    })
    expect(probeRenderCount).toBe(rendersBeforeRequest)

    act(() => {
      usePreviewBridgeStore.getState().setDisplayedFrame(20)
    })
    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '220')
    })
    expect(probeRenderCount).toBeGreaterThan(rendersBeforeRequest)
  })

  it('does not recompute the scene-wide transform map during a translate drag', async () => {
    render(<VisualTransformsProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110')
    })
    const rendersBeforeDrag = probeRenderCount

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(
        ITEM.id,
        { x: 110, y: 0 },
        {
          x: 110,
          y: 0,
          width: 320,
          height: 120,
          rotation: 0,
          opacity: 1,
        },
        0,
        'text',
      )
      gizmo.updateInteraction({ x: 180, y: 40 }, false)
    })

    expect(probeRenderCount).toBe(rendersBeforeDrag)
    expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110')
  })

  it('does not re-render a frozen overlay for live playback frame changes', () => {
    render(<FrozenVisualTransformsProbe frame={10} />)

    expect(screen.getByTestId('frozen-visual-probe')).toHaveAttribute('data-x', '110')
    const rendersBeforePlayback = probeRenderCount

    act(() => {
      const playback = usePlaybackStore.getState()
      playback.play()
      playback.setCurrentFrame(20)
      playback.setCurrentFrame(30)
    })

    expect(probeRenderCount).toBe(rendersBeforePlayback)
    expect(screen.getByTestId('frozen-visual-probe')).toHaveAttribute('data-x', '110')
  })

  it('uses previewFrame while paused', async () => {
    render(<VisualTransformsProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110')
    })

    act(() => {
      usePlaybackStore.getState().setPreviewFrame(20)
    })

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '220')
    })
  })

  it('ignores previewFrame while playing', async () => {
    render(<VisualTransformsProbe />)

    act(() => {
      const playback = usePlaybackStore.getState()
      playback.setPreviewFrame(20)
      playback.play()
    })

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '110')
    })
  })

  it('falls back to currentFrame when previewFrame is stale', async () => {
    render(<VisualTransformsProbe />)

    act(() => {
      const playback = usePlaybackStore.getState()
      playback.setPreviewFrame(20)
      playback.setCurrentFrame(30)
    })

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-x', '330')
    })
  })

  it('keeps expanded text bounds even without a live properties preview', async () => {
    render(<VisualTransformsProbe item={WRAPPED_TEXT_ITEM} />)

    await waitFor(() => {
      expect(
        Number(screen.getByTestId('visual-probe').getAttribute('data-height')),
      ).toBeGreaterThan(80)
    })
  })

  it('keeps corner-pinned text bounds anchored to the gizmo box', async () => {
    render(<VisualTransformsProbe item={CORNER_PINNED_WRAPPED_TEXT_ITEM} />)

    await waitFor(() => {
      expect(screen.getByTestId('visual-probe')).toHaveAttribute('data-height', '80')
    })
  })
})
