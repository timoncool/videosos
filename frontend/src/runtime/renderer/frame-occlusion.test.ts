import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ImageItem, TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { getAnimatedCrop, getAnimatedTransform } from './canvas-keyframes'
import { hasMediaCrop } from '@/shared/utils/media-crop'
import { resolveAnimatedColorEffects } from '@/runtime/renderer/deps/keyframes-contract'
import { getAdjustmentLayerEffects } from './canvas-effects'
import { isItemFullyOccluding, type FrameOcclusionContext } from './frame-occlusion'

// Mock the geometry/effect helpers so the predicate's own branching is the unit
// under test, independent of transform/crop/effect resolution.
vi.mock('./canvas-keyframes', () => ({
  getAnimatedTransform: vi.fn(),
  getAnimatedCrop: vi.fn(),
}))
vi.mock('@/shared/utils/media-crop', () => ({ hasMediaCrop: vi.fn() }))
vi.mock('@/runtime/renderer/deps/keyframes-contract', () => ({ resolveAnimatedColorEffects: vi.fn() }))
vi.mock('./canvas-effects', () => ({ getAdjustmentLayerEffects: vi.fn() }))

const CANVAS_W = 1920
const CANVAS_H = 1080

// A transform that fully covers the canvas with full opacity.
function fullCoverTransform(overrides: Record<string, number> = {}) {
  return {
    x: 0,
    y: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    ...overrides,
  }
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'v1',
    type: 'video',
    trackId: 't1',
    from: 0,
    durationInFrames: 30,
    label: 'clip.mp4',
    src: 'blob:x',
    mediaId: 'm1',
    ...overrides,
  }
}

function makeContext(overrides: Partial<FrameOcclusionContext> = {}): FrameOcclusionContext {
  return {
    frame: 0,
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    canvasSettings: { width: CANVAS_W, height: CANVAS_H, fps: 30 },
    renderMode: 'export',
    transitionClipIds: new Set<string>(),
    adjustmentLayers: [],
    getCurrentItem: <T extends TimelineItem>(item: T) => item,
    getCurrentKeyframes: () => undefined,
    ...overrides,
  }
}

describe('isItemFullyOccluding', () => {
  beforeEach(() => {
    vi.mocked(getAnimatedTransform).mockReturnValue(fullCoverTransform() as never)
    vi.mocked(getAnimatedCrop).mockReturnValue(undefined as never)
    vi.mocked(hasMediaCrop).mockReturnValue(false)
    vi.mocked(resolveAnimatedColorEffects).mockReturnValue([])
    vi.mocked(getAdjustmentLayerEffects).mockReturnValue([])
  })

  it('returns true for a full-cover opaque video', () => {
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(true)
  })

  it('returns true for a full-cover opaque image', () => {
    const image = { ...makeVideoItem(), type: 'image' } as unknown as ImageItem
    expect(isItemFullyOccluding(image, 0, makeContext())).toBe(true)
  })

  it('returns false for non-opaque item types (text)', () => {
    const text = { id: 't', type: 'text', trackId: 't1', from: 0, durationInFrames: 30 } as TextItem
    expect(isItemFullyOccluding(text, 0, makeContext())).toBe(false)
  })

  it('returns false for an item participating in a transition', () => {
    const ctx = makeContext({ transitionClipIds: new Set(['v1']) })
    expect(isItemFullyOccluding(makeVideoItem(), 0, ctx)).toBe(false)
  })

  it('returns false for a non-normal blend mode', () => {
    expect(isItemFullyOccluding(makeVideoItem({ blendMode: 'multiply' }), 0, makeContext())).toBe(
      false,
    )
  })

  it('returns false when a corner pin is present', () => {
    const item = makeVideoItem({ cornerPin: {} as VideoItem['cornerPin'] })
    expect(isItemFullyOccluding(item, 0, makeContext())).toBe(false)
  })

  it('returns false when the item is cropped', () => {
    vi.mocked(hasMediaCrop).mockReturnValue(true)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('returns false when opacity is below 1', () => {
    vi.mocked(getAnimatedTransform).mockReturnValue(fullCoverTransform({ opacity: 0.5 }) as never)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('returns false for a full-cover video whose source can be transparent', () => {
    const ctx = makeContext({ hasTransparentVideoSource: () => true })
    expect(isItemFullyOccluding(makeVideoItem(), 0, ctx)).toBe(false)
  })

  it('returns true for a full-cover video whose source is opaque', () => {
    const ctx = makeContext({ hasTransparentVideoSource: () => false })
    expect(isItemFullyOccluding(makeVideoItem(), 0, ctx)).toBe(true)
  })

  it('ignores the transparent-source check for images (video-only)', () => {
    const image = { ...makeVideoItem(), type: 'image' } as unknown as ImageItem
    const ctx = makeContext({ hasTransparentVideoSource: () => true })
    expect(isItemFullyOccluding(image, 0, ctx)).toBe(true)
  })

  it('returns true for a 180-degree rotation (still covers)', () => {
    vi.mocked(getAnimatedTransform).mockReturnValue(fullCoverTransform({ rotation: 180 }) as never)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(true)
  })

  it('returns false for a 90-degree rotation (exposes corners)', () => {
    vi.mocked(getAnimatedTransform).mockReturnValue(fullCoverTransform({ rotation: 90 }) as never)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('returns false with a non-zero corner radius', () => {
    vi.mocked(getAnimatedTransform).mockReturnValue(
      fullCoverTransform({ cornerRadius: 8 }) as never,
    )
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('returns false when the item does not cover the canvas', () => {
    vi.mocked(getAnimatedTransform).mockReturnValue(
      fullCoverTransform({ width: 100, height: 100 }) as never,
    )
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('returns false when an adjustment-layer effect adds transparency', () => {
    vi.mocked(getAdjustmentLayerEffects).mockReturnValue([
      { enabled: true, effect: { opacity: 0.5 } },
    ] as never)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(false)
  })

  it('ignores a disabled transparency effect', () => {
    vi.mocked(getAdjustmentLayerEffects).mockReturnValue([
      { enabled: false, effect: { opacity: 0.5 } },
    ] as never)
    expect(isItemFullyOccluding(makeVideoItem(), 0, makeContext())).toBe(true)
  })
})
