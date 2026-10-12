// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, ShapeItem, SubtitleSegmentItem, VideoItem } from '@/types/timeline'
import {
  normalizeFrameFields,
  normalizeItemUpdates,
  normalizeOptionalFps,
  normalizeTrack,
  roundDuration,
  roundFrame,
  roundOptionalFrame,
  trimSubtitleCuesAtEnd,
  trimSubtitleCuesAtStart,
} from './items-store-normalize'

function makeVideo(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

function makeAudio(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'clip.wav',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

describe('roundFrame', () => {
  it('rounds half-up to the nearest non-negative integer', () => {
    expect(roundFrame(12.4)).toBe(12)
    expect(roundFrame(12.6)).toBe(13)
  })

  it('clamps negative values to zero', () => {
    expect(roundFrame(-5)).toBe(0)
  })

  it('falls back when the value is not finite', () => {
    expect(roundFrame(Number.NaN)).toBe(0)
    expect(roundFrame(Number.POSITIVE_INFINITY)).toBe(0)
    expect(roundFrame(Number.NaN, 42)).toBe(42)
  })
})

describe('roundDuration', () => {
  it('rounds to the nearest integer with a minimum of 1', () => {
    expect(roundDuration(0)).toBe(1)
    expect(roundDuration(0.4)).toBe(1)
    expect(roundDuration(5.6)).toBe(6)
  })

  it('falls back for non-finite values', () => {
    expect(roundDuration(Number.NaN)).toBe(1)
    expect(roundDuration(Number.NaN, 10)).toBe(10)
  })
})

describe('roundOptionalFrame', () => {
  it('passes undefined through', () => {
    expect(roundOptionalFrame(undefined)).toBeUndefined()
  })

  it('rounds defined numbers', () => {
    expect(roundOptionalFrame(7.4)).toBe(7)
  })
})

describe('normalizeOptionalFps', () => {
  it('rounds to three decimals', () => {
    expect(normalizeOptionalFps(29.970029970029)).toBe(29.97)
  })

  it('drops invalid fps values', () => {
    expect(normalizeOptionalFps(undefined)).toBeUndefined()
    expect(normalizeOptionalFps(0)).toBeUndefined()
    expect(normalizeOptionalFps(-1)).toBeUndefined()
    expect(normalizeOptionalFps(Number.NaN)).toBeUndefined()
  })
})

describe('normalizeFrameFields', () => {
  it('migrates legacy custom paths and keeps mask paths closed', () => {
    const legacyPath: ShapeItem = {
      id: 'path',
      type: 'shape',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
      label: 'Legacy path',
      shapeType: 'path',
      fillColor: '#fff',
      strokeColor: '#000',
      strokeWidth: 2,
      isMask: true,
      pathClosed: false,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 1], inHandle: [-0.1, 0], outHandle: [0.1, 0] },
      ],
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    }
    const path = normalizeFrameFields(legacyPath)

    expect(path).toMatchObject({
      pathClosed: true,
      fillEnabled: true,
      strokeEnabled: true,
      strokeLineCap: 'butt',
      strokeLineJoin: 'miter',
      strokeMiterLimit: 4,
      blendMode: 'normal',
    })
    expect(path.pathVertices?.map((vertex) => vertex.tangentMode)).toEqual(['corner', 'smooth'])
  })

  it('normalizes open paths to stroke-only geometry', () => {
    const openPath: ShapeItem = {
      id: 'open-path',
      type: 'shape',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
      label: 'Open path',
      shapeType: 'path',
      fillColor: '#fff',
      fillEnabled: true,
      pathClosed: false,
      pathVertices: [
        { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
        { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
      ],
    }

    expect(normalizeFrameFields(openPath).fillEnabled).toBe(false)
  })

  it('clamps enabled shape strokes to one pixel without changing disabled stroke history', () => {
    const shape: ShapeItem = {
      id: 'shape',
      type: 'shape',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
      label: 'Shape',
      shapeType: 'rectangle',
      fillColor: '#fff',
      strokeColor: '#000',
      strokeEnabled: true,
      strokeWidth: 0.25,
    }

    expect(normalizeFrameFields(shape).strokeWidth).toBe(1)
    expect(normalizeFrameFields({ ...shape, strokeEnabled: false }).strokeWidth).toBe(0.25)
  })

  it('clamps taper percentages to their supported ranges', () => {
    const shape: ShapeItem = {
      id: 'tapered-shape',
      type: 'shape',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
      label: 'Tapered shape',
      shapeType: 'path',
      fillColor: '#fff',
      taperStartWidth: 250,
      taperEndWidth: -10,
      taperStartLength: 120,
      taperEndLength: -20,
    }

    expect(normalizeFrameFields(shape)).toMatchObject({
      taperStartWidth: 200,
      taperEndWidth: 0,
      taperStartLength: 100,
      taperEndLength: 0,
    })
  })

  it('clamps atomic updates that enable a sub-pixel stroke', () => {
    expect(normalizeItemUpdates({ strokeEnabled: true, strokeWidth: 0 })).toMatchObject({
      strokeEnabled: true,
      strokeWidth: 1,
    })
  })

  it('rounds the required frame fields', () => {
    const result = normalizeFrameFields(
      makeVideo({ from: 10.6, durationInFrames: 5.4 } as VideoItem),
    )
    expect(result.from).toBe(11)
    expect(result.durationInFrames).toBe(5)
  })

  it('rounds optional source/trim fields when present', () => {
    const result = normalizeFrameFields(
      makeVideo({
        trimStart: 1.6,
        trimEnd: 2.6,
        sourceStart: 3.4,
        sourceEnd: 8.5,
        sourceDuration: 12.49,
        sourceFps: 29.970029970029,
      } as VideoItem),
    )
    expect(result.trimStart).toBe(2)
    expect(result.trimEnd).toBe(3)
    expect(result.sourceStart).toBe(3)
    expect(result.sourceEnd).toBe(9)
    expect(result.sourceDuration).toBe(12)
    expect(result.sourceFps).toBe(29.97)
  })

  it('infers sourceStart=0 for legacy clips that only have sourceEnd', () => {
    const result = normalizeFrameFields(
      makeVideo({ sourceEnd: 120, sourceStart: undefined } as VideoItem),
    )
    expect(result.sourceStart).toBe(0)
    expect(result.sourceEnd).toBe(120)
  })

  it('clamps audio EQ gain to ±20 dB', () => {
    const result = normalizeFrameFields(
      makeAudio({
        audioEqOutputGainDb: 50,
        audioEqLowGainDb: -50,
        audioEqHighGainDb: 5,
      } as AudioItem),
    )
    expect(result.audioEqOutputGainDb).toBe(20)
    expect(result.audioEqLowGainDb).toBe(-20)
    expect(result.audioEqHighGainDb).toBe(5)
  })

  it('clamps audio EQ Q values into the supported range', () => {
    const result = normalizeFrameFields(
      makeAudio({
        audioEqLowQ: 0.01,
        audioEqHighQ: 100,
      } as AudioItem),
    )
    expect(result.audioEqLowQ).toBe(0.3)
    expect(result.audioEqHighQ).toBe(10.3)
  })

  it('clamps low-cut and high-cut frequencies into their distinct ranges', () => {
    const result = normalizeFrameFields(
      makeAudio({
        audioEqLowCutFrequencyHz: 5, // below 20 Hz floor
        audioEqHighCutFrequencyHz: 50000, // above 22 kHz ceiling
      } as AudioItem),
    )
    expect(result.audioEqLowCutFrequencyHz).toBe(20)
    expect(result.audioEqHighCutFrequencyHz).toBe(22000)
  })

  it('coerces enabled flags to booleans', () => {
    const result = normalizeFrameFields(
      makeAudio({
        // The schema is typed but the runtime can see truthy non-booleans
        // when projects are restored from disk.
        audioEqLowEnabled: 1 as unknown as boolean,
        audioEqHighEnabled: 0 as unknown as boolean,
      } as AudioItem),
    )
    expect(result.audioEqLowEnabled).toBe(true)
    expect(result.audioEqHighEnabled).toBe(false)
  })

  it('snaps cut slopes to the supported values', () => {
    const result = normalizeFrameFields(
      makeAudio({
        audioEqLowCutSlopeDbPerOct: 7 as unknown as 6,
        audioEqHighCutSlopeDbPerOct: 12,
      } as AudioItem),
    )
    // 7 is not in {6,12,18,24} so clampAudioEqCutSlopeDbPerOct returns the
    // default slope; 12 is valid and passes through unchanged.
    expect([6, 12, 18, 24]).toContain(result.audioEqLowCutSlopeDbPerOct)
    expect(result.audioEqHighCutSlopeDbPerOct).toBe(12)
  })

  it('leaves untouched fields alone (does not introduce undefined optional EQ fields)', () => {
    const result = normalizeFrameFields(makeAudio({}))
    expect(result.audioEqLowGainDb).toBeUndefined()
    expect(result.audioEqHighQ).toBeUndefined()
    expect(result.audioEqOutputGainDb).toBeUndefined()
  })

  it('forces shape masks to use the normal blend mode', () => {
    const masked = normalizeFrameFields({
      id: 'shape-1',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'rect',
      shape: 'rectangle',
      isMask: true,
      blendMode: 'multiply',
    } as unknown as VideoItem)
    expect((masked as unknown as { blendMode: string }).blendMode).toBe('normal')
  })
})

describe('normalizeItemUpdates', () => {
  it('only rounds the fields that were provided', () => {
    const result = normalizeItemUpdates({
      from: 10.6,
      durationInFrames: 4.4,
    })
    expect(result.from).toBe(11)
    expect(result.durationInFrames).toBe(4)
    expect('trimStart' in result).toBe(false)
  })

  it('passes undefined-only updates through without inventing fields', () => {
    const result = normalizeItemUpdates({ label: 'rename' })
    expect(result.label).toBe('rename')
    expect('from' in result).toBe(false)
    expect('audioEqLowGainDb' in result).toBe(false)
  })

  it('clamps any provided EQ values', () => {
    const result = normalizeItemUpdates({
      audioEqOutputGainDb: 99,
      audioEqLowQ: 0,
      audioEqHighCutFrequencyHz: 100000,
    })
    expect(result.audioEqOutputGainDb).toBe(20)
    expect(result.audioEqLowQ).toBe(0.3)
    expect(result.audioEqHighCutFrequencyHz).toBe(22000)
  })

  it('back-fills sourceStart=0 when only sourceEnd is updated (legacy clips)', () => {
    const result = normalizeItemUpdates({ sourceEnd: 240 })
    expect(result.sourceStart).toBe(0)
    expect(result.sourceEnd).toBe(240)
  })

  it('does not insert sourceStart when neither bound is provided', () => {
    const result = normalizeItemUpdates({ from: 5 })
    expect('sourceStart' in result).toBe(false)
  })
})

describe('normalizeTrack', () => {
  it('clamps track volume to -60..12 dB and normalizes EQ settings', () => {
    const clampedHigh = normalizeTrack({
      id: 't1',
      name: 'A',
      order: 0,
      volume: 999,
    } as never)
    expect(clampedHigh.volume).toBe(12)

    const clampedLow = normalizeTrack({
      id: 't1',
      name: 'A',
      order: 0,
      volume: -999,
    } as never)
    expect(clampedLow.volume).toBe(-60)
  })

  it('leaves volume undefined for tracks that did not opt in', () => {
    const track = normalizeTrack({ id: 't1', name: 'A', order: 0 } as never)
    expect(track.volume).toBeUndefined()
  })
})

describe('trimSubtitleCuesAtStart', () => {
  function makeSegment(cues: SubtitleSegmentItem['cues']): SubtitleSegmentItem {
    return {
      id: 'sub-1',
      type: 'subtitle',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 300,
      label: 'sub',
      cues,
      source: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
      color: '#ffffff',
    } as SubtitleSegmentItem
  }

  it('returns null when no trim is requested', () => {
    const result = trimSubtitleCuesAtStart(
      makeSegment([{ id: 'c1', startSeconds: 0, endSeconds: 1, text: 'a' }]),
      0,
      30,
    )
    expect(result).toBeNull()
  })

  it('drops cues entirely before the new boundary', () => {
    const segment = makeSegment([
      { id: 'gone', startSeconds: 0, endSeconds: 0.5, text: 'a' },
      { id: 'keep', startSeconds: 1.5, endSeconds: 2, text: 'b' },
    ])
    const result = trimSubtitleCuesAtStart(segment, 30, 30)!
    expect(result.cues.map((c) => c.id)).toEqual(['keep'])
    expect(result.cues[0]!.startSeconds).toBe(0.5)
    expect(result.cues[0]!.endSeconds).toBe(1)
  })

  it('clamps the start of cues that straddle the boundary', () => {
    const segment = makeSegment([{ id: 'split', startSeconds: 0.4, endSeconds: 2, text: 'a' }])
    const result = trimSubtitleCuesAtStart(segment, 30, 30)!
    expect(result.cues).toHaveLength(1)
    expect(result.cues[0]!.startSeconds).toBe(0)
    expect(result.cues[0]!.endSeconds).toBe(1)
  })
})

describe('trimSubtitleCuesAtEnd', () => {
  function makeSegment(cues: SubtitleSegmentItem['cues']): SubtitleSegmentItem {
    return {
      id: 'sub-1',
      type: 'subtitle',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 300,
      label: 'sub',
      cues,
      source: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
      color: '#ffffff',
    } as SubtitleSegmentItem
  }

  it('drops cues that start after the new duration and truncates straddlers', () => {
    const segment = makeSegment([
      { id: 'keep', startSeconds: 0, endSeconds: 0.5, text: 'a' },
      { id: 'cut', startSeconds: 0.9, endSeconds: 2, text: 'b' },
      { id: 'gone', startSeconds: 2, endSeconds: 3, text: 'c' },
    ])
    const result = trimSubtitleCuesAtEnd(segment, 30, 30)!
    expect(result.cues.map((c) => c.id)).toEqual(['keep', 'cut'])
    expect(result.cues.find((c) => c.id === 'cut')!.endSeconds).toBe(1)
  })
})
