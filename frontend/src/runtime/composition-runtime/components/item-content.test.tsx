import { describe, expect, it, vi } from 'vite-plus/test'
import { render, screen } from '@testing-library/react'
import { VideoConfigProvider } from '@/runtime/composition-runtime/deps/player'
import type { CompositionItem, ControllerItem } from '@/types/timeline'
import { ItemContent } from './item-content'

vi.mock('@/runtime/composition-runtime/deps/player', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/composition-runtime/deps/player')>()),
  useClockPlaybackRate: () => 1,
}))

describe('ItemContent', () => {
  it('accepts a Null Object controller without rendering pixels', () => {
    const controller: ControllerItem = {
      id: 'null-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Null Object',
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        aspectRatioLocked: true,
        cornerRadius: 0,
      },
      speed: 1,
    }

    const { container } = render(
      <VideoConfigProvider fps={30} width={1920} height={1080} durationInFrames={30}>
        <ItemContent item={controller} renderCompositionContent={vi.fn()} />
      </VideoConfigProvider>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('applies wrapper crop to flattened composition content', () => {
    const composition: CompositionItem = {
      id: 'composition-1',
      type: 'composition',
      compositionId: 'sub-comp-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Compound clip',
      crop: { left: 0.25 },
      transform: {
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
        rotation: 0,
        opacity: 1,
      },
    }

    render(
      <VideoConfigProvider fps={30} width={1920} height={1080} durationInFrames={30}>
        <ItemContent
          item={composition}
          renderCompositionContent={() => <div data-testid="composition-content" />}
        />
      </VideoConfigProvider>,
    )

    const cropSurface = screen.getByTestId('composition-content').parentElement
    expect(cropSurface?.style.width).toBe('100%')
    expect(cropSurface?.style.height).toBe('100%')
    expect(cropSurface?.style.maskImage).toContain('linear-gradient')
  })
})
