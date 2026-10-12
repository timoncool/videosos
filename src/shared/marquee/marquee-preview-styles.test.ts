import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

const stylesheet = readFileSync('src/index.css', 'utf8')

describe('timeline marquee preview styles', () => {
  it('paints a visible overlay above timeline item content', () => {
    const rule = stylesheet.match(/\.timeline-marquee-preview::after\s*\{([^}]*)\}/)?.[1]

    expect(rule).toBeDefined()
    expect(rule).toContain('z-index: 30')
    expect(rule).toContain('border: 1px solid var(--primary)')
    expect(rule).toContain('background: color-mix(in oklab, var(--primary) 14%, transparent)')
    expect(rule).not.toContain('oklch(var(--primary))')
  })
})
