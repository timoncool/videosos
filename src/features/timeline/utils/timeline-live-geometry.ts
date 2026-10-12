import { getTimelineWidth } from './timeline-layout'

interface ApplyTimelineLiveGeometryOptions {
  outer: HTMLElement
  surface: HTMLElement
  duration: number
  viewportWidth: number
  livePixelsPerSecond: number
  fps?: number
}

function setStyle(style: CSSStyleDeclaration, property: string, value: string) {
  if (style.getPropertyValue(property) !== value) {
    style.setProperty(property, value)
  }
}

const TRACKS_SURFACE_SELECTOR = '[data-timeline-committed-surface="tracks"]'
const trackContentLayersBySurface = new WeakMap<HTMLElement, Set<HTMLElement>>()
const trackContentLayerRegistrations = new WeakMap<HTMLElement, { surface: HTMLElement }>()
const trackContentWidthBySurface = new WeakMap<HTMLElement, number>()

function unregisterTrackContentLayer(layer: HTMLElement, registration: { surface: HTMLElement }) {
  if (trackContentLayerRegistrations.get(layer) !== registration) {
    return
  }

  trackContentLayerRegistrations.delete(layer)
  const registeredLayers = trackContentLayersBySurface.get(registration.surface)
  registeredLayers?.delete(layer)
  if (registeredLayers?.size === 0) {
    trackContentLayersBySurface.delete(registration.surface)
  }
}

function registerTrackContentLayer(layer: HTMLElement) {
  const surface = layer.closest<HTMLElement>(TRACKS_SURFACE_SELECTOR)
  if (!surface) {
    return () => {}
  }

  const previousRegistration = trackContentLayerRegistrations.get(layer)
  if (previousRegistration) {
    unregisterTrackContentLayer(layer, previousRegistration)
  }

  let registeredLayers = trackContentLayersBySurface.get(surface)
  if (!registeredLayers) {
    registeredLayers = new Set()
    trackContentLayersBySurface.set(surface, registeredLayers)
  }

  const registration = { surface }
  registeredLayers.add(layer)
  trackContentLayerRegistrations.set(layer, registration)

  const liveContentWidth = trackContentWidthBySurface.get(surface)
  if (liveContentWidth !== undefined) {
    setStyle(layer.style, 'width', `${liveContentWidth}px`)
  }

  return () => unregisterTrackContentLayer(layer, registration)
}

function updateRegisteredTrackContentLayers(surface: HTMLElement, liveContentWidth: number) {
  const registeredLayers = trackContentLayersBySurface.get(surface)
  if (!registeredLayers) {
    return
  }

  for (const layer of registeredLayers) {
    const registration = trackContentLayerRegistrations.get(layer)
    if (registration?.surface !== surface || !surface.contains(layer)) {
      registeredLayers.delete(layer)
      if (registration?.surface === surface) {
        trackContentLayerRegistrations.delete(layer)
      }
      continue
    }

    setStyle(layer.style, 'width', `${liveContentWidth}px`)
  }

  if (registeredLayers.size === 0) {
    trackContentLayersBySurface.delete(surface)
  }
}

export function createTimelineTrackContentLayerRef() {
  let unregister: (() => void) | null = null

  return (layer: HTMLElement | null) => {
    unregister?.()
    unregister = layer ? registerTrackContentLayer(layer) : null
  }
}

/**
 * Applies live zoom as real timeline geometry. Clip left/width values already
 * use a static percentage-per-frame inside a live-width track layer, so this
 * preserves natural text, thumbnail, waveform, handle, and border proportions
 * without scaling mounted content or invalidating inherited styles on zoom.
 */
export function applyTimelineLiveGeometry({
  outer,
  surface,
  duration,
  viewportWidth,
  livePixelsPerSecond,
  fps,
}: ApplyTimelineLiveGeometryOptions) {
  const effectiveViewportWidth = viewportWidth > 0 ? viewportWidth : 1920
  const liveContentWidth =
    Math.round(Math.max(0, duration * livePixelsPerSecond) * 1_000_000) / 1_000_000
  const liveWidth = getTimelineWidth({
    contentWidth: liveContentWidth,
    viewportWidth: effectiveViewportWidth,
  })

  setStyle(outer.style, 'width', `${liveWidth}px`)
  setStyle(surface.style, 'width', `${liveWidth}px`)
  setStyle(surface.style, 'transform', 'none')

  if (fps !== undefined) {
    const totalFrames = Math.max(0, duration * fps)
    const percentPerFrame = totalFrames > 0 ? 100 / totalFrames : 0
    const percentPerSecond = duration > 0 ? 100 / duration : 0
    setStyle(surface.style, '--timeline-percent-per-frame', `${percentPerFrame}%`)
    setStyle(surface.style, '--timeline-percent-per-second', `${percentPerSecond}%`)
  }

  trackContentWidthBySurface.set(surface, liveContentWidth)
  updateRegisteredTrackContentLayers(surface, liveContentWidth)
}
