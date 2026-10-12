/**
 * Header frame input hook.
 * Owns the local/global frame input state, the commit planners, and the
 * Enter/Escape key handler. Re-syncs input values when the selection or
 * frame offset changes; commits navigate the selected keyframes by a
 * delta computed from the input value.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BlockedFrameRange } from '../../utils/transition-region'
import {
  getCommittedHeaderFrameValues,
  planGlobalHeaderFrameCommit,
  planLocalHeaderFrameCommit,
} from './header-frame-input-actions'

interface SelectedFrameSummary {
  hasSelection: boolean
  hasMixedFrames: boolean
  localFrame: number | null
  globalFrame: number | null
}

type MoveResult = { didMove: boolean; appliedDeltaFrames: number }

interface UseHeaderFrameInputsOptions {
  selectedFrameSummary: SelectedFrameSummary
  currentFrame: number
  globalFrame: number | null
  totalFrames: number
  transitionBlockedRanges: BlockedFrameRange[]
  onKeyframeMove?: unknown
  onNavigateToKeyframe?: (frame: number) => void
  moveSelectedKeyframesByDelta: (deltaFrames: number) => MoveResult
}

export interface UseHeaderFrameInputsReturn {
  localFrameInputValue: string
  globalFrameInputValue: string
  setLocalFrameInputValue: React.Dispatch<React.SetStateAction<string>>
  setGlobalFrameInputValue: React.Dispatch<React.SetStateAction<string>>
  skipNextHeaderFrameBlurRef: React.RefObject<'local' | 'global' | null>
  resetHeaderFrameInputs: () => void
  commitLocalFrameInput: () => void
  commitGlobalFrameInput: () => void
  handleHeaderFrameInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    input: 'local' | 'global',
    commit: () => void,
  ) => void
}

export function useHeaderFrameInputs({
  selectedFrameSummary,
  currentFrame,
  globalFrame,
  totalFrames,
  transitionBlockedRanges,
  onKeyframeMove,
  onNavigateToKeyframe,
  moveSelectedKeyframesByDelta,
}: UseHeaderFrameInputsOptions): UseHeaderFrameInputsReturn {
  const [localFrameInputValue, setLocalFrameInputValue] = useState('')
  const [globalFrameInputValue, setGlobalFrameInputValue] = useState('')
  const skipNextHeaderFrameBlurRef = useRef<'local' | 'global' | null>(null)

  // Keep inputs in sync with the current selection
  useEffect(() => {
    setLocalFrameInputValue(
      selectedFrameSummary.localFrame === null ? '' : String(selectedFrameSummary.localFrame),
    )
    setGlobalFrameInputValue(
      selectedFrameSummary.globalFrame === null ? '' : String(selectedFrameSummary.globalFrame),
    )
  }, [selectedFrameSummary.globalFrame, selectedFrameSummary.localFrame])

  const resetHeaderFrameInputs = useCallback(() => {
    setLocalFrameInputValue(
      selectedFrameSummary.localFrame === null ? '' : String(selectedFrameSummary.localFrame),
    )
    setGlobalFrameInputValue(
      selectedFrameSummary.globalFrame === null ? '' : String(selectedFrameSummary.globalFrame),
    )
  }, [selectedFrameSummary.globalFrame, selectedFrameSummary.localFrame])

  const commitLocalFrameInput = useCallback(() => {
    if (!onKeyframeMove) {
      resetHeaderFrameInputs()
      return
    }

    const plan = planLocalHeaderFrameCommit({
      inputValue: localFrameInputValue,
      selectedFrameSummary,
      totalFrames,
      transitionBlockedRanges,
    })
    if (!plan) {
      resetHeaderFrameInputs()
      return
    }

    const moveResult = moveSelectedKeyframesByDelta(plan.targetLocalFrame - plan.initialLocalFrame)
    const committedValues = getCommittedHeaderFrameValues(plan, moveResult)

    setLocalFrameInputValue(committedValues.localInputValue)
    if (committedValues.globalInputValue !== null) {
      setGlobalFrameInputValue(committedValues.globalInputValue)
    }

    if (!moveResult.didMove) {
      return
    }

    onNavigateToKeyframe?.(committedValues.finalLocalFrame)
  }, [
    localFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary,
    totalFrames,
    transitionBlockedRanges,
  ])

  const commitGlobalFrameInput = useCallback(() => {
    if (!onKeyframeMove) {
      resetHeaderFrameInputs()
      return
    }

    const plan = planGlobalHeaderFrameCommit({
      inputValue: globalFrameInputValue,
      selectedFrameSummary,
      currentFrame,
      globalFrame,
      totalFrames,
      transitionBlockedRanges,
    })
    if (!plan) {
      resetHeaderFrameInputs()
      return
    }

    const moveResult = moveSelectedKeyframesByDelta(plan.targetLocalFrame - plan.initialLocalFrame)
    const committedValues = getCommittedHeaderFrameValues(plan, moveResult)

    setLocalFrameInputValue(committedValues.localInputValue)
    if (committedValues.globalInputValue !== null) {
      setGlobalFrameInputValue(committedValues.globalInputValue)
    }

    if (!moveResult.didMove) {
      return
    }

    onNavigateToKeyframe?.(committedValues.finalLocalFrame)
  }, [
    currentFrame,
    globalFrame,
    globalFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary,
    totalFrames,
    transitionBlockedRanges,
  ])

  const handleHeaderFrameInputKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      input: 'local' | 'global',
      commit: () => void,
    ) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        skipNextHeaderFrameBlurRef.current = input
        event.currentTarget.blur()
        commit()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        resetHeaderFrameInputs()
        skipNextHeaderFrameBlurRef.current = input
        event.currentTarget.blur()
      }
    },
    [resetHeaderFrameInputs],
  )

  return {
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    resetHeaderFrameInputs,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  }
}
