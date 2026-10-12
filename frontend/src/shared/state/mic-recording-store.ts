import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AudioInputDevice } from '@/infrastructure/audio/mic-recorder'

/**
 * UI-facing state for the timeline microphone-voiceover recorder.
 *
 * The heavy lifting (mic acquisition, MediaRecorder, timeline commit) lives in
 * the recording controller; this store only holds render state so toolbar
 * controls, the level meter, and the timeline overlay can subscribe to exactly
 * what they need. Only `selectedDeviceId` is persisted.
 *
 * Lifecycle: `idle → requesting → recording ⇄ paused → finalizing → idle`.
 * `requesting` covers the `getUserMedia` permission prompt; `finalizing` covers
 * the OPFS write + timeline placement after Stop.
 */
export type MicRecordingStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finalizing'

interface MicRecordingState {
  status: MicRecordingStatus
  /** Elapsed recorded time in ms (excludes paused spans). */
  elapsedMs: number
  /** Current input level, RMS 0..1. */
  level: number
  devices: AudioInputDevice[]
  /** Persisted preferred device; may be stale — controller falls back to default. */
  selectedDeviceId: string | null
  /** Playhead frame captured when recording started (the clip's start frame). */
  recordStartFrame: number
  /** User-facing error message from the last failed attempt, if any. */
  error: string | null

  // --- Persisted capture preferences ---
  /** Suppress steady background noise (browser DSP). On by default. */
  noiseSuppression: boolean
  /** Auto-level the input. On by default — keeps narration at a consistent level. */
  autoGainControl: boolean
  /**
   * Mute the timeline monitor mix while recording. On by default so speaker
   * audio doesn't bleed into the mic; headphone users can turn it off.
   */
  muteWhileRecording: boolean
  /**
   * Manual input-latency compensation in ms, applied to the committed clip's
   * start frame. Positive = shift the take later. Default 0.
   */
  syncOffsetMs: number

  setStatus: (status: MicRecordingStatus) => void
  setElapsedMs: (elapsedMs: number) => void
  setLevel: (level: number) => void
  setDevices: (devices: AudioInputDevice[]) => void
  setSelectedDeviceId: (deviceId: string | null) => void
  setRecordStartFrame: (frame: number) => void
  setError: (error: string | null) => void
  setNoiseSuppression: (value: boolean) => void
  setAutoGainControl: (value: boolean) => void
  setMuteWhileRecording: (value: boolean) => void
  setSyncOffsetMs: (value: number) => void
  /** Return to idle, clearing transient recording state (keeps device prefs). */
  reset: () => void
}

export const useMicRecordingStore = create<MicRecordingState>()(
  persist(
    (set) => ({
      status: 'idle',
      elapsedMs: 0,
      level: 0,
      devices: [],
      selectedDeviceId: null,
      recordStartFrame: 0,
      error: null,
      noiseSuppression: true,
      autoGainControl: true,
      muteWhileRecording: true,
      syncOffsetMs: 0,

      setStatus: (status) => set({ status }),
      setElapsedMs: (elapsedMs) => set({ elapsedMs }),
      setLevel: (level) => set({ level }),
      setDevices: (devices) => set({ devices }),
      setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
      setRecordStartFrame: (recordStartFrame) => set({ recordStartFrame }),
      setError: (error) => set({ error }),
      setNoiseSuppression: (noiseSuppression) => set({ noiseSuppression }),
      setAutoGainControl: (autoGainControl) => set({ autoGainControl }),
      setMuteWhileRecording: (muteWhileRecording) => set({ muteWhileRecording }),
      setSyncOffsetMs: (syncOffsetMs) =>
        set({ syncOffsetMs: Math.max(-1000, Math.min(1000, Math.round(syncOffsetMs))) }),
      reset: () =>
        set({ status: 'idle', elapsedMs: 0, level: 0, recordStartFrame: 0, error: null }),
    }),
    {
      name: 'freecut-mic-recording',
      partialize: (state) => ({
        selectedDeviceId: state.selectedDeviceId,
        noiseSuppression: state.noiseSuppression,
        autoGainControl: state.autoGainControl,
        muteWhileRecording: state.muteWhileRecording,
        syncOffsetMs: state.syncOffsetMs,
      }),
    },
  ),
)

/** True when recording is actively capturing or paused (a session is open). */
export function isMicRecordingActive(status: MicRecordingStatus): boolean {
  return status === 'recording' || status === 'paused'
}
