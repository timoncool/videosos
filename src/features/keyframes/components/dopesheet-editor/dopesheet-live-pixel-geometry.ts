interface LivePixelGeometryParams {
  root: HTMLElement
  pixelsPerSecond: number
  fps: number
  scrollLeft: number
  itemFrom: number
  originOffset?: number
}

function readFiniteNumber(element: HTMLElement, attribute: string): number | null {
  const raw = element.getAttribute(attribute)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function setPixelStyle(element: HTMLElement, property: 'left' | 'width', value: number): void {
  element.style[property] = `${value}px`
}

/**
 * Repositions the interactive Edit-lane geometry at its final pixel coordinates.
 *
 * Unlike a compositor scale, this keeps diamonds, handles, borders, and hit
 * targets at a constant physical size while zooming. The work is bounded to the
 * mounted dopesheet rows and is called at most once per native scroll frame.
 */
export function syncDopesheetLivePixelGeometry({
  root,
  pixelsPerSecond,
  fps,
  scrollLeft,
  itemFrom,
  originOffset = 0,
}: LivePixelGeometryParams): void {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0 || fps <= 0) return

  const pixelsPerFrame = pixelsPerSecond / fps
  const frameToX = (frame: number) =>
    (itemFrom + frame) * pixelsPerFrame - scrollLeft + originOffset

  for (const node of root.querySelectorAll<HTMLElement>('[data-dopesheet-frame]')) {
    const frame = readFiniteNumber(node, 'data-dopesheet-frame')
    if (frame === null) continue
    setPixelStyle(node, 'left', frameToX(frame))
  }

  for (const node of root.querySelectorAll<HTMLElement>(
    '[data-dopesheet-from-frame][data-dopesheet-to-frame]',
  )) {
    const fromFrame = readFiniteNumber(node, 'data-dopesheet-from-frame')
    const toFrame = readFiniteNumber(node, 'data-dopesheet-to-frame')
    if (fromFrame === null || toFrame === null) continue

    const fromX = frameToX(fromFrame)
    const toX = frameToX(toFrame)
    const rawLeft = Math.min(fromX, toX)
    const rawWidth = Math.abs(toX - fromX)
    const responsiveInset = readFiniteNumber(node, 'data-dopesheet-responsive-inset') ?? 0
    const inset = rawWidth > 22 ? responsiveInset : 0
    const minWidth = readFiniteNumber(node, 'data-dopesheet-min-width') ?? 0

    setPixelStyle(node, 'left', rawLeft + inset)
    setPixelStyle(node, 'width', Math.max(minWidth, rawWidth - inset * 2))
  }

  for (const node of root.querySelectorAll<HTMLElement>('[data-dopesheet-relative-frame]')) {
    const frame = readFiniteNumber(node, 'data-dopesheet-relative-frame')
    const span = node.closest<HTMLElement>('[data-dopesheet-from-frame]')
    const fromFrame = span ? readFiniteNumber(span, 'data-dopesheet-from-frame') : null
    if (frame === null || fromFrame === null) continue
    setPixelStyle(node, 'left', (frame - fromFrame) * pixelsPerFrame)
  }

  for (const node of root.querySelectorAll<HTMLElement>('[data-motion-grid-frames]')) {
    const frames = (node.getAttribute('data-motion-grid-frames') ?? '')
      .split(',')
      .map(Number)
      .filter(Number.isFinite)
    const positions = frames.map((frame) => Math.round(frameToX(frame)))
    const left = positions[0] ?? 0
    setPixelStyle(node, 'left', left)
    node.style.boxShadow = positions
      .slice(1)
      .map((position) => `${position - left}px 0 currentColor`)
      .join(', ')
  }
}
