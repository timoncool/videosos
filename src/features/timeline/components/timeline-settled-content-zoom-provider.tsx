import { startTransition, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { SettledContentPixelsPerSecondContext } from '../contexts/timeline-zoom-context'
import { useZoomStore } from '../stores/zoom-store'

interface SettledContentZoomBridge {
  generation: number
  pixelsPerSecond: number
}

/**
 * Bridges the synchronous external zoom store into a concurrent React update.
 *
 * Rich clip content can take tens of milliseconds to reconcile across a dense
 * split timeline. Keeping that work behind one transition lets React yield to
 * input while preserving an atomic commit, so filmstrips and waveforms do not
 * progressively pop clip-by-clip.
 */
export function TimelineSettledContentZoomProvider({ children }: { children: ReactNode }) {
  const initialPixelsPerSecondRef = useRef(useZoomStore.getState().contentPixelsPerSecond)
  const initialPixelsPerSecond = initialPixelsPerSecondRef.current
  const interactionGenerationRef = useRef(0)
  const committedBridgeRef = useRef<SettledContentZoomBridge>({
    generation: 0,
    pixelsPerSecond: initialPixelsPerSecond,
  })
  const pendingBridgeRef = useRef<SettledContentZoomBridge | null>(null)
  const [bridge, setBridge] = useState(committedBridgeRef.current)

  useLayoutEffect(() => {
    if (pendingBridgeRef.current === bridge) {
      pendingBridgeRef.current = null
    }
    if (bridge.generation === interactionGenerationRef.current) {
      committedBridgeRef.current = bridge
    }
  }, [bridge])

  useLayoutEffect(() => {
    const publishZoomState = (
      state: ReturnType<typeof useZoomStore.getState>,
      previousState: ReturnType<typeof useZoomStore.getState>,
    ) => {
      if (state.isZoomInteracting && !previousState.isZoomInteracting) {
        // Most gestures begin from a fully committed bridge. In that common
        // case there is no obsolete concurrent render to invalidate, so avoid
        // a same-value state update across the entire rich-content subtree.
        if (pendingBridgeRef.current === null) {
          return
        }

        const generation = interactionGenerationRef.current + 1
        interactionGenerationRef.current = generation
        const stableBridge: SettledContentZoomBridge = {
          generation,
          pixelsPerSecond: committedBridgeRef.current.pixelsPerSecond,
        }
        pendingBridgeRef.current = null
        committedBridgeRef.current = stableBridge
        // This urgent no-value-change update invalidates any older transition.
        // If its render later resumes, the generation check below keeps the
        // currently painted geometry in context throughout the new gesture.
        setBridge(stableBridge)
        return
      }

      if (state.contentPixelsPerSecond === previousState.contentPixelsPerSecond) {
        return
      }

      const generation = interactionGenerationRef.current
      const nextBridge: SettledContentZoomBridge = {
        generation,
        pixelsPerSecond: state.contentPixelsPerSecond,
      }
      pendingBridgeRef.current = nextBridge
      startTransition(() => {
        setBridge(nextBridge)
      })
    }

    const unsubscribe = useZoomStore.subscribe(publishZoomState)
    const currentState = useZoomStore.getState()
    if (currentState.contentPixelsPerSecond !== initialPixelsPerSecond) {
      publishZoomState(currentState, {
        ...currentState,
        contentPixelsPerSecond: initialPixelsPerSecond,
      })
    }
    return unsubscribe
  }, [initialPixelsPerSecond])

  const pixelsPerSecond =
    bridge.generation === interactionGenerationRef.current
      ? bridge.pixelsPerSecond
      : committedBridgeRef.current.pixelsPerSecond

  return (
    <SettledContentPixelsPerSecondContext.Provider value={pixelsPerSecond}>
      {children}
    </SettledContentPixelsPerSecondContext.Provider>
  )
}
