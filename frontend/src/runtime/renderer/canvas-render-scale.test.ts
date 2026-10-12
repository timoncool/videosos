import { describe, expect, it } from 'vite-plus/test'
import type { ShapeItem, SubtitleSegmentItem, TextItem } from '@/types/timeline'
import {
  scaleShapeItemForCanvas,
  scaleSubtitleItemForCanvas,
  scaleTextItemForCanvas,
} from './canvas-render-scale'

const previewCanvas = {
  width: 960,
  height: 540,
  logicalWidth: 3840,
  logicalHeight: 2160,
}

describe('canvas render scaling', () => {
  it('scales text pixel styling without changing authored data', () => {
    const item: TextItem = {
      id: 'text-scale',
      type: 'text',
      trackId: 'text-track',
      from: 0,
      durationInFrames: 30,
      label: 'Text',
      text: 'Preview',
      color: '#fff',
      fontSize: 80,
      letterSpacing: 8,
      textPadding: 24,
      backgroundRadius: 16,
      textShadow: { offsetX: 8, offsetY: 4, blur: 12, color: '#000' },
      stroke: { width: 4, color: '#000' },
    }

    const scaled = scaleTextItemForCanvas(item, previewCanvas)
    expect(scaled).toMatchObject({
      fontSize: 20,
      letterSpacing: 2,
      textPadding: 6,
      backgroundRadius: 4,
      textShadow: { offsetX: 2, offsetY: 1, blur: 3 },
      stroke: { width: 1 },
    })
    expect(item.fontSize).toBe(80)
  })

  it('scales shape stroke, rounding, and mask feather', () => {
    const item: ShapeItem = {
      id: 'shape-scale',
      type: 'shape',
      trackId: 'shape-track',
      from: 0,
      durationInFrames: 30,
      label: 'Shape',
      shapeType: 'rectangle',
      fillColor: '#fff',
      strokeWidth: 12,
      cornerRadius: 20,
      maskFeather: 40,
    }

    expect(scaleShapeItemForCanvas(item, previewCanvas)).toMatchObject({
      strokeWidth: 3,
      cornerRadius: 5,
      maskFeather: 10,
    })
  })

  it('scales subtitle pixel styling without changing authored data', () => {
    const item: SubtitleSegmentItem = {
      id: 'subtitle-scale',
      type: 'subtitle',
      trackId: 'subtitle-track',
      from: 0,
      durationInFrames: 30,
      label: 'Subtitles',
      source: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
      cues: [{ id: 'cue-1', startSeconds: 0, endSeconds: 1, text: 'Preview' }],
      color: '#fff',
      fontSize: 80,
      letterSpacing: 8,
      textPadding: 24,
      backgroundRadius: 16,
      textShadow: { offsetX: 8, offsetY: 4, blur: 12, color: '#000' },
      stroke: { width: 4, color: '#000' },
    }

    const scaled = scaleSubtitleItemForCanvas(item, previewCanvas)
    expect(scaled).toMatchObject({
      fontSize: 20,
      letterSpacing: 2,
      textPadding: 6,
      backgroundRadius: 4,
      textShadow: { offsetX: 2, offsetY: 1, blur: 3 },
      stroke: { width: 1 },
    })
    expect(item.fontSize).toBe(80)
  })
})
