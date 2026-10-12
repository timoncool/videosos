// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import { createDefaultClassicTracks } from './classic-tracks'
import {
  buildGhostPreviewsFromNewTrackZonePlan,
  createOverlayLayerTrack,
  planNewTrackZonePlacements,
} from './new-track-zone-media'

describe('createOverlayLayerTrack', () => {
  it('anchors to the active track and stacks the new layer above existing video', () => {
    const tracks = createDefaultClassicTracks(80)
    const videoTrack = tracks.find((track) => track.kind === 'video')!

    const result = createOverlayLayerTrack({ tracks, activeTrackId: videoTrack.id })

    const createdTrack = result!.tracks.find((track) => track.id === result!.trackId)!
    expect(createdTrack).toMatchObject({ kind: 'video', height: 80 })
    expect(createdTrack.order).toBeLessThan(videoTrack.order)
  })

  it('falls back to the first non-group track when the active track is a group header', () => {
    const classicTracks = createDefaultClassicTracks(80)
    const groupTrack: TimelineTrack = {
      ...classicTracks[0]!,
      id: 'group-1',
      name: 'Group',
      isGroup: true,
      height: 24,
      order: classicTracks[0]!.order - 1,
    }

    const result = createOverlayLayerTrack({
      tracks: [groupTrack, ...classicTracks],
      activeTrackId: groupTrack.id,
    })

    // Height comes from the anchor track, so a group anchor would leak height 24.
    const createdTrack = result!.tracks.find((track) => track.id === result!.trackId)!
    expect(createdTrack).toMatchObject({ kind: 'video', height: 80 })
    expect(createdTrack.isGroup).toBeFalsy()
  })
})

describe('planNewTrackZonePlacements', () => {
  it('creates fresh video and audio tracks for linked video media in the video zone', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planNewTrackZonePlacements({
      entries: [
        {
          payload: { id: 'media-1' },
          label: 'clip.mp4',
          mediaType: 'video',
          durationInFrames: 90,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 36,
      tracks,
      existingItems: [],
      anchorTrackId: 'track-1',
      zone: 'video',
      preferredTrackHeight: 80,
    })

    expect(result.plannedItems).toHaveLength(1)
    expect(result.tracks.filter((track) => track.kind === 'video')).toHaveLength(2)
    expect(result.tracks.filter((track) => track.kind === 'audio')).toHaveLength(2)

    const placements = result.plannedItems[0]!.placements
    const videoTrack = result.tracks.find((track) => track.id === placements[0]?.trackId)
    const audioTrack = result.tracks.find((track) => track.id === placements[1]?.trackId)

    expect(placements).toHaveLength(2)
    expect(placements[0]).toMatchObject({ mediaType: 'video', from: 36, durationInFrames: 90 })
    expect(placements[1]).toMatchObject({ mediaType: 'audio', from: 36, durationInFrames: 90 })
    expect(videoTrack).toMatchObject({ name: 'V2', kind: 'video' })
    expect(audioTrack).toMatchObject({ name: 'A2', kind: 'audio' })
  })

  it('also accepts linked video media in the audio zone and still creates both tracks', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planNewTrackZonePlacements({
      entries: [
        {
          payload: { id: 'media-3' },
          label: 'clip-with-audio.mp4',
          mediaType: 'video',
          durationInFrames: 75,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 18,
      tracks,
      existingItems: [],
      anchorTrackId: 'track-2',
      zone: 'audio',
      preferredTrackHeight: 80,
    })

    expect(result.plannedItems).toHaveLength(1)
    expect(result.tracks.filter((track) => track.kind === 'video')).toHaveLength(2)
    expect(result.tracks.filter((track) => track.kind === 'audio')).toHaveLength(2)
    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ mediaType: 'video', from: 18, durationInFrames: 75 }),
      expect.objectContaining({ mediaType: 'audio', from: 18, durationInFrames: 75 }),
    ])
  })

  it('creates a fresh audio track for audio-only media in the audio zone', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planNewTrackZonePlacements({
      entries: [
        {
          payload: { id: 'media-2' },
          label: 'voice.wav',
          mediaType: 'audio',
          durationInFrames: 45,
        },
      ],
      dropFrame: 12,
      tracks,
      existingItems: [],
      anchorTrackId: 'track-2',
      zone: 'audio',
      preferredTrackHeight: 80,
    })

    expect(result.plannedItems).toHaveLength(1)
    expect(result.tracks.filter((track) => track.kind === 'audio')).toHaveLength(2)
    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ mediaType: 'audio', from: 12, durationInFrames: 45 }),
    ])

    const audioTrack = result.tracks.find(
      (track) => track.id === result.plannedItems[0]!.placements[0]!.trackId,
    )
    expect(audioTrack).toMatchObject({ name: 'A2', kind: 'audio' })
  })
})

describe('buildGhostPreviewsFromNewTrackZonePlan', () => {
  it('returns stacked video and audio ghosts for linked video media', () => {
    const tracks = createDefaultClassicTracks(80)
    const { plannedItems } = planNewTrackZonePlacements({
      entries: [
        {
          payload: { id: 'media-1' },
          label: 'clip.mp4',
          mediaType: 'video',
          durationInFrames: 90,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 24,
      tracks,
      existingItems: [],
      anchorTrackId: 'track-1',
      zone: 'video',
      preferredTrackHeight: 80,
    })

    const ghosts = buildGhostPreviewsFromNewTrackZonePlan({
      plannedItems,
      frameToPixels: (frame) => frame,
    })

    expect(ghosts).toEqual([
      expect.objectContaining({ type: 'video', targetZone: 'video', left: 24, width: 90 }),
      expect.objectContaining({ type: 'audio', targetZone: 'audio', left: 24, width: 90 }),
    ])
  })
})
