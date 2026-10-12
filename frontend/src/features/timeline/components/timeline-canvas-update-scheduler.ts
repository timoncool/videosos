interface TimelineCanvasUpdate {
  run: () => void
  minimumIntervalMs: number
}

const pendingUpdates = new Map<object, TimelineCanvasUpdate>()
const lastRunAt = new WeakMap<object, number>()
let scheduledFrame: number | null = null

function runScheduledUpdates(timestamp: number) {
  scheduledFrame = null

  for (const [key, update] of pendingUpdates) {
    const previousRunAt = lastRunAt.get(key)
    if (
      previousRunAt !== undefined &&
      timestamp - previousRunAt + 0.5 < update.minimumIntervalMs
    ) {
      continue
    }

    pendingUpdates.delete(key)
    lastRunAt.set(key, timestamp)
    update.run()
  }

  if (pendingUpdates.size > 0) {
    scheduledFrame = requestAnimationFrame(runScheduledUpdates)
  }
}

/**
 * Coalesces zoom and anchored-scroll canvas work onto display frames. Each
 * caller owns a stable key, so bursts retain only the latest snapshot callback
 * and can opt into a workload-aware sharp redraw cadence.
 */
export function scheduleTimelineCanvasUpdate(
  key: object,
  run: () => void,
  minimumIntervalMs = 16,
): void {
  pendingUpdates.set(key, {
    run,
    minimumIntervalMs: Math.max(0, minimumIntervalMs),
  })
  if (scheduledFrame === null) {
    scheduledFrame = requestAnimationFrame(runScheduledUpdates)
  }
}

export function cancelTimelineCanvasUpdate(key: object): void {
  pendingUpdates.delete(key)
  if (pendingUpdates.size === 0 && scheduledFrame !== null) {
    cancelAnimationFrame(scheduledFrame)
    scheduledFrame = null
  }
}

export function _resetTimelineCanvasUpdateSchedulerForTest(): void {
  pendingUpdates.clear()
  if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame)
  scheduledFrame = null
}
