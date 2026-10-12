import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import {
  useItemsStore,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { AppliedContinuousMotionControls } from './applied-continuous-motion-controls'

const ANIMATED_VIDEO: VideoItem = {
  id: 'animated-video',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'animated.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
  motionModifiers: [
    {
      id: 'float-drift-1',
      type: 'float-drift',
      enabled: true,
      amplitude: 1,
      frequency: 0.5,
      phaseFrames: 0,
      seed: 7,
    },
  ],
}

const CANVAS = { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' }

describe('AppliedContinuousMotionControls', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([ANIMATED_VIDEO])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('exposes live modifier settings and removes the modifier through the shared action', () => {
    render(
      <AppliedContinuousMotionControls items={[ANIMATED_VIDEO]} canvas={CANVAS} showBakeAction />,
    )

    expect(screen.getByText('Float drift')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bake to keyframes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generator: Float drift' }))
    expect(screen.getByText('Intensity')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(useItemsStore.getState().itemById[ANIMATED_VIDEO.id]?.motionModifiers).toEqual([])
  })
})
