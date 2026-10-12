// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { GpuTexturePool, resolveGpuTexturePoolBudgetBytes } from './gpu-texture-pool'

function createMockDevice() {
  const textures: Array<GPUTexture & { destroy: ReturnType<typeof vi.fn> }> = []
  const createTexture = vi.fn((descriptor: GPUTextureDescriptor) => {
    const size = descriptor.size as GPUExtent3DDict
    const texture = {
      width: size.width,
      height: size.height,
      format: descriptor.format,
      destroy: vi.fn(),
    } as unknown as GPUTexture & { destroy: ReturnType<typeof vi.fn> }
    textures.push(texture)
    return texture
  })
  return {
    device: { createTexture } as unknown as GPUDevice,
    createTexture,
    textures,
  }
}

describe('GpuTexturePool budgets', () => {
  it('derives a conservative bounded default from system memory', () => {
    expect(resolveGpuTexturePoolBudgetBytes()).toBe(384_000_000)
    expect(resolveGpuTexturePoolBudgetBytes(4)).toBe(128_000_000)
    expect(resolveGpuTexturePoolBudgetBytes(16)).toBe(500_000_000)
    expect(resolveGpuTexturePoolBudgetBytes(64)).toBe(512_000_000)
  })

  it('reuses released textures', () => {
    const { device, createTexture } = createMockDevice()
    const pool = new GpuTexturePool(device, 1, { maxBytes: 1024, maxIdlePerKey: 2 })

    const first = pool.acquire(2, 2)
    pool.release(first)
    const second = pool.acquire(2, 2)

    expect(second).toBe(first)
    expect(createTexture).toHaveBeenCalledTimes(1)
    expect(pool.getStats().cacheHits).toBe(1)
  })

  it('trims idle entries by key and byte budget without destroying in-use textures', () => {
    const { device, textures } = createMockDevice()
    const pool = new GpuTexturePool(device, 1, { maxBytes: 64, maxIdlePerKey: 1 })

    const first = pool.acquire(4, 4)
    const second = pool.acquire(4, 4)
    pool.release(first)

    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(textures[1]!.destroy).not.toHaveBeenCalled()
    expect(pool.getStats().inUse).toBe(1)

    pool.release(second)
    expect(pool.getStats()).toMatchObject({ entries: 1, inUse: 0, bytes: 64 })
  })
})
