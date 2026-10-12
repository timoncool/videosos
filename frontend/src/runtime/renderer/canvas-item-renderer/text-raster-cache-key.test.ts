// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { getTextRasterCacheKey } from './text'

function item(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 't',
    type: 'text',
    trackId: 'tr',
    from: 0,
    durationInFrames: 30,
    label: 'x',
    text: 'hello',
    color: '#ffffff',
    ...overrides,
  } as TextItem
}

describe('getTextRasterCacheKey', () => {
  it('is stable across frame-varying state (position/rotation/opacity are composite-time)', () => {
    const a = getTextRasterCacheKey(
      item({ transform: { x: 0, y: 0, opacity: 1 } as TextItem['transform'] }),
      500,
      200,
    )
    const b = getTextRasterCacheKey(
      item({ transform: { x: 300, y: -80, rotation: 45, opacity: 0.5 } as TextItem['transform'] }),
      500,
      200,
    )
    expect(a).toBe(b)
  })

  it('changes when pixel-affecting inputs change', () => {
    const base = getTextRasterCacheKey(item(), 500, 200)
    expect(getTextRasterCacheKey(item({ text: 'other' }), 500, 200)).not.toBe(base)
    expect(getTextRasterCacheKey(item(), 501, 200)).not.toBe(base)
    expect(getTextRasterCacheKey(item({ color: '#ff7a00' }), 500, 200)).not.toBe(base)
  })

  it('distinguishes inline vs stacked span layout (regression: raster reuse across modes)', () => {
    const spans = [
      { text: 'a ', color: '#ffffff' },
      { text: 'b', color: '#ff7a00' },
    ]
    const stacked = getTextRasterCacheKey(item({ textSpans: spans }), 500, 200)
    const inline = getTextRasterCacheKey(item({ textSpans: spans, spanLayout: 'inline' }), 500, 200)
    expect(inline).not.toBe(stacked)
  })
})
