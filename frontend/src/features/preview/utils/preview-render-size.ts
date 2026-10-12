const MAX_REALTIME_PREVIEW_PIXELS = 1920 * 1080
const PREVIEW_WIDTH_BUCKET_PX = 32

type Size = { width: number; height: number }

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * Resolve a stable preview backing size close to the visible device-pixel size.
 * Authored project dimensions remain the renderer's logical coordinate space.
 */
export function getRealtimePreviewRenderSize(
  projectSize: Size,
  playerSize: Size,
  devicePixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1),
): Size {
  const projectWidth = Math.max(2, Math.round(projectSize.width))
  const projectHeight = Math.max(2, Math.round(projectSize.height))
  const projectPixels = projectWidth * projectHeight
  if (projectPixels <= MAX_REALTIME_PREVIEW_PIXELS) {
    return { width: projectWidth, height: projectHeight }
  }

  const visibleWidth = Math.max(2, playerSize.width * devicePixelRatio)
  const visibleHeight = Math.max(2, playerSize.height * devicePixelRatio)
  const visibleScale = Math.min(
    1,
    Math.max(visibleWidth / projectWidth, visibleHeight / projectHeight),
  )
  const pixelBudgetScale = Math.min(1, Math.sqrt(MAX_REALTIME_PREVIEW_PIXELS / projectPixels))
  const renderScale = Math.min(visibleScale, pixelBudgetScale)

  const bucketedWidth = Math.min(
    projectWidth,
    Math.ceil((projectWidth * renderScale) / PREVIEW_WIDTH_BUCKET_PX) * PREVIEW_WIDTH_BUCKET_PX,
  )
  const width = even(bucketedWidth)
  const height = even((width / projectWidth) * projectHeight)
  return { width, height }
}
