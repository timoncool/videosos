// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import {
  handleAddKeyframeHotkey,
  handleDeleteHotkey,
  handleNavigateHotkey,
  handleNudgeHotkey,
  resolveDopesheetHotkeys,
  type DopesheetHotkeyState,
} from './dopesheet-hotkeys'

const shortcuts = {
  addKeyframe: 'a',
  previousKeyframe: 'p',
  nextKeyframe: 'n',
  toggleAutoKey: 'k',
  fitKeyframes: 'f',
}

const baseState: DopesheetHotkeyState = {
  shortcutsEnabled: true,
  addKeyframeShortcutEnabled: false,
  disabled: false,
  shortcuts,
  hasActivePropertyRow: true,
  hasSelection: true,
  canCommitValues: true,
}

function keyboardEvent(): KeyboardEvent {
  return { preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('resolveDopesheetHotkeys', () => {
  it('enables every binding when everything is available', () => {
    const bindings = resolveDopesheetHotkeys(baseState)
    expect(bindings.keys).toEqual({ add: 'a', prev: 'p', next: 'n', toggleAutoKey: 'k', fit: 'f' })
    expect(Object.values(bindings.enabled)).toEqual([true, true, true, true, true, true])
  })

  it('falls back to empty key strings without a shortcut map', () => {
    const bindings = resolveDopesheetHotkeys({ ...baseState, shortcuts: undefined })
    expect(bindings.keys.add).toBe('')
    expect(bindings.enabled.add).toBe(false)
  })

  it('disables everything when the editor is disabled', () => {
    const bindings = resolveDopesheetHotkeys({ ...baseState, disabled: true })
    expect(Object.values(bindings.enabled).every((enabled) => !enabled)).toBe(true)
  })

  it('keeps add enabled via the dock shortcut without row selection', () => {
    const bindings = resolveDopesheetHotkeys({
      ...baseState,
      shortcutsEnabled: false,
      addKeyframeShortcutEnabled: true,
      hasActivePropertyRow: false,
    })
    expect(bindings.enabled.add).toBe(false)
    expect(
      resolveDopesheetHotkeys({
        ...baseState,
        shortcutsEnabled: false,
        addKeyframeShortcutEnabled: true,
        hasActivePropertyRow: true,
      }).enabled.add,
    ).toBe(true)
  })

  it('gates toggle-auto-key on value commit availability', () => {
    expect(
      resolveDopesheetHotkeys({ ...baseState, canCommitValues: false }).enabled.toggleAutoKey,
    ).toBe(false)
  })

  it('gates edit shortcuts on selection', () => {
    expect(resolveDopesheetHotkeys({ ...baseState, hasSelection: false }).enabled.edit).toBe(false)
  })
})

describe('dopesheet hotkey handlers', () => {
  const row = {
    property: 'x' as AnimatableProperty,
    keyframes: [],
    controls: { currentKeyframes: [{ id: 'kf-1' } as Keyframe] },
  }

  it('adds a keyframe on the active row', () => {
    const onAdd = vi.fn()
    handleAddKeyframeHotkey(keyboardEvent(), row as never, onAdd)
    expect(onAdd).toHaveBeenCalledWith('x', [{ id: 'kf-1' }])
  })

  it('ignores add without an active row', () => {
    const onAdd = vi.fn()
    handleAddKeyframeHotkey(keyboardEvent(), undefined, onAdd)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('navigates with the provided keyframe', () => {
    const onNavigate = vi.fn()
    const keyframe = { id: 'kf-9' } as Keyframe
    handleNavigateHotkey(keyboardEvent(), row as never, keyframe, onNavigate)
    expect(onNavigate).toHaveBeenCalledWith('x', keyframe)
  })

  it('deletes only with a non-empty selection', () => {
    const onRemove = vi.fn()
    handleDeleteHotkey(keyboardEvent(), [], onRemove)
    expect(onRemove).not.toHaveBeenCalled()
    handleDeleteHotkey(
      keyboardEvent(),
      [{ itemId: 'item-1', property: 'x', keyframeId: 'kf-1' }],
      onRemove,
    )
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('nudges by the given delta', () => {
    const onNudge = vi.fn()
    handleNudgeHotkey(keyboardEvent(), -10, onNudge)
    expect(onNudge).toHaveBeenCalledWith(-10)
  })
})
