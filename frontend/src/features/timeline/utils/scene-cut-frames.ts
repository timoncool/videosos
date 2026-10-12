interface SceneCutTime {
  time: number
}

interface MapSceneCutFramesOptions {
  cuts: readonly SceneCutTime[]
  sourceStartSeconds: number
  projectFps: number
  clipFrom: number
  clipDurationInFrames: number
}

export function mapSceneCutTimesToTimelineFrames({
  cuts,
  sourceStartSeconds,
  projectFps,
  clipFrom,
  clipDurationInFrames,
}: MapSceneCutFramesOptions): number[] {
  const clipEnd = clipFrom + clipDurationInFrames
  const frames = new Set<number>()

  for (const cut of cuts) {
    if (!Number.isFinite(cut.time)) continue
    const frame = clipFrom + Math.round((cut.time - sourceStartSeconds) * projectFps)
    if (frame > clipFrom && frame < clipEnd) frames.add(frame)
  }

  return [...frames].sort((a, b) => a - b)
}
