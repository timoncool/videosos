/**
 * Timeline in/out shortcuts: I, O, Shift+I/O, Alt+X.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { usePlaybackStore } from '@/shared/state/playback'
import { clearInOutPoints, setInPoint, setOutPoint } from '../../stores/timeline-actions'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'

function addShiftModifier(binding: string): string {
  const parts = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.some((part) => part.toLowerCase() === 'shift')) {
    return binding
  }

  const key = parts.pop()
  if (!key) return `shift+${binding}`
  return [...parts, 'shift', key].join('+')
}

export function useInOutShortcuts() {
  const hotkeys = useResolvedHotkeys()
  const markInAtPreview = addShiftModifier(hotkeys.MARK_IN)
  const markOutAtPreview = addShiftModifier(hotkeys.MARK_OUT)

  useHotkeys(
    hotkeys.MARK_IN,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      setInPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markInAtPreview,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      setInPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markInAtPreview],
  )

  useHotkeys(
    hotkeys.MARK_OUT,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      setOutPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markOutAtPreview,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      setOutPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markOutAtPreview],
  )

  useHotkeys(
    hotkeys.CLEAR_IN_OUT,
    (event) => {
      event.preventDefault()
      clearInOutPoints()
    },
    HOTKEY_OPTIONS,
    [],
  )
}
