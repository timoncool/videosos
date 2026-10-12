// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vite-plus/test'
import {
  applyTimelineLiveGeometry,
  createTimelineTrackContentLayerRef,
} from './timeline-live-geometry'

function createTracksSurface() {
  const outer = document.createElement('div')
  const surface = document.createElement('div')
  surface.dataset.timelineCommittedSurface = 'tracks'
  outer.appendChild(surface)
  return { outer, surface }
}

describe('applyTimelineLiveGeometry', () => {
  it('updates real clip geometry without scaling mounted DOM', () => {
    const { outer, surface } = createTracksSurface()
    const contentLayer = document.createElement('div')
    contentLayer.dataset.timelineTrackContentLayer = 'true'
    const child = document.createElement('button')
    contentLayer.appendChild(child)
    surface.appendChild(contentLayer)
    const contentLayerRef = createTimelineTrackContentLayerRef()
    contentLayerRef(contentLayer)
    const querySelectorAll = vi.spyOn(surface, 'querySelectorAll')

    applyTimelineLiveGeometry({
      outer,
      surface,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 200,
      fps: 25,
    })

    expect(outer.style.width).toBe('2240px')
    expect(surface.style.width).toBe('2240px')
    expect(contentLayer.style.width).toBe('2000px')
    expect(surface.style.transform).toBe('none')
    expect(surface.style.getPropertyValue('--timeline-percent-per-frame')).toBe('0.4%')
    expect(surface.style.getPropertyValue('--timeline-percent-per-second')).toBe('10%')
    expect(surface.style.getPropertyValue('--timeline-px-per-frame')).toBe('')
    expect(outer.style.getPropertyValue('--timeline-px-per-frame')).toBe('')
    expect(contentLayer.firstElementChild).toBe(child)

    applyTimelineLiveGeometry({
      outer,
      surface,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 250,
      fps: 25,
    })

    expect(outer.style.width).toBe('2740px')
    expect(surface.style.width).toBe('2740px')
    expect(contentLayer.style.width).toBe('2500px')
    expect(surface.style.getPropertyValue('--timeline-percent-per-frame')).toBe('0.4%')
    expect(surface.style.getPropertyValue('--timeline-percent-per-second')).toBe('10%')
    expect(contentLayer.firstElementChild).toBe(child)
    expect(querySelectorAll).not.toHaveBeenCalled()

    contentLayerRef(null)
  })

  it('initializes late-mounted layers and unregisters null or replacement refs', () => {
    const first = createTracksSurface()
    const second = createTracksSurface()

    applyTimelineLiveGeometry({
      ...first,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 200,
      fps: 25,
    })
    applyTimelineLiveGeometry({
      ...second,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 300,
      fps: 25,
    })

    const firstLayer = document.createElement('div')
    const secondLayer = document.createElement('div')
    first.surface.appendChild(firstLayer)
    second.surface.appendChild(secondLayer)
    const contentLayerRef = createTimelineTrackContentLayerRef()

    contentLayerRef(firstLayer)
    expect(firstLayer.style.width).toBe('2000px')

    contentLayerRef(secondLayer)
    expect(secondLayer.style.width).toBe('3000px')

    applyTimelineLiveGeometry({
      ...first,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 250,
      fps: 25,
    })
    applyTimelineLiveGeometry({
      ...second,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 350,
      fps: 25,
    })

    expect(firstLayer.style.width).toBe('2000px')
    expect(secondLayer.style.width).toBe('3500px')

    contentLayerRef(null)
    applyTimelineLiveGeometry({
      ...second,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 400,
      fps: 25,
    })
    expect(secondLayer.style.width).toBe('3500px')
  })

  it('prunes a registered layer that moves outside its original surface', () => {
    const first = createTracksSurface()
    const second = createTracksSurface()
    const contentLayer = document.createElement('div')
    first.surface.appendChild(contentLayer)
    const contentLayerRef = createTimelineTrackContentLayerRef()
    contentLayerRef(contentLayer)

    applyTimelineLiveGeometry({
      ...first,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 200,
      fps: 25,
    })
    expect(contentLayer.style.width).toBe('2000px')

    second.surface.appendChild(contentLayer)
    applyTimelineLiveGeometry({
      ...first,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 250,
      fps: 25,
    })
    expect(contentLayer.style.width).toBe('2000px')

    contentLayerRef(contentLayer)
    applyTimelineLiveGeometry({
      ...second,
      duration: 10,
      viewportWidth: 500,
      livePixelsPerSecond: 300,
      fps: 25,
    })
    expect(contentLayer.style.width).toBe('3000px')

    contentLayerRef(null)
  })
})
