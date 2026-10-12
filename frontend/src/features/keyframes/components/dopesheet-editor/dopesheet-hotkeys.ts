import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { DopesheetPropertyRow } from './dopesheet-types'

/** User-configurable bindings for high-frequency keyframe actions. */
export interface DopesheetShortcutMap {
  addKeyframe: string
  previousKeyframe: string
  nextKeyframe: string
  toggleAutoKey: string
  fitKeyframes: string
}

export interface DopesheetHotkeyState {
  shortcutsEnabled: boolean
  addKeyframeShortcutEnabled: boolean
  disabled: boolean
  shortcuts?: DopesheetShortcutMap | undefined
  hasActivePropertyRow: boolean
  hasSelection: boolean
  canCommitValues: boolean
}

export interface DopesheetHotkeyBindings {
  keys: {
    add: string
    prev: string
    next: string
    toggleAutoKey: string
    fit: string
  }
  enabled: {
    add: boolean
    prev: boolean
    next: boolean
    toggleAutoKey: boolean
    fit: boolean
    edit: boolean
  }
}

/** Resolves key strings for every dopesheet shortcut. */
function resolveDopesheetHotkeyKeys(
  shortcuts: DopesheetShortcutMap | undefined,
): DopesheetHotkeyBindings['keys'] {
  return {
    add: shortcuts?.addKeyframe ?? '',
    prev: shortcuts?.previousKeyframe ?? '',
    next: shortcuts?.nextKeyframe ?? '',
    toggleAutoKey: shortcuts?.toggleAutoKey ?? '',
    fit: shortcuts?.fitKeyframes ?? '',
  }
}

/**
 * Shared enablement shape for every shortcut: master switch on, editor
 * enabled, binding present, and the editing context ready.
 */
function isBindingEnabled(
  masterEnabled: boolean,
  disabled: boolean,
  key: string | undefined,
  contextReady: boolean,
): boolean {
  return masterEnabled && !disabled && Boolean(key && contextReady)
}

/** Resolves enablement for every dopesheet shortcut. */
function resolveDopesheetHotkeyEnabled(
  state: DopesheetHotkeyState,
): DopesheetHotkeyBindings['enabled'] {
  const {
    shortcutsEnabled,
    addKeyframeShortcutEnabled,
    disabled,
    shortcuts,
    hasActivePropertyRow,
    hasSelection,
    canCommitValues,
  } = state
  return {
    add: isBindingEnabled(
      shortcutsEnabled || addKeyframeShortcutEnabled,
      disabled,
      shortcuts?.addKeyframe,
      hasActivePropertyRow,
    ),
    prev: isBindingEnabled(
      shortcutsEnabled,
      disabled,
      shortcuts?.previousKeyframe,
      hasActivePropertyRow,
    ),
    next: isBindingEnabled(
      shortcutsEnabled,
      disabled,
      shortcuts?.nextKeyframe,
      hasActivePropertyRow,
    ),
    toggleAutoKey: isBindingEnabled(
      shortcutsEnabled,
      disabled,
      shortcuts?.toggleAutoKey,
      hasActivePropertyRow && canCommitValues,
    ),
    fit: isBindingEnabled(shortcutsEnabled, disabled, shortcuts?.fitKeyframes, true),
    edit: !disabled && hasSelection,
  }
}

/** Resolves key strings and enablement for every dopesheet shortcut. */
export function resolveDopesheetHotkeys(state: DopesheetHotkeyState): DopesheetHotkeyBindings {
  return {
    keys: resolveDopesheetHotkeyKeys(state.shortcuts),
    enabled: resolveDopesheetHotkeyEnabled(state),
  }
}

export function handleAddKeyframeHotkey(
  event: KeyboardEvent,
  activePropertyRow: DopesheetPropertyRow | undefined,
  onAddKeyframe: (property: AnimatableProperty, keyframes: Keyframe[]) => void,
): void {
  event.preventDefault()
  if (activePropertyRow) {
    onAddKeyframe(activePropertyRow.property, activePropertyRow.controls.currentKeyframes)
  }
}

export function handleNavigateHotkey(
  event: KeyboardEvent,
  activePropertyRow: DopesheetPropertyRow | undefined,
  keyframe: Keyframe | null,
  onNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void,
): void {
  event.preventDefault()
  if (activePropertyRow) {
    onNavigate(activePropertyRow.property, keyframe)
  }
}

export function handleToggleAutoKeyHotkey(
  event: KeyboardEvent,
  activePropertyRow: DopesheetPropertyRow | undefined,
  onToggleAutoKey: (property: AnimatableProperty) => void,
): void {
  event.preventDefault()
  if (activePropertyRow) {
    onToggleAutoKey(activePropertyRow.property)
  }
}

export function handleFitKeyframesHotkey(event: KeyboardEvent, onFit: () => void): void {
  event.preventDefault()
  onFit()
}

export function handleDeleteHotkey(
  event: KeyboardEvent,
  selectedRefs: KeyframeRef[],
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void,
): void {
  event.preventDefault()
  if (selectedRefs.length > 0) {
    onRemoveKeyframes?.(selectedRefs)
  }
}

export function handleNudgeHotkey(
  event: KeyboardEvent,
  deltaFrames: number,
  onNudge: (deltaFrames: number) => void,
): void {
  event.preventDefault()
  onNudge(deltaFrames)
}
