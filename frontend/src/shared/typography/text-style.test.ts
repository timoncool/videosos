// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { resolveSpanStyles, resolveTextStyle } from './text-style'

function item(overrides: Partial<TextItem>): TextItem {
  return {
    id: 't',
    type: 'text',
    trackId: 'tr',
    from: 0,
    durationInFrames: 30,
    label: 'x',
    text: 'hello',
    color: '#123456',
    ...overrides,
  } as TextItem
}

describe('resolveTextStyle', () => {
  it('clamps negative padding/radius to zero', () => {
    const style = resolveTextStyle(item({ textPadding: -10, backgroundRadius: -4 }))
    expect(style.textPadding).toBe(0)
    expect(style.backgroundRadius).toBe(0)
  })

  it('keeps explicit values over defaults', () => {
    const style = resolveTextStyle(item({ lineHeight: 1.5, textAlign: 'left' }))
    expect(style.lineHeight).toBe(1.5)
    expect(style.textAlign).toBe('left')
  })
})

describe('resolveSpanStyles', () => {
  it('falls back to a single span carrying the item text and style', () => {
    const spans = resolveSpanStyles(item({ fontSize: 42 }))
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ text: 'hello', fontSize: 42, color: '#123456' })
    expect(spans[0]!.cssFont).toContain('42px')
  })

  it('cascades span overrides over item values per field', () => {
    const spans = resolveSpanStyles(
      item({
        fontSize: 40,
        color: '#ffffff',
        textSpans: [{ text: 'a' }, { text: 'b', color: '#ff7a00', fontSize: 80, underline: true }],
      }),
    )
    expect(spans[0]).toMatchObject({ color: '#ffffff', fontSize: 40, underline: false })
    expect(spans[1]).toMatchObject({ color: '#ff7a00', fontSize: 80, underline: true })
    expect(spans[1]!.cssFont).toContain('80px')
  })

  it('maps named font weights to numeric css weights', () => {
    const spans = resolveSpanStyles(item({ fontWeight: 'bold' }))
    expect(spans[0]!.fontWeight).toBeGreaterThanOrEqual(600)
    expect(spans[0]!.cssFont).toContain(String(spans[0]!.fontWeight))
  })
})
