/**
 * Attach an RMS level meter to a live {@link MediaStream}.
 *
 * Owns a dedicated {@link AudioContext} + `AnalyserNode` and reports the input
 * level (RMS, 0..1) on every animation frame via `onLevel`. Best-effort: if Web
 * Audio is unavailable or setup throws, it silently reports nothing rather than
 * breaking the caller. Returns a stop function that cancels the loop and closes
 * the context (it does NOT stop the stream's tracks — the caller owns those).
 */
export function createMicLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!Ctor) return () => {}

  let context: AudioContext | null = null
  let rafId: number | null = null

  try {
    context = new Ctor()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.5
    source.connect(analyser)
    const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i += 1) {
        // Byte samples are centered at 128; normalize to [-1, 1].
        const sample = (data[i]! - 128) / 128
        sumSquares += sample * sample
      }
      onLevel(Math.min(1, Math.sqrt(sumSquares / data.length)))
      rafId = requestAnimationFrame(tick)
    }
    tick()
  } catch {
    // Metering is best-effort — never let it break recording/monitoring.
    if (context) void context.close().catch(() => {})
    context = null
  }

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (context) {
      void context.close().catch(() => {})
      context = null
    }
  }
}
