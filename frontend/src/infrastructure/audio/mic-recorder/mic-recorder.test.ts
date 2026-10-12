import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test'
import {
  MicRecorder,
  pickRecorderMimeType,
  extensionForMimeType,
  buildAudioConstraints,
} from './mic-recorder'

type Listener = (event: unknown) => void

class MockMediaRecorder {
  static isTypeSupported: (type: string) => boolean = () => true
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  private listeners: Record<string, Listener[]> = {}

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? ''
  }

  addEventListener(type: string, cb: Listener) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== cb)
  }
  private emit(type: string, event: unknown = {}) {
    for (const cb of this.listeners[type] ?? []) cb(event)
  }

  start() {
    this.state = 'recording'
    queueMicrotask(() => this.emit('start'))
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.emit('dataavailable', { data: new Blob(['chunk']) })
      this.emit('stop')
    })
  }
}

describe('pickRecorderMimeType', () => {
  const original = globalThis.MediaRecorder

  afterEach(() => {
    globalThis.MediaRecorder = original
  })

  it('prefers the first supported candidate', () => {
    MockMediaRecorder.isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus')
    globalThis.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder
    expect(pickRecorderMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('falls through to a later candidate when earlier ones are unsupported', () => {
    MockMediaRecorder.isTypeSupported = vi.fn((type: string) => type === 'audio/mp4')
    globalThis.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder
    expect(pickRecorderMimeType()).toBe('audio/mp4')
  })

  it('returns empty string when nothing is supported', () => {
    MockMediaRecorder.isTypeSupported = vi.fn(() => false)
    globalThis.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder
    expect(pickRecorderMimeType()).toBe('')
  })
})

describe('buildAudioConstraints', () => {
  it('defaults to narration-friendly processing (NS on, AGC off) and no forced device', () => {
    const constraints = buildAudioConstraints({})
    expect(constraints.echoCancellation).toBe(true)
    expect(constraints.noiseSuppression).toBe(true)
    expect(constraints.autoGainControl).toBe(false)
    expect(constraints.deviceId).toBeUndefined()
  })

  it('pins an exact device and honors explicit processing flags', () => {
    const constraints = buildAudioConstraints({
      deviceId: 'mic-1',
      noiseSuppression: false,
      autoGainControl: true,
    })
    expect(constraints.deviceId).toEqual({ exact: 'mic-1' })
    expect(constraints.noiseSuppression).toBe(false)
    expect(constraints.autoGainControl).toBe(true)
  })
})

describe('extensionForMimeType', () => {
  it('maps containers to sensible extensions', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionForMimeType('audio/webm')).toBe('webm')
    expect(extensionForMimeType('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionForMimeType('audio/mp4')).toBe('m4a')
    expect(extensionForMimeType('')).toBe('webm')
  })
})

describe('MicRecorder duration accounting', () => {
  const originalRecorder = globalThis.MediaRecorder
  let nowMs = 0

  beforeEach(() => {
    nowMs = 0
    MockMediaRecorder.isTypeSupported = vi.fn(() => true)
    globalThis.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown),
      },
    })
  })

  afterEach(() => {
    globalThis.MediaRecorder = originalRecorder
    vi.restoreAllMocks()
  })

  it('excludes paused spans from the recorded duration', async () => {
    const recorder = new MicRecorder()

    nowMs = 1000
    await recorder.start()
    expect(recorder.getState()).toBe('recording')

    // 500ms of active recording.
    nowMs = 1500
    expect(recorder.elapsedMs()).toBe(500)

    recorder.pause()
    // 1500ms parked while paused must not count.
    nowMs = 3000
    expect(recorder.elapsedMs()).toBe(500)

    recorder.resume()
    // Another 200ms of active recording after resume.
    nowMs = 3200
    expect(recorder.elapsedMs()).toBe(700)

    const result = await recorder.stop()
    expect(result.durationMs).toBe(700)
    expect(result.blob.size).toBeGreaterThan(0)
    expect(recorder.getState()).toBe('idle')
  })
})
