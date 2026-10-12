import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AudioItem } from '@/types/timeline'
import { useItemsStore } from '../stores/items-store'
import { useSilenceRemovalDialogStore } from '../stores/silence-removal-dialog-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { DEFAULT_SILENCE_REMOVAL_SETTINGS } from '../utils/silence-removal-preview'
import { usePlaybackStore } from '@/shared/state/playback'
import { SilenceRemovalDialog } from './silence-removal-dialog'

const { analyzeSilenceForItemsMock } = vi.hoisted(() => ({
  analyzeSilenceForItemsMock: vi.fn(),
}))

vi.mock('../utils/silence-removal-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/silence-removal-preview')>()
  return { ...actual, analyzeSilenceForItems: analyzeSilenceForItemsMock }
})

vi.mock('@/components/ui/floating-panel', () => ({
  FloatingPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/slider', () => ({
  Slider: () => <div />,
}))

vi.mock('./clip-waveform', () => ({
  ClipWaveform: () => <div data-testid="review-waveform" />,
}))

function makeAudioItem(): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 90,
    label: 'Dialogue.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 90,
    sourceDuration: 90,
    sourceFps: 30,
  }
}

describe('SilenceRemovalDialog review', () => {
  beforeEach(() => {
    analyzeSilenceForItemsMock.mockReset()
    analyzeSilenceForItemsMock.mockResolvedValue({
      analyzedMediaIds: ['media-1'],
      failedMediaIds: [],
      rangesByMediaId: { 'media-1': [{ start: 1, end: 2 }] },
    })
    useTimelineSettingsStore.setState({ fps: 30 })
    useItemsStore.getState().setItems([makeAudioItem()])
    usePlaybackStore.setState({ currentFrame: 0, isPlaying: false })
    useSilenceRemovalDialogStore.setState({
      isOpen: true,
      itemIds: ['audio-1'],
      settings: DEFAULT_SILENCE_REMOVAL_SETTINGS,
      rangesByMediaId: { 'media-1': [{ start: 1, end: 2 }] },
      summary: { rangeCount: 1, totalSeconds: 1 },
      analyzedMediaCount: 1,
      failedMediaCount: 0,
    })
  })

  async function waitForInitialAnalysis() {
    await waitFor(() => expect(analyzeSilenceForItemsMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update Preview' })).toBeEnabled(),
    )
  }

  it('analyzes on open and re-analyzes when the detection mode changes', async () => {
    render(<SilenceRemovalDialog />)

    await waitForInitialAnalysis()
    expect(analyzeSilenceForItemsMock.mock.calls[0]?.[1]).toMatchObject({ mode: 'signal' })

    fireEvent.click(screen.getByRole('button', { name: 'Speech' }))

    await waitFor(() => expect(analyzeSilenceForItemsMock).toHaveBeenCalledTimes(2))
    expect(analyzeSilenceForItemsMock.mock.calls[1]?.[1]).toMatchObject({ mode: 'speech' })
  })

  it('lets the editor keep an individual detected range', async () => {
    render(<SilenceRemovalDialog />)
    await waitForInitialAnalysis()

    expect(screen.getAllByText('Dialogue.wav')).toHaveLength(2)
    expect(screen.getByTestId('review-waveform')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep range' }))

    expect(useSilenceRemovalDialogStore.getState().rangesByMediaId).toEqual({})
    expect(useSilenceRemovalDialogStore.getState().summary).toEqual({
      rangeCount: 0,
      totalSeconds: 0,
    })
  })

  it('starts a cut preview with handles and skips the detected range during playback', async () => {
    const view = render(<SilenceRemovalDialog />)
    await waitForInitialAnalysis()

    fireEvent.click(screen.getByRole('button', { name: 'Preview cut' }))
    expect(usePlaybackStore.getState()).toMatchObject({ currentFrame: 15, isPlaying: true })

    usePlaybackStore.getState().setCurrentFrame(30)
    expect(usePlaybackStore.getState().currentFrame).toBe(60)

    view.unmount()
    usePlaybackStore.getState().pause()
  })
})
