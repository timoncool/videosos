const MIN_PREVIEW_DISPLAY_EDGE_PADDING_PX = 1
const MAX_PREVIEW_DISPLAY_EDGE_PADDING_PX = 256
const MIN_PREVIEW_DISPLAY_EDGE_OVERSCAN_DEVICE_PX = 2
const MAX_PREFERRED_ALIGNED_OVERSCAN_DEVICE_PX = 3
const MAX_PIXEL_ALIGNMENT_SEARCH_STEPS = 16
const PIXEL_ALIGNMENT_EPSILON = 1e-3

type PreviewCanvasSize = {
  width: number
  height: number
}

export interface CommittedPreviewSnapshotState {
  canvas: OffscreenCanvas | null
  frame: number | null
  guardFrame: number | null
  guardUntilMs: number
}

export function getPreviewDisplayEdgePadding(
  playerSize: PreviewCanvasSize,
  renderSize: PreviewCanvasSize,
  devicePixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1),
): number {
  const scaleX = renderSize.width > 0 ? playerSize.width / renderSize.width : 1
  const scaleY = renderSize.height > 0 ? playerSize.height / renderSize.height : 1
  const smallestDeviceScale = Math.max(Number.EPSILON, Math.min(scaleX, scaleY) * devicePixelRatio)
  const minimumPadding = Math.min(
    MAX_PREVIEW_DISPLAY_EDGE_PADDING_PX,
    Math.max(
      MIN_PREVIEW_DISPLAY_EDGE_PADDING_PX,
      Math.ceil(
        MIN_PREVIEW_DISPLAY_EDGE_OVERSCAN_DEVICE_PX / smallestDeviceScale - PIXEL_ALIGNMENT_EPSILON,
      ),
    ),
  )
  const alignmentSearchEnd = Math.min(
    MAX_PREVIEW_DISPLAY_EDGE_PADDING_PX,
    minimumPadding + MAX_PIXEL_ALIGNMENT_SEARCH_STEPS,
  )

  for (let padding = minimumPadding; padding <= alignmentSearchEnd; padding++) {
    const xDevicePixels = padding * scaleX * devicePixelRatio
    const yDevicePixels = padding * scaleY * devicePixelRatio
    if (
      xDevicePixels >= MIN_PREVIEW_DISPLAY_EDGE_OVERSCAN_DEVICE_PX &&
      yDevicePixels >= MIN_PREVIEW_DISPLAY_EDGE_OVERSCAN_DEVICE_PX &&
      xDevicePixels <= MAX_PREFERRED_ALIGNED_OVERSCAN_DEVICE_PX &&
      yDevicePixels <= MAX_PREFERRED_ALIGNED_OVERSCAN_DEVICE_PX &&
      Math.abs(xDevicePixels - Math.round(xDevicePixels)) < PIXEL_ALIGNMENT_EPSILON &&
      Math.abs(yDevicePixels - Math.round(yDevicePixels)) < PIXEL_ALIGNMENT_EPSILON
    ) {
      return padding
    }
  }

  // Irrational/long-period fit scales often have no small source-pixel count
  // that maps to an exact device-pixel boundary. In that case, thickness is
  // more important than distant mathematical alignment: enough duplicated
  // edge pixels keep bilinear sampling outside the clipped player surface.
  return minimumPadding
}

export function getPreviewDisplayCanvasBackingSize(
  playerSize: PreviewCanvasSize,
  renderSize: PreviewCanvasSize,
): PreviewCanvasSize {
  const padding = getPreviewDisplayEdgePadding(playerSize, renderSize) * 2
  return {
    width: Math.max(1, Math.round(renderSize.width + padding)),
    height: Math.max(1, Math.round(renderSize.height + padding)),
  }
}

export function getPreviewDisplayCanvasStyle(
  playerSize: PreviewCanvasSize,
  renderSize: PreviewCanvasSize,
): {
  left: string
  top: string
  width: string
  height: string
} {
  const padding = getPreviewDisplayEdgePadding(playerSize, renderSize)
  const padX = renderSize.width > 0 ? (playerSize.width / renderSize.width) * padding : padding
  const padY = renderSize.height > 0 ? (playerSize.height / renderSize.height) * padding : padding

  return {
    left: `-${padX}px`,
    top: `-${padY}px`,
    width: `calc(100% + ${padX * 2}px)`,
    height: `calc(100% + ${padY * 2}px)`,
  }
}

export function drawSourceToPreviewDisplayCanvas(
  displayCtx: CanvasRenderingContext2D,
  displayCanvas: HTMLCanvasElement,
  source: OffscreenCanvas | HTMLCanvasElement,
): void {
  const padX = Math.max(0, Math.round((displayCanvas.width - source.width) / 2))
  const padY = Math.max(0, Math.round((displayCanvas.height - source.height) / 2))
  const contentWidth = Math.max(1, displayCanvas.width - padX * 2)
  const contentHeight = Math.max(1, displayCanvas.height - padY * 2)

  displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height)
  displayCtx.drawImage(source, padX, padY, contentWidth, contentHeight)

  if (padY > 0) {
    displayCtx.drawImage(displayCanvas, padX, padY, contentWidth, 1, padX, 0, contentWidth, padY)
    displayCtx.drawImage(
      displayCanvas,
      padX,
      padY + contentHeight - 1,
      contentWidth,
      1,
      padX,
      padY + contentHeight,
      contentWidth,
      padY,
    )
  }
  if (padX > 0) {
    displayCtx.drawImage(displayCanvas, padX, padY, 1, contentHeight, 0, padY, padX, contentHeight)
    displayCtx.drawImage(
      displayCanvas,
      padX + contentWidth - 1,
      padY,
      1,
      contentHeight,
      padX + contentWidth,
      padY,
      padX,
      contentHeight,
    )
  }

  if (padX > 0 && padY > 0) {
    displayCtx.drawImage(displayCanvas, padX, padY, 1, 1, 0, 0, padX, padY)
    displayCtx.drawImage(
      displayCanvas,
      padX + contentWidth - 1,
      padY,
      1,
      1,
      padX + contentWidth,
      0,
      padX,
      padY,
    )
    displayCtx.drawImage(
      displayCanvas,
      padX,
      padY + contentHeight - 1,
      1,
      1,
      0,
      padY + contentHeight,
      padX,
      padY,
    )
    displayCtx.drawImage(
      displayCanvas,
      padX + contentWidth - 1,
      padY + contentHeight - 1,
      1,
      1,
      padX + contentWidth,
      padY + contentHeight,
      padX,
      padY,
    )
  }
}

export function copyPreviewDisplayCanvasContent(
  sourceCanvas: HTMLCanvasElement,
  targetCtx: OffscreenCanvasRenderingContext2D,
): void {
  const padX = Math.max(0, Math.round((sourceCanvas.width - targetCtx.canvas.width) / 2))
  const padY = Math.max(0, Math.round((sourceCanvas.height - targetCtx.canvas.height) / 2))
  const contentWidth = Math.max(1, sourceCanvas.width - padX * 2)
  const contentHeight = Math.max(1, sourceCanvas.height - padY * 2)

  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height)
  targetCtx.drawImage(
    sourceCanvas,
    padX,
    padY,
    contentWidth,
    contentHeight,
    0,
    0,
    targetCtx.canvas.width,
    targetCtx.canvas.height,
  )
}
