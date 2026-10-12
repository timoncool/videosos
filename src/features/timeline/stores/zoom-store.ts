import { create } from 'zustand'

import { getZoomToFitLevel } from '../utils/timeline-layout'
import { usePlaybackStore } from '@/shared/state/playback'

interface ZoomState {
  // Visual zoom drives cursor anchoring and shell layout during interaction.
  level: number
  pixelsPerSecond: number
  // Content zoom is the settled value used by expensive consumers such as culling.
  contentLevel: number
  contentPixelsPerSecond: number
  isZoomInteracting: boolean
}

interface ZoomActions {
  beginZoomGesture: () => void
  endZoomGesture: () => void
  setZoomLevel: (level: number) => void
  setZoomLevelImmediate: (level: number) => void // Bypasses throttle for smooth momentum zoom
  setZoomLevelSynchronized: (level: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomToFit: (containerWidth: number, contentDurationSeconds: number) => void
}

interface SettledZoomState {
  contentLevel: number
  contentPixelsPerSecond: number
}

/**
 * Content-only zoom channel.
 *
 * The live zoom store publishes on every wheel frame. Expensive clip selectors
 * only care about the committed content scale, so keeping that pair in a
 * separate store prevents every mounted clip from evaluating its selector on
 * each live update.
 */
export const useSettledZoomStore = create<SettledZoomState>(() => ({
  contentLevel: 1,
  contentPixelsPerSecond: 100,
}))

// Throttle visual zoom updates a bit for non-immediate callers like the header
// slider, then let committed content zoom catch up only after interaction settles.
const VISUAL_ZOOM_THROTTLE_MS = 120
// Keep rich clip content/culling frozen across a wheel burst, including slower
// mouse-wheel notches. Track shells, canvases, and the ruler still update live;
// this only keeps a late content commit from colliding with the next wheel task.
const CONTENT_ZOOM_SETTLE_MS = 200
const PLAYBACK_CONTENT_ZOOM_COMMIT_DEADLINE_MS = 200
let lastVisualZoomUpdate = 0
let pendingVisualZoomLevel: number | null = null
let pendingContentZoomLevel: number | null = null
let visualZoomThrottleTimeout: ReturnType<typeof setTimeout> | null = null
let contentZoomSettleTimeout: ReturnType<typeof setTimeout> | null = null
let contentZoomCommitRaf: number | null = null
let contentZoomCommitIdleCallback: number | null = null
let contentZoomCommitDeadlineTimeout: ReturnType<typeof setTimeout> | null = null
let activeZoomGestureCount = 0

function zoomLevelToPixelsPerSecond(level: number): number {
  return level * 100
}

function clearVisualZoomThrottle() {
  if (visualZoomThrottleTimeout) {
    clearTimeout(visualZoomThrottleTimeout)
    visualZoomThrottleTimeout = null
  }
}

function clearContentZoomSettleTimeout() {
  if (contentZoomSettleTimeout) {
    clearTimeout(contentZoomSettleTimeout)
    contentZoomSettleTimeout = null
  }
  if (contentZoomCommitRaf !== null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(contentZoomCommitRaf)
    }
    contentZoomCommitRaf = null
  }
  if (contentZoomCommitIdleCallback !== null) {
    if (typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(contentZoomCommitIdleCallback)
    }
    contentZoomCommitIdleCallback = null
  }
  if (contentZoomCommitDeadlineTimeout !== null) {
    clearTimeout(contentZoomCommitDeadlineTimeout)
    contentZoomCommitDeadlineTimeout = null
  }
}

function setVisualZoom(
  set: (partial: Partial<ZoomState>) => void,
  level: number,
  isZoomInteracting: boolean,
) {
  set({
    level,
    pixelsPerSecond: zoomLevelToPixelsPerSecond(level),
    isZoomInteracting,
  })
}

function flushPendingVisualZoom(set: (partial: Partial<ZoomState>) => void) {
  if (pendingVisualZoomLevel === null) return

  clearVisualZoomThrottle()
  lastVisualZoomUpdate = performance.now()
  const nextLevel = pendingVisualZoomLevel
  pendingVisualZoomLevel = null
  setVisualZoom(set, nextLevel, true)
}

function commitPendingContentZoom(set: (partial: Partial<ZoomState>) => void) {
  contentZoomCommitRaf = null
  contentZoomCommitIdleCallback = null
  if (contentZoomCommitDeadlineTimeout !== null) {
    clearTimeout(contentZoomCommitDeadlineTimeout)
    contentZoomCommitDeadlineTimeout = null
  }
  if (pendingContentZoomLevel === null) {
    set({ isZoomInteracting: false })
    return
  }

  const settledLevel = pendingContentZoomLevel
  pendingContentZoomLevel = null
  flushPendingVisualZoom(set)
  set({
    level: settledLevel,
    pixelsPerSecond: zoomLevelToPixelsPerSecond(settledLevel),
    contentLevel: settledLevel,
    contentPixelsPerSecond: zoomLevelToPixelsPerSecond(settledLevel),
    isZoomInteracting: false,
  })
}

function schedulePlaybackAwareContentCommit(set: (partial: Partial<ZoomState>) => void) {
  if (
    !usePlaybackStore.getState().isPlaying ||
    typeof requestAnimationFrame !== 'function' ||
    typeof requestIdleCallback !== 'function'
  ) {
    commitPendingContentZoom(set)
    return
  }

  // Let the current preview frame paint first, then use the browser's idle
  // slice for the one expensive committed-geometry update. A new wheel event
  // cancels both callbacks while the lightweight live geometry remains current.
  contentZoomCommitRaf = requestAnimationFrame(() => {
    contentZoomCommitRaf = null
    const commitFromIdle = () => {
      contentZoomCommitIdleCallback = null
      commitPendingContentZoom(set)
    }
    contentZoomCommitIdleCallback = requestIdleCallback(commitFromIdle, {
      timeout: PLAYBACK_CONTENT_ZOOM_COMMIT_DEADLINE_MS,
    })
    // Chrome's idle timeout can still be postponed by a continuously busy
    // playback/render loop. Keep the idle fast path, but back it with a real
    // task deadline so wheel/trackpad settle cannot depend on pausing playback.
    contentZoomCommitDeadlineTimeout = setTimeout(() => {
      contentZoomCommitDeadlineTimeout = null
      if (contentZoomCommitIdleCallback !== null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(contentZoomCommitIdleCallback)
        contentZoomCommitIdleCallback = null
      }
      commitPendingContentZoom(set)
    }, PLAYBACK_CONTENT_ZOOM_COMMIT_DEADLINE_MS)
  })
}

function scheduleContentZoomCommit(set: (partial: Partial<ZoomState>) => void) {
  clearContentZoomSettleTimeout()
  if (activeZoomGestureCount > 0) {
    return
  }
  contentZoomSettleTimeout = setTimeout(() => {
    contentZoomSettleTimeout = null
    schedulePlaybackAwareContentCommit(set)
  }, CONTENT_ZOOM_SETTLE_MS)
}

function stageContentZoomCommit(
  set: (partial: Partial<ZoomState>) => void,
  level: number,
  interactionAlreadyStarted = false,
) {
  pendingContentZoomLevel = level
  if (!interactionAlreadyStarted) {
    set({ isZoomInteracting: true })
  }
  scheduleContentZoomCommit(set)
}

function applySynchronizedZoom(
  set: (partial: Partial<ZoomState> | ((state: ZoomState) => Partial<ZoomState>)) => void,
  level: number,
) {
  pendingVisualZoomLevel = null
  pendingContentZoomLevel = null
  clearVisualZoomThrottle()
  clearContentZoomSettleTimeout()
  lastVisualZoomUpdate = performance.now()
  const pixelsPerSecond = zoomLevelToPixelsPerSecond(level)
  set({
    level,
    pixelsPerSecond,
    contentLevel: level,
    contentPixelsPerSecond: pixelsPerSecond,
    isZoomInteracting: false,
  })
}

export const useZoomStore = create<ZoomState & ZoomActions>((set, get) => ({
  level: 1,
  pixelsPerSecond: 100,
  contentLevel: 1,
  contentPixelsPerSecond: 100,
  isZoomInteracting: false,

  beginZoomGesture: () => {
    activeZoomGestureCount += 1
    clearContentZoomSettleTimeout()
    if (!get().isZoomInteracting) {
      set({ isZoomInteracting: true })
    }
  },
  endZoomGesture: () => {
    if (activeZoomGestureCount > 0) {
      activeZoomGestureCount -= 1
    }
    if (activeZoomGestureCount > 0) {
      return
    }
    if (pendingContentZoomLevel !== null) {
      // Pointer-up is an explicit end boundary, so the wheel-burst debounce is
      // no longer useful. Commit the settled geometry synchronously even during
      // playback: routing this boundary through requestIdleCallback can leave
      // isZoomInteracting and rich-content geometry pending indefinitely while
      // continuous preview frames keep the main thread busy. Dense detail and
      // culling consumers already stage their own mount/unmount work.
      clearContentZoomSettleTimeout()
      commitPendingContentZoom(set)
    } else if (get().isZoomInteracting) {
      set({ isZoomInteracting: false })
    }
  },
  setZoomLevel: (level) => {
    const now = performance.now()
    pendingVisualZoomLevel = level
    stageContentZoomCommit(set, level)

    // If enough time has passed, update immediately
    if (now - lastVisualZoomUpdate >= VISUAL_ZOOM_THROTTLE_MS) {
      lastVisualZoomUpdate = now
      setVisualZoom(set, level, true)
      pendingVisualZoomLevel = null
      return
    }

    // Otherwise, schedule update for next throttle window
    if (!visualZoomThrottleTimeout) {
      visualZoomThrottleTimeout = setTimeout(
        () => {
          visualZoomThrottleTimeout = null
          if (pendingVisualZoomLevel !== null) {
            const nextLevel = pendingVisualZoomLevel
            pendingVisualZoomLevel = null
            lastVisualZoomUpdate = performance.now()
            setVisualZoom(set, nextLevel, true)
          }
        },
        VISUAL_ZOOM_THROTTLE_MS - (now - lastVisualZoomUpdate),
      )
    }
  },

  // Immediate zoom update - bypasses throttle for synchronized scroll calculations
  setZoomLevelImmediate: (level) => {
    clearVisualZoomThrottle()
    pendingVisualZoomLevel = null
    lastVisualZoomUpdate = performance.now()
    setVisualZoom(set, level, true)
    // setVisualZoom already publishes isZoomInteracting=true with the live
    // geometry. Do not publish a second identical interaction-only state.
    stageContentZoomCommit(set, level, true)
  },
  setZoomLevelSynchronized: (level) => {
    applySynchronizedZoom(set, level)
  },
  zoomIn: () => {
    const newLevel = Math.min(get().level * 1.1, 50) // 10% per step for finer control
    applySynchronizedZoom(set, newLevel)
  },
  zoomOut: () => {
    const newLevel = Math.max(get().level / 1.1, 0.01)
    applySynchronizedZoom(set, newLevel)
  },
  zoomToFit: (containerWidth, contentDurationSeconds) => {
    const newLevel = getZoomToFitLevel(containerWidth, contentDurationSeconds)
    applySynchronizedZoom(set, newLevel)
  },
}))

// Keep direct `useZoomStore.setState(...)` calls (including focused tests and
// restore paths) synchronized without adding more than one live subscriber.
useZoomStore.subscribe((state, previousState) => {
  if (
    state.contentLevel === previousState.contentLevel &&
    state.contentPixelsPerSecond === previousState.contentPixelsPerSecond
  ) {
    return
  }
  useSettledZoomStore.setState({
    contentLevel: state.contentLevel,
    contentPixelsPerSecond: state.contentPixelsPerSecond,
  })
})

// Non-reactive handler registration — avoids unnecessary subscriber notifications
let _zoomTo100Handler: ((centerFrame: number) => void) | null = null

export function registerZoomTo100(handler: ((centerFrame: number) => void) | null) {
  _zoomTo100Handler = handler
}

export function getZoomTo100Handler() {
  return _zoomTo100Handler
}

export function _resetZoomStoreForTest() {
  clearVisualZoomThrottle()
  clearContentZoomSettleTimeout()
  pendingVisualZoomLevel = null
  pendingContentZoomLevel = null
  activeZoomGestureCount = 0
  lastVisualZoomUpdate = 0
  useZoomStore.setState({
    level: 1,
    pixelsPerSecond: 100,
    contentLevel: 1,
    contentPixelsPerSecond: 100,
    isZoomInteracting: false,
  })
}
