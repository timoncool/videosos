/**
 * Lottie item rendering for export/compositing.
 *
 * Mirrors the animated-GIF path: the frame is produced on demand by the
 * preloaded {@link LottieExportProvider} (dotlottie-web `setFrame`) and drawn
 * through the same `drawContainedMediaSource` helper as images.
 */
import type { LottieItem } from '@/types/timeline'
import { mapTimelineFrameToLottieFrame } from '@/infrastructure/lottie/lottie-frame-provider'
import type { ItemRenderContext } from './types'
import { drawContainedMediaSource } from './media-draw'

export function renderLottieItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: LottieItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
  frame: number,
): void {
  const { fps, canvasSettings, canvasPool, lottieProvider } = rctx

  const localFrame = frame - item.from
  const lottieFrame = mapTimelineFrameToLottieFrame({
    localFrame,
    projectFps: fps,
    speed: item.speed ?? 1,
    totalFrames: item.totalFrames,
    frameRate: item.frameRate,
    loop: item.loop ?? true,
    reversed: item.reversed,
    loopMode: item.loopMode,
    segmentStart: item.segmentStart,
    segmentEnd: item.segmentEnd,
  })

  const source = lottieProvider.renderFrame(item.id, lottieFrame)
  if (!source) return

  drawContainedMediaSource(
    ctx,
    source,
    source.width,
    source.height,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    canvasPool,
  )
}
