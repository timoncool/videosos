import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  useItemsStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { insertGeneratedAudioOnNewTrack } from './insert-generated-audio'

function makeTrack(id: string, name: string, order: number): TimelineTrack {
  return {
    id,
    name,
    kind: name.startsWith('A') ? 'audio' : 'video',
    height: 64,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order,
    items: [],
  }
}

const media = {
  id: 'generated-media',
  fileName: 'voice.wav',
  duration: 2,
  fps: 0,
} as MediaMetadata

describe('insertGeneratedAudioOnNewTrack', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([])
    useItemsStore
      .getState()
      .setTracks([makeTrack('video-track', 'V1', 0), makeTrack('existing-audio-track', 'A1', 1)])
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedTrackIds: [],
      activeTrackId: 'existing-audio-track',
      selectedTrackId: 'existing-audio-track',
    })
  })

  it('creates a new audio track and places the generated clip at the captured playhead', () => {
    const occupiedAudio: AudioItem = {
      id: 'existing-audio',
      type: 'audio',
      trackId: 'existing-audio-track',
      from: 60,
      durationInFrames: 90,
      label: 'existing.wav',
      mediaId: 'existing-media',
      src: 'blob:existing-audio',
    }
    useItemsStore.getState().setItems([occupiedAudio])

    expect(insertGeneratedAudioOnNewTrack(media, 'blob:generated-voice', 87)).toBe(true)

    const state = useItemsStore.getState()
    const inserted = state.items.find((item) => item.mediaId === media.id)
    const newTrack = state.tracks.find((track) => track.id === inserted?.trackId)

    expect(inserted).toMatchObject({
      type: 'audio',
      from: 87,
      durationInFrames: 60,
      src: 'blob:generated-voice',
    })
    expect(newTrack).toMatchObject({ kind: 'audio', name: 'A2', order: 2 })
    expect(newTrack?.id).not.toBe('existing-audio-track')
    expect(state.items).toContainEqual(occupiedAudio)
    expect(useSelectionStore.getState().selectedItemIds).toEqual([inserted?.id])
  })

  it('undoes the inserted clip and its new track together', () => {
    insertGeneratedAudioOnNewTrack(media, 'blob:generated-voice', 42)

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().items).toEqual([])
    expect(useItemsStore.getState().tracks.map((track) => track.id)).toEqual([
      'video-track',
      'existing-audio-track',
    ])
  })
})
