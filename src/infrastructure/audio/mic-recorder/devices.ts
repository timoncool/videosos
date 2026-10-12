/**
 * Microphone device enumeration for the timeline voiceover recorder.
 *
 * Device labels are only populated after the page has been granted microphone
 * permission at least once (a privacy measure in every browser). Before the
 * first `getUserMedia` grant, `enumerateDevices` still lists the inputs but
 * with empty labels — callers fall back to a generic "Microphone N" name.
 */

export interface AudioInputDevice {
  deviceId: string
  label: string
}

function hasMediaDevices(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.enumerateDevices === 'function'
  )
}

/** True when this browser exposes microphone capture at all. */
export function hasMicRecordingSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * List available audio input devices. Returns an empty array when the platform
 * has no media-devices API (SSR / unsupported browser). Devices whose labels
 * are still hidden (permission not yet granted) get a synthesized fallback
 * label so the picker always shows something selectable.
 */
export async function enumerateAudioInputs(): Promise<AudioInputDevice[]> {
  if (!hasMediaDevices()) {
    return []
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter((device) => device.kind === 'audioinput')

  return inputs.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `Microphone ${index + 1}`,
  }))
}
