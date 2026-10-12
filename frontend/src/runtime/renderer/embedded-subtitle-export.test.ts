// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { SubtitleSegmentItem, TimelineTrack } from '@/types/timeline'

import {
  buildTranscriptSubtitleWebVtt,
  omitTranscriptSubtitleItemsForSoftSubtitleExport,
  resolveSubtitleExportPlan,
  type SubtitleExportPlan,
} from './embedded-subtitle-export'

function makeTrack(items: TimelineTrack['items']): TimelineTrack {
  return {
    id: 'track-1',
    name: 'V1',
    kind: 'video',
    height: 100,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }
}

function makeTranscriptSubtitle(overrides: Partial<SubtitleSegmentItem> = {}): SubtitleSegmentItem {
  return {
    id: 'subtitle-1',
    type: 'subtitle',
    trackId: 'track-1',
    from: 30,
    durationInFrames: 90,
    label: 'Transcript',
    mediaId: 'media-1',
    source: {
      type: 'transcript',
      mediaId: 'media-1',
      clipId: 'clip-1',
    },
    cues: [
      { id: 'cue-1', startSeconds: 0, endSeconds: 1, text: 'Hello' },
      { id: 'cue-2', startSeconds: 2, endSeconds: 5, text: 'Trimmed tail' },
    ],
    color: '#ffffff',
    ...overrides,
  }
}

function makeComposition(items: TimelineTrack['items']): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 120,
    width: 1920,
    height: 1080,
    tracks: [makeTrack(items)],
  }
}

describe('embedded transcript subtitle export', () => {
  it('serializes transcript subtitle segment cues as composition-relative WebVTT', () => {
    const vtt = buildTranscriptSubtitleWebVtt(makeComposition([makeTranscriptSubtitle()]))

    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000\nHello')
    expect(vtt).toContain('00:00:03.000 --> 00:00:04.000\nTrimmed tail')
  })

  it('omits transcript subtitle items from the visual render copy only', () => {
    const subtitle = makeTranscriptSubtitle()
    const title = {
      id: 'title-1',
      type: 'text' as const,
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
    }
    const composition = makeComposition([subtitle, title])

    const filtered = omitTranscriptSubtitleItemsForSoftSubtitleExport(composition)

    expect(filtered.tracks[0]?.items?.map((item) => item.id)).toEqual(['title-1'])
    expect(composition.tracks[0]?.items?.map((item) => item.id)).toEqual(['subtitle-1', 'title-1'])
  })

  it('returns null when there are no transcript subtitles to embed', () => {
    const embeddedSubtitle = makeTranscriptSubtitle({
      source: {
        type: 'embedded-subtitles',
        mediaId: 'media-1',
        clipId: 'clip-1',
        trackNumber: 1,
        importedAt: 1,
      },
    })

    expect(buildTranscriptSubtitleWebVtt(makeComposition([embeddedSubtitle]))).toBeNull()
  })
})

describe('resolveSubtitleExportPlan', () => {
  const plan = (
    subtitleMode: Parameters<typeof resolveSubtitleExportPlan>[0]['subtitleMode'],
    container: string,
    { supportsWebVttSubtitles = true, hasTranscriptVtt = true } = {},
  ) =>
    resolveSubtitleExportPlan({
      subtitleMode,
      container,
      supportsWebVttSubtitles,
      hasTranscriptVtt,
    })

  it('burn mode keeps transcript items in the render and embeds nothing', () => {
    expect(plan('burn', 'mp4')).toEqual<SubtitleExportPlan>({
      embedTranscriptSubtitles: false,
      burnInSubtitles: true,
      fallbackToBurnIn: false,
    })
  })

  it.each(['off', 'sidecar'] as const)('%s mode drops transcript items entirely', (mode) => {
    expect(plan(mode, 'mp4')).toEqual<SubtitleExportPlan>({
      embedTranscriptSubtitles: false,
      burnInSubtitles: false,
      fallbackToBurnIn: false,
    })
  })

  it.each(['webm', 'mkv'] as const)('embedded mode muxes a soft track for %s', (container) => {
    expect(plan('embedded', container)).toEqual<SubtitleExportPlan>({
      embedTranscriptSubtitles: true,
      burnInSubtitles: false,
      fallbackToBurnIn: false,
    })
  })

  // mediabunny never starts its ISOBMFF subtitle auxWriter — WebVTT-into-MP4/MOV
  // asserts via an uncatchable floating rejection, so we burn in instead.
  it.each(['mp4', 'mov'] as const)(
    'embedded mode falls back to burn-in for ISOBMFF container %s',
    (container) => {
      expect(plan('embedded', container)).toEqual<SubtitleExportPlan>({
        embedTranscriptSubtitles: false,
        burnInSubtitles: true,
        fallbackToBurnIn: true,
      })
    },
  )

  it('embedded mode falls back to burn-in when the format lacks WebVTT support', () => {
    expect(
      plan('embedded', 'webm', { supportsWebVttSubtitles: false }),
    ).toEqual<SubtitleExportPlan>({
      embedTranscriptSubtitles: false,
      burnInSubtitles: true,
      fallbackToBurnIn: true,
    })
  })

  it('embedded mode without any transcript burns nothing and warns nothing', () => {
    expect(plan('embedded', 'webm', { hasTranscriptVtt: false })).toEqual<SubtitleExportPlan>({
      embedTranscriptSubtitles: false,
      burnInSubtitles: true,
      fallbackToBurnIn: false,
    })
  })
})
