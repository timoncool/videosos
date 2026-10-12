import { createElement } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { HotkeyEditor } from './hotkey-editor'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSettingsStore } from '../stores/settings-store'

let container: HTMLDivElement
let root: Root

function setCustomHotkeyOverride() {
  useSettingsStore.setState({ hotkeyOverrides: { PLAY_PAUSE: 'shift+k' } })
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function keyDown(key: string, code: string = key) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
}

function changeInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
}

function getButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  )

  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

async function waitForText(text: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = [...document.querySelectorAll('body *')].find(
      (candidate) => candidate.textContent?.trim() === text,
    )

    if (element instanceof HTMLElement) {
      return element
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Text not found: ${text}`)
}

async function waitForBodyText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (document.body.textContent?.includes(text)) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Body text not found: ${text}`)
}

describe('HotkeyEditor reset all confirmation', () => {
  beforeEach(async () => {
    setCustomHotkeyOverride()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DialogPrimitive.Root, { open: true }, createElement(HotkeyEditor)),
      ),
    )
    await waitForText('Reset All')
  })

  afterEach(() => {
    root.unmount()
    container.remove()
    useSettingsStore.setState({ hotkeyOverrides: {} })
  })

  it('does not reset custom shortcuts until the destructive reset is confirmed', async () => {
    click(getButton('Reset All'))

    await waitForText('Reset all shortcuts?')
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ PLAY_PAUSE: 'shift+k' })

    click(getButton('Cancel'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body.textContent).not.toContain('Reset all shortcuts?')
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ PLAY_PAUSE: 'shift+k' })

    click(getButton('Reset All'))
    await waitForText('Reset all shortcuts?')
    click(getButton('Reset all'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({})
  })

  it('overwrites the shown conflicting shortcut by unbinding that action', async () => {
    click(getButton('Record'))
    await waitForText('Listening')
    keyDown('ArrowRight', 'ArrowRight')

    await waitForBodyText('Conflicts with Next frame')
    click(getButton('Overwrite'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      NEXT_FRAME: '',
      PLAY_PAUSE: 'right',
    })
  })

  it('restores partial conflict overwrites when capture is cancelled', async () => {
    useSettingsStore.setState({
      hotkeyOverrides: {
        PLAY_PAUSE: 'shift+k',
        PREVIOUS_FRAME: 'right',
      },
    })

    click(getButton('Record'))
    await waitForText('Listening')
    keyDown('ArrowRight', 'ArrowRight')

    await waitForBodyText('Conflicts with Previous frame')
    await waitForBodyText('Conflicts with Next frame')
    click(getButton('Overwrite'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useSettingsStore.getState().hotkeyOverrides).not.toEqual({
      PLAY_PAUSE: 'shift+k',
      PREVIOUS_FRAME: 'right',
    })

    keyDown('Escape', 'Escape')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      PLAY_PAUSE: 'shift+k',
      PREVIOUS_FRAME: 'right',
    })
  })

  it('keeps unbind explicit and disables it once the selected command is unassigned', async () => {
    click(getButton('Unbind'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ PLAY_PAUSE: '' })
    expect(getButton('Unbind').disabled).toBe(true)
    await waitForText('Unassigned')
  })

  it('shows a localized search result count while filtering shortcuts', async () => {
    const searchInput = document.querySelector(
      'input[placeholder="Search commands or shortcuts"]',
    ) as HTMLInputElement | null

    expect(searchInput).toBeTruthy()
    changeInput(searchInput!, 'export')

    await waitForText('1 result')
  })
})
