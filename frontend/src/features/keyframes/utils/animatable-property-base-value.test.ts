// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ImageItem, TextItem, VideoItem } from '@/types/timeline'
import { getAnimatablePropertyBaseValue } from './animatable-property-base-value'

const CANVAS = { width: 1920, height: 1080, fps: 30 }

describe('getAnimatablePropertyBaseValue', () => {
  it('reads authored text values instead of falling back to zero', () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      text: 'Motion',
      label: 'Motion',
      color: '#ffffff',
      fontSize: 72,
      lineHeight: 1.4,
      textPadding: 24,
      backgroundRadius: 12,
      textShadow: { offsetX: 3, offsetY: 4, blur: 8, color: '#000000' },
      stroke: { width: 2, color: '#ffffff' },
    }

    expect(getAnimatablePropertyBaseValue(item, 'fontSize', CANVAS)).toBe(72)
    expect(getAnimatablePropertyBaseValue(item, 'lineHeight', CANVAS)).toBe(1.4)
    expect(getAnimatablePropertyBaseValue(item, 'textPadding', CANVAS)).toBe(24)
    expect(getAnimatablePropertyBaseValue(item, 'backgroundRadius', CANVAS)).toBe(12)
    expect(getAnimatablePropertyBaseValue(item, 'textShadowOffsetX', CANVAS)).toBe(3)
    expect(getAnimatablePropertyBaseValue(item, 'textShadowOffsetY', CANVAS)).toBe(4)
    expect(getAnimatablePropertyBaseValue(item, 'textShadowBlur', CANVAS)).toBe(8)
    expect(getAnimatablePropertyBaseValue(item, 'strokeWidth', CANVAS)).toBe(2)
  })

  it('converts stored crop ratios to source pixels', () => {
    const item: VideoItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Video',
      src: 'video.mp4',
      sourceWidth: 1920,
      sourceHeight: 1080,
      crop: { left: 0.25, top: 0.1, softness: 0.05 },
    }

    expect(getAnimatablePropertyBaseValue(item, 'cropLeft', CANVAS)).toBe(480)
    expect(getAnimatablePropertyBaseValue(item, 'cropTop', CANVAS)).toBe(108)
    expect(getAnimatablePropertyBaseValue(item, 'cropSoftness', CANVAS)).toBe(54)
  })

  it('uses the resolved fit-to-canvas transform for implicit dimensions', () => {
    const item: ImageItem = {
      id: 'image-1',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Image',
      src: 'image.jpg',
      sourceWidth: 1000,
      sourceHeight: 500,
    }

    expect(getAnimatablePropertyBaseValue(item, 'width', CANVAS)).toBe(1920)
    expect(getAnimatablePropertyBaseValue(item, 'height', CANVAS)).toBe(960)
  })
})
