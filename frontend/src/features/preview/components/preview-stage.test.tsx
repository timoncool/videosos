import { describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { CompositionInputProps } from '@/types/export'

const playbackState = vi.hoisted(() => ({
  useProxy: true,
}))

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  )

  return { usePlaybackStore }
})

vi.mock('@/features/preview/deps/player-core', () => {
  const MockPlayer = ({
    children,
    layoutSize,
    style,
  }: {
    children: ReactNode
    layoutSize?: { width: number; height: number }
    style?: CSSProperties
  }) => (
    <div
      data-testid="player"
      data-layout-width={layoutSize?.width}
      data-layout-height={layoutSize?.height}
      style={style}
    >
      {children}
    </div>
  )

  return {
    HeadlessPlayer: MockPlayer,
    Player: MockPlayer,
  }
})

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: ({ useProxyMedia }: { useProxyMedia?: boolean }) => (
    <div data-testid="main-composition" data-use-proxy-media={useProxyMedia ? 'true' : 'false'} />
  ),
}))

import {
  getPreviewPixelSnapOffset,
  getPreviewPixelSnapSize,
  getPreviewPlayerSize,
} from '../utils/preview-pixel-snap'
import { getPreviewDisplayEdgePadding } from '../utils/preview-display-canvas'
import { PreviewStage } from './preview-stage'

function createInputProps(): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 120,
    width: 1280,
    height: 720,
    tracks: [],
    transitions: [],
    keyframes: [],
    backgroundColor: '#000000',
  }
}

function createRef<T>(): RefObject<T | null> {
  return { current: null }
}

function renderSplitPreviewStage(overrides: Partial<Parameters<typeof PreviewStage>[0]> = {}) {
  const handleSplitPositionChange = vi.fn()
  render(
    <PreviewStage
      backgroundRef={createRef<HTMLDivElement>()}
      playerRef={createRef()}
      scrubCanvasRef={createRef<HTMLCanvasElement>()}
      gpuEffectsCanvasRef={createRef<HTMLCanvasElement>()}
      needsOverflow={false}
      playerSize={{ width: 1280, height: 720 }}
      playerRenderSize={{ width: 1280, height: 720 }}
      overlayRenderSize={{ width: 1280, height: 720 }}
      totalFrames={120}
      fps={30}
      isResolving={false}
      isRenderedOverlayVisible={true}
      colorGradeComparisonMode="split"
      inputProps={createInputProps()}
      onBackgroundClick={() => {}}
      onFrameChange={() => {}}
      onPlayStateChange={() => {}}
      setPlayerContainerRefCallback={() => {}}
      onColorGradeSplitPositionChange={handleSplitPositionChange}
      {...overrides}
    />,
  )
  return { handleSplitPositionChange }
}

describe('getPreviewPixelSnapOffset', () => {
  it('returns the subpixel correction needed to land the preview surface on device pixels', () => {
    expect(getPreviewPixelSnapOffset({ left: 856.390625, top: 64.453125 }, 1)).toEqual({
      x: -0.390625,
      y: -0.453125,
    })

    expect(getPreviewPixelSnapOffset({ left: 10.25, top: 20.75 }, 2)).toEqual({
      x: 0.25,
      y: 0.25,
    })
  })
})

describe('getPreviewPixelSnapSize', () => {
  it('snaps fitted preview dimensions to device pixels', () => {
    expect(getPreviewPixelSnapSize({ width: 590.21875, height: 332 }, 1)).toEqual({
      width: 590,
      height: 332,
    })

    expect(getPreviewPixelSnapSize({ width: 590.25, height: 331.75 }, 2)).toEqual({
      width: 590.5,
      height: 332,
    })
  })
})

describe('getPreviewPlayerSize', () => {
  it('keeps auto-fit preview dimensions aspect-stable on the device pixel grid', () => {
    expect(
      getPreviewPlayerSize({
        sourceSize: { width: 1920, height: 1080 },
        containerSize: { width: 1029.328125, height: 579 },
        zoom: -1,
        devicePixelRatio: 1,
      }),
    ).toEqual({ width: 1024, height: 576 })
  })

  it('preserves normal fixed zoom sizing', () => {
    expect(
      getPreviewPlayerSize({
        sourceSize: { width: 1920, height: 1080 },
        containerSize: { width: 1029.328125, height: 579 },
        zoom: 0.5,
        devicePixelRatio: 1,
      }),
    ).toEqual({ width: 960, height: 540 })
  })
})

describe('getPreviewDisplayEdgePadding', () => {
  it('uses at least two screen pixels of source padding at fixed zooms', () => {
    const renderSize = { width: 1920, height: 1080 }

    expect(getPreviewDisplayEdgePadding({ width: 480, height: 270 }, renderSize, 1)).toBe(8)
    expect(getPreviewDisplayEdgePadding({ width: 960, height: 540 }, renderSize, 1)).toBe(4)
    expect(getPreviewDisplayEdgePadding({ width: 1440, height: 810 }, renderSize, 1)).toBe(4)
  })

  it('keeps awkward auto-fit scales thick enough for bilinear filtering', () => {
    expect(
      getPreviewDisplayEdgePadding({ width: 992, height: 558 }, { width: 1920, height: 1080 }, 1),
    ).toBe(4)
    expect(
      getPreviewDisplayEdgePadding({ width: 928, height: 522 }, { width: 1920, height: 1080 }, 1),
    ).toBe(5)
    expect(
      getPreviewDisplayEdgePadding({ width: 1056, height: 594 }, { width: 1920, height: 1080 }, 1),
    ).toBe(4)
  })

  it('guarantees multi-device-pixel overscan across panel sizes and display densities', () => {
    const renderSize = { width: 1920, height: 1080 }
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      for (const playerSize of [
        { width: 320, height: 180 },
        { width: 592, height: 333 },
        { width: 928, height: 522 },
        { width: 1024, height: 576 },
        { width: 1432, height: 805.5 },
      ]) {
        const padding = getPreviewDisplayEdgePadding(playerSize, renderSize, devicePixelRatio)
        expect(
          (padding * playerSize.width * devicePixelRatio) / renderSize.width,
        ).toBeGreaterThanOrEqual(2 - 1e-3)
        expect(
          (padding * playerSize.height * devicePixelRatio) / renderSize.height,
        ).toBeGreaterThanOrEqual(2 - 1e-3)
      }
    }
  })
})

describe('PreviewStage', () => {
  it('passes proxy playback mode down to nested composition rendering', () => {
    playbackState.useProxy = true

    render(
      <PreviewStage
        backgroundRef={createRef<HTMLDivElement>()}
        playerRef={createRef()}
        scrubCanvasRef={createRef<HTMLCanvasElement>()}
        gpuEffectsCanvasRef={createRef<HTMLCanvasElement>()}
        needsOverflow={false}
        playerSize={{ width: 1280, height: 720 }}
        playerRenderSize={{ width: 1280, height: 720 }}
        overlayRenderSize={{ width: 1280, height: 720 }}
        totalFrames={120}
        fps={30}
        isResolving={false}
        isRenderedOverlayVisible={false}
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />,
    )

    expect(screen.getByTestId('main-composition')).toHaveAttribute('data-use-proxy-media', 'true')
  })

  it('keeps the player on exact geometry and pads rendered overlay canvases at the clipped edge', () => {
    render(
      <PreviewStage
        backgroundRef={createRef<HTMLDivElement>()}
        playerRef={createRef()}
        scrubCanvasRef={createRef<HTMLCanvasElement>()}
        gpuEffectsCanvasRef={createRef<HTMLCanvasElement>()}
        needsOverflow={false}
        playerSize={{ width: 1280, height: 720 }}
        playerRenderSize={{ width: 1280, height: 720 }}
        overlayRenderSize={{ width: 1280, height: 720 }}
        totalFrames={120}
        fps={30}
        isResolving={false}
        isRenderedOverlayVisible={true}
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />,
    )

    const player = screen.getByTestId('player')
    const canvases = document.querySelectorAll('canvas')

    expect(player).toHaveStyle({ width: '100%', height: '100%' })
    expect(player).toHaveAttribute('data-layout-width', '1280')
    expect(player).toHaveAttribute('data-layout-height', '720')
    expect(player.style.marginLeft).toBe('')
    expect(player.style.marginTop).toBe('')

    canvases.forEach((canvas) => {
      expect(canvas).toHaveStyle({
        width: 'calc(100% + 4px)',
        height: 'calc(100% + 4px)',
        left: '-2px',
        top: '-2px',
      })
    })
  })

  it('clips the preview overlay without resizing render surfaces in split grade comparison mode', () => {
    renderSplitPreviewStage()

    const scrubCanvas = document.querySelectorAll('canvas')[0] as HTMLCanvasElement
    const beforeLayer = document.querySelector(
      '[data-grade-comparison-before-layer="true"]',
    ) as HTMLDivElement
    expect(beforeLayer).toHaveStyle({ width: '100%', height: '100%' })
    expect(beforeLayer.style.clipPath).toBe('inset(0 50% 0 0)')
    expect(beforeLayer.style.overflow).toBe('')
    expect(scrubCanvas).toHaveStyle({
      width: 'calc(100% + 4px)',
      height: 'calc(100% + 4px)',
      left: '-2px',
      top: '-2px',
    })
    expect(scrubCanvas.style.clipPath).toBe('')
    expect(screen.getByLabelText('Split grade comparison')).toBeTruthy()
    expect(screen.getByText('Before')).toBeTruthy()
    expect(screen.getByText('After')).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Adjust split comparison' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })

  it('uses a custom split comparison position and nudges it from the handle', () => {
    const { handleSplitPositionChange } = renderSplitPreviewStage({
      colorGradeSplitPosition: 0.35,
    })

    const scrubCanvas = document.querySelectorAll('canvas')[0] as HTMLCanvasElement
    const beforeLayer = document.querySelector(
      '[data-grade-comparison-before-layer="true"]',
    ) as HTMLDivElement
    const wipeHandle = screen.getByRole('slider', { name: 'Adjust split comparison' })
    expect(beforeLayer).toHaveStyle({ width: '100%' })
    expect(beforeLayer.style.clipPath).toBe('inset(0 65% 0 0)')
    expect(beforeLayer.style.overflow).toBe('')
    expect(scrubCanvas).toHaveStyle({
      width: 'calc(100% + 4px)',
      height: 'calc(100% + 4px)',
      left: '-2px',
      top: '-2px',
    })
    expect(scrubCanvas.style.clipPath).toBe('')
    expect(wipeHandle).toHaveAttribute('aria-valuenow', '35')

    fireEvent.keyDown(wipeHandle, { key: 'ArrowRight' })

    expect(handleSplitPositionChange).toHaveBeenCalledWith(0.36)
  })

  it('updates the split comparison position from pointer movement', () => {
    const { handleSplitPositionChange } = renderSplitPreviewStage({
      colorGradeSplitPosition: 0.5,
    })

    const playerSurface = document.querySelector('[data-player-container]') as HTMLDivElement | null
    expect(playerSurface).not.toBeNull()
    Object.defineProperty(playerSurface!, 'getBoundingClientRect', {
      value: () => ({
        x: 100,
        y: 0,
        top: 0,
        left: 100,
        right: 1380,
        bottom: 720,
        width: 1280,
        height: 720,
        toJSON: () => ({}),
      }),
      configurable: true,
    })

    const wipeHandle = screen.getByRole('slider', { name: 'Adjust split comparison' })
    fireEvent.pointerDown(wipeHandle, { pointerId: 1, clientX: 420 })
    fireEvent.pointerMove(wipeHandle, { pointerId: 1, buttons: 1, clientX: 740 })

    expect(handleSplitPositionChange).toHaveBeenCalledWith(0.25)
    expect(handleSplitPositionChange).toHaveBeenCalledWith(0.5)
  })

  it('keeps split wipe chrome mounted while the comparison overlay is waiting for a frame', () => {
    renderSplitPreviewStage({ isRenderedOverlayVisible: false })

    const beforeLayer = document.querySelector(
      '[data-grade-comparison-before-layer="true"]',
    ) as HTMLDivElement
    expect(beforeLayer).toHaveStyle({ width: '100%', visibility: 'hidden' })
    expect(beforeLayer.style.clipPath).toBe('inset(0 50% 0 0)')
    expect(screen.getByRole('slider', { name: 'Adjust split comparison' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })
})
