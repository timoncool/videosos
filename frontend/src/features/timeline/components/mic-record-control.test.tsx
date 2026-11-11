import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

const controller = vi.hoisted(() => ({
  startMicRecording: vi.fn(async () => {}),
  stopMicRecording: vi.fn(async () => {}),
  pauseMicRecording: vi.fn(),
  resumeMicRecording: vi.fn(),
  cancelMicRecording: vi.fn(),
  refreshMicDevices: vi.fn(async () => {}),
  startMicMonitor: vi.fn(async () => {}),
  stopMicMonitor: vi.fn(),
  cancelPendingMicRecording: vi.fn(),
  isMicRecordingSupported: () => true,
}))

vi.mock('../services/mic-recording-controller', () => controller)

import { MicRecordControl } from './mic-record-control'

describe('the record button', () => {
  it('turns the microphone on only for the person', () => {
    render(<MicRecordControl />)
    const record = screen.getByRole('button', { name: 'Record voiceover' })
    const picker = screen.getByRole('button', { name: 'Microphone settings' })
    expect(record.hasAttribute('data-person-only')).toBe(true)
    expect(picker.hasAttribute('data-person-only')).toBe(true)

    // events a page makes itself are not trusted, as an agent's are
    fireEvent.click(record)
    fireEvent.pointerDown(picker, { button: 0 })
    fireEvent.keyDown(picker, { key: 'Enter' })

    expect(controller.startMicRecording).not.toHaveBeenCalled()
    expect(controller.startMicMonitor).not.toHaveBeenCalled()
  })
})
