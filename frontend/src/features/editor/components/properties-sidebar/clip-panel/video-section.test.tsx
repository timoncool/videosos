import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ReactNode } from 'react'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import { useKeyframesStore } from '@/features/editor/deps/timeline-store'
import { setTimelineState } from '@/features/editor/deps/timeline-test-helpers-contract'
import { VideoSection } from './video-section'

const keyframeToggleSpy = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/editor/deps/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/editor/deps/preview')>()
  return { ...actual, useThrottledFrame: () => 0 }
})

vi.mock('@/features/editor/deps/keyframes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/editor/deps/keyframes')>()
  return {
    ...actual,
    KeyframeToggle: (props: unknown) => {
      keyframeToggleSpy(props)
      return null
    },
  }
})

vi.mock('../components', () => ({
  PropertySection: ({ children }: { children: ReactNode }) => <>{children}</>,
  PropertyRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <div data-testid={`property-row-${label}`}>{children}</div>
  ),
  SliderInput: ({ max }: { max: number }) => <output data-testid="slider-input" data-max={max} />,
}))

const VIDEO_ITEM: VideoItem = {
  id: 'video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'video.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
  sourceWidth: 1920,
  sourceHeight: 1080,
}

const COMPOSITION_ITEM: CompositionItem = {
  id: 'composition-1',
  type: 'composition',
  trackId: 'track-2',
  from: 0,
  durationInFrames: 90,
  label: 'Compound clip',
  compositionId: 'nested-1',
  compositionWidth: 3840,
  compositionHeight: 2160,
}

function getCropSliderMax(property: 'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom'): number {
  const row = screen.getByTestId(`property-row-editor.videoSection.${property}`)
  return Number(within(row).getByTestId('slider-input').getAttribute('data-max'))
}

describe('VideoSection crop controls', () => {
  beforeEach(() => {
    keyframeToggleSpy.mockClear()
    setTimelineState({ items: [VIDEO_ITEM, COMPOSITION_ITEM], fps: 30 })
    useKeyframesStore.setState({ keyframesByItemId: {} })
  })

  it('caps mixed-selection crop ranges at the smallest selected source dimensions', () => {
    render(<VideoSection items={[VIDEO_ITEM, COMPOSITION_ITEM]} />)

    expect(getCropSliderMax('cropLeft')).toBe(1920)
    expect(getCropSliderMax('cropRight')).toBe(1920)
    expect(getCropSliderMax('cropTop')).toBe(1080)
    expect(getCropSliderMax('cropBottom')).toBe(1080)
  })

  it('passes each selected item crop value to the multi-item keyframe toggle', () => {
    const video = { ...VIDEO_ITEM, crop: { left: 0.25 } }
    const composition = { ...COMPOSITION_ITEM, crop: { left: 0.25 } }

    render(<VideoSection items={[video, composition]} />)

    const cropLeftProps = keyframeToggleSpy.mock.calls
      .map(
        ([props]) => props as { property: string; currentValuesByItemId: Record<string, number> },
      )
      .find((props) => props.property === 'cropLeft')
    expect(cropLeftProps?.currentValuesByItemId).toEqual({
      [video.id]: 480,
      [composition.id]: 960,
    })
  })
})
