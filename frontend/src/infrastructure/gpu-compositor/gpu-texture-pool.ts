/**
 * GPU Texture Pool
 *
 * Reuses GPUTexture objects across frames to eliminate per-frame allocation
 * and destruction overhead in the compositor pipeline. Textures are keyed
 * by dimensions + format and recycled via acquire/release semantics.
 *
 * Typical savings: 0.5-2ms per frame with 5+ composited layers.
 */

import { createLogger } from '@/shared/logging/logger'

const log = createLogger('GpuTexturePool')

interface PoolEntry {
  texture: GPUTexture
  inUse: boolean
  bytes: number
  lastUsed: number
}

export interface GpuTexturePoolOptions {
  maxBytes?: number
  maxIdlePerKey?: number
}

const FALLBACK_TEXTURE_POOL_BUDGET_BYTES = 384_000_000
const MIN_TEXTURE_POOL_BUDGET_BYTES = 128_000_000
const MAX_TEXTURE_POOL_BUDGET_BYTES = 512_000_000
const DEFAULT_MAX_IDLE_PER_KEY = 24

function textureBytesPerPixel(format: GPUTextureFormat): number {
  if (format.includes('32float')) return 16
  if (format.includes('16float') || format.includes('16uint') || format.includes('16sint')) return 8
  return 4
}

export function resolveGpuTexturePoolBudgetBytes(deviceMemoryGb?: number): number {
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb)) {
    return FALLBACK_TEXTURE_POOL_BUDGET_BYTES
  }
  return Math.max(
    MIN_TEXTURE_POOL_BUDGET_BYTES,
    Math.min(MAX_TEXTURE_POOL_BUDGET_BYTES, Math.round(deviceMemoryGb * 0.03125 * 1_000_000_000)),
  )
}

function getDefaultTexturePoolBudgetBytes(): number {
  const deviceMemoryGb =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { deviceMemory?: number }).deviceMemory
  return resolveGpuTexturePoolBudgetBytes(deviceMemoryGb)
}

function poolKeyToString(width: number, height: number, format: GPUTextureFormat): string {
  return `${width}x${height}x${format}`
}

export class GpuTexturePool {
  private device: GPUDevice
  private pools = new Map<string, PoolEntry[]>()
  private usage: GPUTextureUsageFlags
  private totalCreated = 0
  private totalAcquires = 0
  private cacheHits = 0
  private currentBytes = 0
  private clock = 0
  private readonly maxBytes: number
  private readonly maxIdlePerKey: number

  constructor(
    device: GPUDevice,
    usage: GPUTextureUsageFlags = GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
    options: GpuTexturePoolOptions = {},
  ) {
    this.device = device
    this.usage = usage
    this.maxBytes = Math.max(1, options.maxBytes ?? getDefaultTexturePoolBudgetBytes())
    this.maxIdlePerKey = Math.max(1, options.maxIdlePerKey ?? DEFAULT_MAX_IDLE_PER_KEY)
  }

  acquire(width: number, height: number, format: GPUTextureFormat = 'rgba8unorm'): GPUTexture {
    const key = poolKeyToString(width, height, format)
    this.totalAcquires++

    const entries = this.pools.get(key)
    if (entries) {
      for (const entry of entries) {
        if (!entry.inUse) {
          entry.inUse = true
          entry.lastUsed = ++this.clock
          this.cacheHits++
          return entry.texture
        }
      }
    }

    const texture = this.device.createTexture({
      size: { width, height },
      format,
      usage: this.usage,
    })

    const bytes = width * height * textureBytesPerPixel(format)
    const entry: PoolEntry = { texture, inUse: true, bytes, lastUsed: ++this.clock }
    if (entries) {
      entries.push(entry)
    } else {
      this.pools.set(key, [entry])
    }
    this.totalCreated++
    this.currentBytes += bytes
    return texture
  }

  release(texture: GPUTexture): void {
    const key = poolKeyToString(texture.width, texture.height, texture.format)
    const entries = this.pools.get(key)
    if (!entries) return
    for (const entry of entries) {
      if (entry.texture === texture) {
        entry.inUse = false
        entry.lastUsed = ++this.clock
        this.trimIdleEntries(key)
        this.trimToBudget()
        return
      }
    }
  }

  destroy(): void {
    for (const entries of this.pools.values()) {
      for (const entry of entries) {
        entry.texture.destroy()
      }
    }
    this.pools.clear()
    this.currentBytes = 0
    log.debug('Texture pool destroyed', {
      totalCreated: this.totalCreated,
      totalAcquires: this.totalAcquires,
      cacheHitRate:
        this.totalAcquires > 0
          ? `${((this.cacheHits / this.totalAcquires) * 100).toFixed(1)}%`
          : 'n/a',
    })
  }

  getStats(): {
    totalCreated: number
    totalAcquires: number
    cacheHits: number
    entries: number
    inUse: number
    bytes: number
    budgetBytes: number
  } {
    let entries = 0
    let inUse = 0
    for (const pool of this.pools.values()) {
      entries += pool.length
      inUse += pool.filter((entry) => entry.inUse).length
    }
    return {
      totalCreated: this.totalCreated,
      totalAcquires: this.totalAcquires,
      cacheHits: this.cacheHits,
      entries,
      inUse,
      bytes: this.currentBytes,
      budgetBytes: this.maxBytes,
    }
  }

  private trimIdleEntries(key: string): void {
    const entries = this.pools.get(key)
    if (!entries) return
    const idle = entries.filter((entry) => !entry.inUse).toSorted((a, b) => a.lastUsed - b.lastUsed)
    while (idle.length > this.maxIdlePerKey) {
      const victim = idle.shift()
      if (!victim) break
      this.destroyEntry(key, victim)
    }
  }

  private trimToBudget(): void {
    while (this.currentBytes > this.maxBytes) {
      let victimKey: string | null = null
      let victim: PoolEntry | null = null
      for (const [key, entries] of this.pools) {
        for (const entry of entries) {
          if (entry.inUse || (victim && entry.lastUsed >= victim.lastUsed)) continue
          victimKey = key
          victim = entry
        }
      }
      if (!victim || !victimKey) break
      this.destroyEntry(victimKey, victim)
    }
  }

  private destroyEntry(key: string, entry: PoolEntry): void {
    const entries = this.pools.get(key)
    if (!entries) return
    const index = entries.indexOf(entry)
    if (index === -1) return
    entries.splice(index, 1)
    entry.texture.destroy()
    this.currentBytes = Math.max(0, this.currentBytes - entry.bytes)
    if (entries.length === 0) this.pools.delete(key)
  }
}
