import { describe, expect, it, vi } from 'vite-plus/test'
import { shouldYieldToPendingPreviewInput } from './preview-input-yield'

describe('shouldYieldToPendingPreviewInput', () => {
  it('does not yield when playback is paused', () => {
    const isInputPending = vi.fn(() => true)

    expect(shouldYieldToPendingPreviewInput(false, { isInputPending })).toBe(false)
    expect(isInputPending).not.toHaveBeenCalled()
  })

  it('does not yield when the browser has no pending input', () => {
    expect(
      shouldYieldToPendingPreviewInput(true, {
        isInputPending: () => false,
      }),
    ).toBe(false)
  })

  it('includes continuous input when checking an active playback loop', () => {
    const isInputPending = vi.fn(() => true)

    expect(shouldYieldToPendingPreviewInput(true, { isInputPending })).toBe(true)
    expect(isInputPending).toHaveBeenCalledWith({ includeContinuous: true })
  })
})
