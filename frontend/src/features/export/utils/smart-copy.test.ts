// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { SmartCopyContext } from './smart-copy'
import { assessSmartCopyEligibility, trySmartCopyExport } from './smart-copy'

const { getMediaFileMock } = vi.hoisted(() => ({
  getMediaFileMock: vi.fn(),
}))

vi.mock('../deps/media-library', () => ({
  getMediaFileById: getMediaFileMock,
  getMediaMetadataById: vi.fn(() => undefined),
}))

const source: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'source.mp4',
  fileSize: 4_000_000,
  mimeType: 'video/mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'avc1.640028',
  bitrate: 3_000_000,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const video: VideoItem = {
  id: 'video-1',
  trackId: 'track-1',
  type: 'video',
  src: 'blob:source',
  label: 'source.mp4',
  mediaId: source.id,
  from: 0,
  durationInFrames: 300,
  sourceStart: 0,
  sourceEnd: 300,
  sourceDuration: 300,
  sourceFps: 30,
  trimStart: 0,
  trimEnd: 0,
  transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
}

const track: TimelineTrack = {
  id: 'track-1',
  name: 'Video',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [video],
}

function context(overrides: Partial<SmartCopyContext> = {}): SmartCopyContext {
  return {
    settings: {
      mode: 'video',
      codec: 'avc',
      container: 'mp4',
      quality: 'medium',
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      videoBitrate: 3_000_000,
      smartCopy: true,
    },
    tracks: [track],
    items: [video],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    inPoint: null,
    outPoint: null,
    source,
    ...overrides,
  }
}

describe('smart copy eligibility', () => {
  it('accepts an unchanged full-source clip with matching output properties', () => {
    expect(assessSmartCopyEligibility(context())).toMatchObject({
      eligible: true,
      reason: 'eligible',
      mediaId: source.id,
    })
  })

  it('returns the original blob without invoking the encoder', async () => {
    const original = new Blob(['original-media-bytes'], { type: source.mimeType })
    getMediaFileMock.mockResolvedValueOnce(original)
    const onProgress = vi.fn()

    const outcome = await trySmartCopyExport(context(), new AbortController().signal, onProgress)

    expect(outcome.result?.blob).toBe(original)
    expect(outcome.result?.fileSize).toBe(original.size)
    expect(getMediaFileMock).toHaveBeenCalledWith(source.id)
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'finalizing', progress: 100 }),
    )
  })

  it('rejects in/out exports and trimmed clips', () => {
    expect(assessSmartCopyEligibility(context({ inPoint: 0, outPoint: 150 })).reason).toBe('range')

    const trimmed: VideoItem = { ...video, sourceStart: 30, durationInFrames: 270 }
    expect(assessSmartCopyEligibility(context({ items: [trimmed] as TimelineItem[] })).reason).toBe(
      'trimmed-or-retimed',
    )
  })

  it('rejects frame-rate, resolution, and format changes', () => {
    const conformedVideo: VideoItem = { ...video, durationInFrames: 600 }
    expect(
      assessSmartCopyEligibility(
        context({
          fps: 60,
          items: [conformedVideo],
          settings: { ...context().settings, fps: 60 },
        }),
      ).reason,
    ).toBe('project-mismatch')
    expect(
      assessSmartCopyEligibility(context({ settings: { ...context().settings, container: 'mov' } }))
        .reason,
    ).toBe('format-mismatch')
  })

  it('rejects visual and audio processing', () => {
    const processedVideo: VideoItem = { ...video, fadeIn: 0.5 }
    expect(
      assessSmartCopyEligibility(context({ items: [processedVideo] as TimelineItem[] })).reason,
    ).toBe('visual-processing')

    const processedTrack: TimelineTrack = { ...track, volume: -3 }
    expect(assessSmartCopyEligibility(context({ tracks: [processedTrack] })).reason).toBe(
      'audio-processing',
    )
  })

  it('rejects additional layers', () => {
    expect(
      assessSmartCopyEligibility(context({ items: [video, { ...video, id: 'video-2' }] })).reason,
    ).toBe('timeline-layout')
  })
})
