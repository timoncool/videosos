import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The sound output the preview plays through, as Bulka's audio device choice: the system default (an empty id)
 * or one device by its id, kept with its name for the settings to show while the list is not read. Why the last
 * switch failed (a device unplugged) is kept for the settings to say.
 */
interface AudioOutputState {
  deviceId: string
  label: string
  error: string | null
  choose: (deviceId: string, label: string) => void
  setError: (error: string | null) => void
}

export const useAudioOutputStore = create<AudioOutputState>()(
  persist(
    (set) => ({
      deviceId: '',
      label: '',
      error: null,
      choose: (deviceId, label) => set({ deviceId, label, error: null }),
      setError: (error) => set({ error }),
    }),
    { name: 'videosos-audio-output', partialize: (state) => ({ deviceId: state.deviceId, label: state.label }) },
  ),
)

export interface AudioOutputDevice {
  id: string
  label: string
}

/** The sound outputs of this computer. Their names are told only to a page allowed the microphone once, as Bulka asks. */
export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const track of stream.getTracks()) track.stop()
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default' && device.deviceId !== '')
    .map((device) => ({ id: device.deviceId, label: device.label || device.deviceId }))
}
