import { describe, expect, it } from 'vite-plus/test'
import {
  createReversePlaybackWindowScheduler,
  resolveReversePlaybackWindowPlan,
  shouldQueueReversePlaybackWindow,
  type ReversePlaybackWindowSchedulerDeps,
} from './reverse-playback-window'

describe('reverse playback decoded-frame windows', () => {
  it('keeps 1x targets adjacent and ordered backward from the clock frame', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 100,
      fps: 30,
      playbackRate: -1,
      maxSamples: 5,
    })

    expect(plan).toMatchObject({
      highFrame: 100,
      lowFrame: 96,
      strideFrames: 1,
      targetFrames: [100, 99, 98, 97, 96],
    })
  })

  it('skips non-presentable intermediate frames at 4x without changing clock rate', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 200,
      fps: 30,
      playbackRate: -4,
      maxSamples: 5,
      presentationFps: 60,
    })

    expect(plan.strideFrames).toBe(2)
    expect(plan.targetFrames).toEqual([200, 198, 196, 194, 192])
  })

  it('refills only near the consumed edge and never stacks work in flight', () => {
    const prepared = {
      preparedLowFrame: 80,
      preparedHighFrame: 100,
      refillFrame: 88,
    }

    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 94,
        requestInFlight: false,
      }),
    ).toBe(false)
    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 88,
        requestInFlight: false,
      }),
    ).toBe(true)
    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 70,
        requestInFlight: true,
      }),
    ).toBe(false)
  })

  it('clamps a start-boundary window without duplicate negative targets', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 2,
      fps: 30,
      playbackRate: -4,
      maxSamples: 20,
    })

    expect(plan.targetFrames).toEqual([2, 0])
    expect(plan.lowFrame).toBe(0)
  })
})

interface PendingWindow {
  timestamps: number[]
  signal: AbortSignal | undefined
  resolve: (frames: Map<number, ImageBitmap>) => void
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('reverse playback window scheduler', () => {
  const createHarness = (overrides: Partial<ReversePlaybackWindowSchedulerDeps> = {}) => {
    const pending: PendingWindow[] = []
    const scheduler = createReversePlaybackWindowScheduler({
      fps: 30,
      useProxy: false,
      // -2x, so a window spans several authored frames between two presentations.
      getPlaybackState: () => ({ isPlaying: true, playbackRate: -2 }),
      collectSourceTimes: (frame) => new Map([['src-a', [frame / 30]]]),
      batchPreseek: (_src, timestamps, options) => {
        const deferred = createDeferred<Map<number, ImageBitmap>>()
        pending.push({ timestamps, signal: options?.signal, resolve: deferred.resolve })
        return deferred.promise
      },
      scheduleProxyFallback: () => {},
      ...overrides,
    })
    return { scheduler, pending }
  }

  /**
   * Drains the scheduler's settle chain (resolve -> Promise.all -> .then ->
   * .finally -> replan). Deterministic turns, not a wall-clock wait.
   */
  const flushSettled = async (turns = 6) => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
  }

  it('runs a target queued mid-window once the in-flight window settles', async () => {
    const { scheduler, pending } = createHarness()

    scheduler.schedule(300)
    scheduler.schedule(200)
    expect(pending).toHaveLength(1)

    pending[0]!.resolve(new Map([[1, {} as ImageBitmap]]))
    await flushSettled()

    expect(pending).toHaveLength(2)
    // The queued target is planned when it runs, not when it was queued.
    expect(pending[1]!.timestamps[0]).toBeCloseTo(200 / 30)
  })

  it('reuses a prepared window and rebuilds it after reset()', async () => {
    const { scheduler, pending } = createHarness()

    scheduler.schedule(300)
    pending[0]!.resolve(new Map([[1, {} as ImageBitmap]]))
    await flushSettled()

    scheduler.schedule(300)
    await flushSettled()
    expect(pending).toHaveLength(1)

    scheduler.reset()
    scheduler.schedule(300)
    await flushSettled()
    expect(pending).toHaveLength(2)
  })

  it('aborts the in-flight window on reset()', () => {
    const { scheduler, pending } = createHarness()

    scheduler.schedule(300)
    const signal = pending[0]!.signal
    expect(signal?.aborted).toBe(false)

    scheduler.reset()
    expect(signal?.aborted).toBe(true)
  })
})
