/**
 * Pre-record microphone monitor — a lightweight `getUserMedia` + level meter
 * with NO `MediaRecorder`. Powers the live input meter in the device picker so
 * users can confirm the right mic is working before committing to a take.
 */

import { buildAudioConstraints } from './mic-recorder'
import { createMicLevelMeter } from './meter'

export interface MicMonitorHandle {
  stop: () => void
}

export interface MicMonitorOptions {
  deviceId?: string
  noiseSuppression?: boolean
  autoGainControl?: boolean
  onLevel: (level: number) => void
}

/**
 * Open a mic stream purely for metering. Resolves once the stream is live.
 * Call `stop()` to release the mic and end the meter loop.
 */
export async function startMicLevelMonitor(options: MicMonitorOptions): Promise<MicMonitorHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(options),
    video: false,
  })

  const stopMeter = createMicLevelMeter(stream, options.onLevel)
  let stopped = false

  return {
    stop() {
      if (stopped) return
      stopped = true
      stopMeter()
      for (const track of stream.getTracks()) {
        track.stop()
      }
    },
  }
}
