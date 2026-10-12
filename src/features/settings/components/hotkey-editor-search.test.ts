// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { HOTKEYS, formatHotkeyBinding } from '@/config/hotkeys'
import {
  HOTKEY_EDITOR_SECTIONS,
  getHotkeyBindingDisplayLabel,
  getHotkeyEditorSearchResults,
} from './hotkey-editor-sections'

describe('getHotkeyEditorSearchResults', () => {
  it('filters commands by localized label', () => {
    const results = getHotkeyEditorSearchResults({
      query: 'ripple',
      sections: HOTKEY_EDITOR_SECTIONS,
      hotkeys: HOTKEYS,
      translate: (key) =>
        key.endsWith('rippleDeleteSelectedItems') ? 'Ripple delete selected items' : key,
    })

    expect(results.map((result) => result.item.labelKey)).toEqual([
      'projects.settings.hotkeys.items.rippleDeleteSelectedItems',
    ])
  })

  it('filters commands by current shortcut binding', () => {
    const results = getHotkeyEditorSearchResults({
      query: 'mod+shift+e',
      sections: HOTKEY_EDITOR_SECTIONS,
      hotkeys: HOTKEYS,
      translate: (key) => (key.endsWith('exportVideo') ? 'Export video' : key),
    })

    expect(results.map((result) => result.item.labelKey)).toEqual([
      'projects.settings.hotkeys.items.exportVideo',
    ])
  })
})

describe('getHotkeyBindingDisplayLabel', () => {
  it('shows an explicit unassigned label for blank bindings', () => {
    expect(getHotkeyBindingDisplayLabel('', 'Unassigned')).toBe('Unassigned')
  })

  it('formats non-empty bindings for the host platform', () => {
    // Platform detection reads the host, so pin it per platform explicitly —
    // the implicit form must match one of the two (macOS CI vs Linux CI).
    expect(formatHotkeyBinding('mod+shift+e', 'Win32')).toBe('Ctrl + Shift + E')
    expect(formatHotkeyBinding('mod+shift+e', 'MacIntel')).toBe('Cmd + Shift + E')
    expect(['Ctrl + Shift + E', 'Cmd + Shift + E']).toContain(
      getHotkeyBindingDisplayLabel('mod+shift+e', 'Unassigned'),
    )
  })
})
