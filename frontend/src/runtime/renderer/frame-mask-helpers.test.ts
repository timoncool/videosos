import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { applyMasks, type MaskCanvasSettings, type PreparedMask } from './canvas-masks'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import type { CanvasPool } from './canvas-pool'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import {
  applyTrackScopedMasks,
  renderMasksToGpuTexture,
  type RenderedTaskResult,
} from './frame-mask-helpers'

vi.mock('./canvas-masks', () => ({ applyMasks: vi.fn() }))
vi.mock('@/shared/utils/mask-scope', () => ({ doesMaskAffectTrack: vi.fn() }))

const MASK_SETTINGS: MaskCanvasSettings = { width: 1920, height: 1080, fps: 30 }

function fakeCanvas(tag: string): OffscreenCanvas {
  return { tag } as unknown as OffscreenCanvas
}

function fakeMask(trackOrder: number): PreparedMask {
  return { inverted: false, feather: 0, opacity: 1, maskType: 'clip', trackOrder }
}

// A canvas pool whose acquire() hands back a tagged fake canvas + stub ctx.
function fakePool(): CanvasPool {
  return {
    acquire: () => ({ canvas: fakeCanvas('pooled'), ctx: {} as OffscreenCanvasRenderingContext2D }),
  } as unknown as CanvasPool
}

describe('applyTrackScopedMasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const deps = () => ({
    activeMasks: [fakeMask(0)],
    canvasPool: fakePool(),
    maskSettings: MASK_SETTINGS,
  })

  it('returns null for a null result', () => {
    expect(applyTrackScopedMasks(null, 0, false, deps())).toBeNull()
  })

  it('passes a GPU-texture result through unchanged', () => {
    const result: RenderedTaskResult = { gpuTexture: {} as GPUTexture, poolCanvases: [] }
    expect(applyTrackScopedMasks(result, 0, false, deps())).toBe(result)
    expect(applyMasks).not.toHaveBeenCalled()
  })

  it('returns null when the result has no source', () => {
    expect(applyTrackScopedMasks({ poolCanvases: [] }, 0, false, deps())).toBeNull()
  })

  it('passes the result through unchanged when masking is skipped', () => {
    const result: RenderedTaskResult = { source: fakeCanvas('src'), poolCanvases: [] }
    expect(applyTrackScopedMasks(result, 0, true, deps())).toBe(result)
    expect(applyMasks).not.toHaveBeenCalled()
  })

  it('passes through unchanged when no mask affects the track', () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(false)
    const result: RenderedTaskResult = { source: fakeCanvas('src'), poolCanvases: [] }
    expect(applyTrackScopedMasks(result, 5, false, deps())).toBe(result)
    expect(applyMasks).not.toHaveBeenCalled()
  })

  it('applies masks and appends the masked canvas to poolCanvases', () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(true)
    const original = fakeCanvas('src')
    const result: RenderedTaskResult = { source: original, poolCanvases: [original] }

    const out = applyTrackScopedMasks(result, 0, false, deps())

    expect(out).not.toBe(result)
    expect(out?.source).not.toBe(original)
    expect(out?.poolCanvases).toHaveLength(2)
    expect(out?.poolCanvases[0]).toBe(original)
    expect(applyMasks).toHaveBeenCalledTimes(1)
  })
})

describe('renderMasksToGpuTexture', () => {
  const baseDeps = (texturePool: unknown) => ({
    gpu: { texturePool } as unknown as GpuPipelineManager,
    canvasSettings: MASK_SETTINGS,
    maskSettings: MASK_SETTINGS,
  })

  it('returns null when there is no GPU texture pool', () => {
    expect(renderMasksToGpuTexture([fakeMask(0)], baseDeps(null))).toBeNull()
  })

  it('returns null when there are no masks', () => {
    expect(renderMasksToGpuTexture([], baseDeps({}))).toBeNull()
  })
})
