import type { CompositionInputProps } from '@/types/export'
import {
  importCompositionRenderer,
  type CompositionRendererInstance,
} from '@/features/preview/deps/export'

const COMPARISON_SESSION_RETAIN_MS = 5_000
const COMPARISON_SESSION_CACHE_LIMIT = 4

interface ComparisonSessionDescriptor {
  key: string
  compositionId: string
  input: CompositionInputProps
  width: number
  height: number
  useProxyMedia: boolean
  priorityFrame: number
}

interface ReadyRenderResources {
  renderer: CompositionRendererInstance
  offscreen: OffscreenCanvas
}

function copyComparisonFrame(offscreen: OffscreenCanvas, target: HTMLCanvasElement): boolean {
  const targetContext = target.getContext('2d')
  if (!targetContext) return false
  if (target.width !== offscreen.width || target.height !== offscreen.height) {
    target.width = offscreen.width
    target.height = offscreen.height
  }
  targetContext.clearRect(0, 0, target.width, target.height)
  targetContext.drawImage(offscreen, 0, 0, target.width, target.height)
  return true
}

export interface ComparisonCompositionRenderLease {
  requestFrame: (frame: number, target: HTMLCanvasElement, signal?: AbortSignal) => Promise<boolean>
  release: () => void
}

class ComparisonCompositionRenderSession {
  readonly key: string
  readonly compositionId: string

  private readonly input: CompositionInputProps
  private readonly width: number
  private readonly height: number
  private readonly useProxyMedia: boolean
  private readonly priorityFrames = new Set<number>()
  private readonly controller = new AbortController()
  private readonly renderReady: Promise<void>
  private resolveRenderReady!: () => void
  private renderer: CompositionRendererInstance | null = null
  private offscreen: OffscreenCanvas | null = null
  private initializationError: unknown = null
  private renderQueue: Promise<void> = Promise.resolve()
  private retainTimer: ReturnType<typeof setTimeout> | null = null
  private leaseCount = 0
  private disposed = false
  lastUsedAt = Date.now()

  constructor(descriptor: ComparisonSessionDescriptor) {
    this.key = descriptor.key
    this.compositionId = descriptor.compositionId
    this.input = descriptor.input
    this.width = descriptor.width
    this.height = descriptor.height
    this.useProxyMedia = descriptor.useProxyMedia
    this.priorityFrames.add(descriptor.priorityFrame)
    this.renderReady = new Promise<void>((resolve) => {
      this.resolveRenderReady = resolve
    })

    // Defer boot by one microtask so sibling 2-up/4-up panels mounted in the
    // same React commit can contribute all of their exact target frames.
    void Promise.resolve().then(() => this.initialize())
  }

  acquire(priorityFrame: number): ComparisonCompositionRenderLease {
    if (this.disposed) throw new Error('Comparison render session is disposed')
    this.priorityFrames.add(priorityFrame)
    this.leaseCount += 1
    this.lastUsedAt = Date.now()
    if (this.retainTimer) {
      clearTimeout(this.retainTimer)
      this.retainTimer = null
    }

    let released = false
    return {
      requestFrame: (frame, target, signal) => this.requestFrame(frame, target, signal),
      release: () => {
        if (released) return
        released = true
        this.release()
      },
    }
  }

  isIdle(): boolean {
    return this.leaseCount === 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
    this.resolveRenderReady()
    if (this.retainTimer) {
      clearTimeout(this.retainTimer)
      this.retainTimer = null
    }
    this.renderer?.dispose()
    this.renderer = null
    this.offscreen = null
  }

  private async initialize(): Promise<void> {
    try {
      if (this.controller.signal.aborted) return
      const offscreen = new OffscreenCanvas(this.width, this.height)
      const ctx = offscreen.getContext('2d')
      if (!ctx) throw new Error('Unable to create comparison render context')

      const { createCompositionRenderer } = await importCompositionRenderer()
      if (this.controller.signal.aborted) return
      const renderer = await createCompositionRenderer(this.input, offscreen, ctx, {
        mode: 'comparison',
        useProxyMedia: this.useProxyMedia,
      })
      if (this.controller.signal.aborted) {
        renderer.dispose()
        return
      }

      this.renderer = renderer
      this.offscreen = offscreen
      if ('warmGpuPipeline' in renderer) {
        void renderer.warmGpuPipeline()
      }

      const priorityFrames = [...this.priorityFrames]
      await renderer.preload({
        priorityFrame: priorityFrames[0],
        priorityFrames,
        onPriorityMediaReady: this.resolveRenderReady,
        signal: this.controller.signal,
      })
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.initializationError = error
      }
    } finally {
      this.resolveRenderReady()
    }
  }

  private requestFrame(
    frame: number,
    target: HTMLCanvasElement,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const task = this.renderQueue.then(async () => {
      const resources = await this.getReadyRenderResources(signal)
      if (!resources) return false
      await resources.renderer.renderFrame(frame)
      if (this.isCancelled(signal)) return false
      if (!copyComparisonFrame(resources.offscreen, target)) return false
      this.lastUsedAt = Date.now()
      return true
    })

    this.renderQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async getReadyRenderResources(
    signal?: AbortSignal,
  ): Promise<ReadyRenderResources | null> {
    await this.renderReady
    if (this.isCancelled(signal)) return null
    if (this.initializationError) throw this.initializationError
    if (!this.renderer || !this.offscreen) return null
    return { renderer: this.renderer, offscreen: this.offscreen }
  }

  private isCancelled(signal?: AbortSignal): boolean {
    return signal?.aborted === true || this.controller.signal.aborted || this.disposed
  }

  private release(): void {
    this.leaseCount = Math.max(0, this.leaseCount - 1)
    this.lastUsedAt = Date.now()
    if (this.leaseCount > 0 || this.disposed) return
    this.retainTimer = setTimeout(() => {
      if (!this.isIdle()) return
      removeAndDisposeSession(this.key, this)
    }, COMPARISON_SESSION_RETAIN_MS)
  }
}

const comparisonSessions = new Map<string, ComparisonCompositionRenderSession>()

function removeAndDisposeSession(key: string, session: ComparisonCompositionRenderSession): void {
  if (comparisonSessions.get(key) === session) {
    comparisonSessions.delete(key)
  }
  session.dispose()
}

function evictStaleCompositionSessions(compositionId: string, activeKey: string): void {
  for (const [key, session] of comparisonSessions) {
    if (key !== activeKey && session.compositionId === compositionId) {
      removeAndDisposeSession(key, session)
    }
  }
}

function enforceCacheLimit(): void {
  if (comparisonSessions.size < COMPARISON_SESSION_CACHE_LIMIT) return
  const idleSessions = [...comparisonSessions.entries()]
    .filter(([, session]) => session.isIdle())
    .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)
  const oldest = idleSessions[0]
  if (oldest) removeAndDisposeSession(oldest[0], oldest[1])
}

export function acquireComparisonCompositionRenderSession(
  descriptor: ComparisonSessionDescriptor,
): ComparisonCompositionRenderLease {
  evictStaleCompositionSessions(descriptor.compositionId, descriptor.key)
  let session = comparisonSessions.get(descriptor.key)
  if (!session) {
    enforceCacheLimit()
    session = new ComparisonCompositionRenderSession(descriptor)
    comparisonSessions.set(descriptor.key, session)
  }
  return session.acquire(descriptor.priorityFrame)
}

export function disposeComparisonCompositionRenderSessionsForTest(): void {
  for (const [key, session] of comparisonSessions) {
    removeAndDisposeSession(key, session)
  }
}
