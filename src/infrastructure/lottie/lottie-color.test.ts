import { describe, expect, it } from 'vite-plus/test'
import {
  extractLottieColorLayers,
  applyLottieColorOverrides,
  hexToLottieRgb,
  lottieRgbToHex,
} from './lottie-color'

// A Lottie with a text layer (no shapes), plus a shape layer whose group holds a
// static red fill (c0) and a static black stroke with alpha (c1), followed by an
// animated fill (c.a === 1) that must be skipped.
function animation() {
  return {
    v: '5.7.0',
    w: 100,
    h: 100,
    fr: 30,
    ip: 0,
    op: 60,
    layers: [
      { ty: 5, nm: 'Title', t: { d: { k: [{ s: { t: 'Hi' } }] } } },
      {
        ty: 4,
        nm: 'Circle',
        shapes: [
          {
            ty: 'gr',
            nm: 'Group',
            it: [
              { ty: 'fl', nm: 'Fill 1', c: { a: 0, k: [1, 0, 0] } },
              { ty: 'st', nm: 'Stroke 1', c: { a: 0, k: [0, 0, 0, 1] } },
            ],
          },
          { ty: 'fl', nm: 'Animated', c: { a: 1, k: [] } },
        ],
      },
    ],
  }
}

describe('hex <-> lottie rgb', () => {
  it('round-trips an 8-bit color through normalized floats', () => {
    expect(lottieRgbToHex([1, 0, 0])).toBe('#ff0000')
    expect(lottieRgbToHex([0, 0.50196, 0])).toBe('#008000')
    const rgb = hexToLottieRgb('#ff8000')!
    expect(rgb[0]).toBe(1)
    expect(rgb[2]).toBe(0)
    expect(lottieRgbToHex(rgb)).toBe('#ff8000')
  })

  it('rejects malformed hex', () => {
    expect(hexToLottieRgb('#fff')).toBeNull()
    expect(hexToLottieRgb('nope')).toBeNull()
  })
})

describe('extractLottieColorLayers', () => {
  it('lists static solids in depth-first order, skipping animated and non-shape layers', () => {
    // "Fill 1" / "Stroke 1" are editor-generated defaults, not author names.
    expect(extractLottieColorLayers(animation())).toEqual([
      { key: 'c0', color: '#ff0000', label: 'Fill 1', named: false },
      { key: 'c1', color: '#000000', label: 'Stroke 1', named: false },
    ])
  })

  it('marks fills without an author name as not-named (generated fallback label)', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      layers: [{ ty: 4, shapes: [{ ty: 'fl', c: { a: 0, k: [1, 1, 1] } }] }],
    }
    expect(extractLottieColorLayers(anim)).toEqual([
      { key: 'c0', color: '#ffffff', label: 'Fill', named: false },
    ])
  })

  it('treats generated names (Fill 1, Stroke) as not-named but real names as named', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      layers: [
        {
          ty: 4,
          shapes: [
            { ty: 'fl', nm: 'Fill 2', c: { a: 0, k: [1, 0, 0] } },
            { ty: 'st', nm: 'Stroke', c: { a: 0, k: [0, 1, 0] } },
            { ty: 'fl', nm: 'coat-back', c: { a: 0, k: [0, 0, 1] } },
          ],
        },
      ],
    }
    expect(extractLottieColorLayers(anim).map((c) => [c.label, c.named])).toEqual([
      ['Fill 2', false],
      ['Stroke', false],
      ['coat-back', true],
    ])
  })

  it('accepts a JSON string and returns [] for non-shape input', () => {
    expect(extractLottieColorLayers(JSON.stringify(animation()))).toHaveLength(2)
    expect(extractLottieColorLayers('not json')).toEqual([])
    expect(extractLottieColorLayers({ foo: 'bar' })).toEqual([])
  })
})

describe('applyLottieColorOverrides', () => {
  it('patches only the addressed color and preserves the alpha channel', () => {
    const patched = applyLottieColorOverrides(animation(), { c0: '#00ff00', c1: '#0000ff' })
    expect(patched).not.toBeNull()
    const shapes = JSON.parse(patched!).layers[1].shapes
    expect(shapes[0].it[0].c.k).toEqual([0, 1, 0]) // fill recolored, no alpha added
    expect(shapes[0].it[1].c.k).toEqual([0, 0, 1, 1]) // stroke recolored, alpha kept
    expect(shapes[1].c.k).toEqual([]) // animated fill untouched
  })

  it('returns null when there is nothing to change', () => {
    expect(applyLottieColorOverrides(animation(), {})).toBeNull()
    // Unknown key → no change.
    expect(applyLottieColorOverrides(animation(), { c9: '#ffffff' })).toBeNull()
    // Malformed value → ignored.
    expect(applyLottieColorOverrides(animation(), { c0: 'red' })).toBeNull()
  })
})

// A group holding a static solid fill (c0) and an animated solid stroke (c1,
// two keyframes). Gradients are intentionally not editable inline (slots only).
function mixed() {
  return {
    v: '5.7.0',
    w: 100,
    h: 100,
    fr: 30,
    ip: 0,
    op: 60,
    layers: [
      {
        ty: 4,
        nm: 'Art',
        shapes: [
          {
            ty: 'gr',
            nm: 'Group',
            it: [
              { ty: 'fl', nm: 'Solid', c: { a: 0, k: [1, 1, 1] } },
              {
                ty: 'st',
                nm: 'Pulse',
                c: {
                  a: 1,
                  k: [
                    { t: 0, s: [1, 0, 0] },
                    { t: 30, s: [0, 0, 1] },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('extractLottieColorLayers — animated', () => {
  it('yields static and animated solid colors in document order', () => {
    expect(extractLottieColorLayers(mixed())).toEqual([
      { key: 'c0', color: '#ffffff', label: 'Solid', named: true },
      { key: 'c1', color: '#ff0000', label: 'Pulse', named: true }, // first keyframe's color
    ])
  })

  it('skips animated colors with no readable keyframe', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      layers: [{ ty: 4, shapes: [{ ty: 'fl', c: { a: 1, k: [] } }] }],
    }
    expect(extractLottieColorLayers(anim)).toEqual([])
  })

  it('does not surface gradient fills (gf/gs) — those are recolored via slots', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      layers: [
        { ty: 4, shapes: [{ ty: 'gf', nm: 'Ramp', g: { p: 2, k: { a: 0, k: [0, 1, 0, 0] } } }] },
      ],
    }
    expect(extractLottieColorLayers(anim)).toEqual([])
  })
})

describe('applyLottieColorOverrides — animated', () => {
  it('freezes every keyframe of an animated color to the override', () => {
    const patched = applyLottieColorOverrides(mixed(), { c1: '#00ff00' })
    const kf = JSON.parse(patched!).layers[0].shapes[0].it[1].c.k
    expect(kf[0].s).toEqual([0, 1, 0])
    expect(kf[1].s).toEqual([0, 1, 0])
  })

  it('keeps ordinal keys aligned — overriding the solid leaves the animated color', () => {
    const parsed = JSON.parse(applyLottieColorOverrides(mixed(), { c0: '#000000' })!)
    const it = parsed.layers[0].shapes[0].it
    expect(it[0].c.k).toEqual([0, 0, 0])
    expect(it[1].c.k[0].s).toEqual([1, 0, 0]) // animated untouched
  })
})

// A themeable animation: an `accent` color slot (red) referenced by a fill via
// `sid` (no inline `c.k`), plus a separate inline blue fill.
function slotted() {
  return {
    v: '5.7.0',
    w: 100,
    h: 100,
    fr: 30,
    ip: 0,
    op: 60,
    slots: { accent: { p: { a: 0, k: [1, 0, 0, 1] } } },
    layers: [
      {
        ty: 4,
        nm: 'Art',
        shapes: [
          {
            ty: 'gr',
            it: [
              { ty: 'fl', nm: 'Bound', c: { sid: 'accent' } },
              { ty: 'fl', nm: 'Plain', c: { a: 0, k: [0, 0, 1] } },
            ],
          },
        ],
      },
    ],
  }
}

describe('color slots', () => {
  it('surfaces color slots first (by id), and skips the slot-bound inline fill', () => {
    expect(extractLottieColorLayers(slotted())).toEqual([
      { key: 's:accent', color: '#ff0000', label: 'accent', named: true },
      { key: 'c0', color: '#0000ff', label: 'Plain', named: true }, // only the unbound fill
    ])
  })

  it('patches the slot value AND bakes it into the referencing fill', () => {
    const parsed = JSON.parse(applyLottieColorOverrides(slotted(), { 's:accent': '#00ff00' })!)
    expect(parsed.slots.accent.p.k).toEqual([0, 1, 0, 1]) // slot RGBA, alpha kept
    expect(parsed.layers[0].shapes[0].it[0].c.k).toEqual([0, 1, 0, 1]) // baked inline
    expect(parsed.layers[0].shapes[0].it[1].c.k).toEqual([0, 0, 1]) // plain fill untouched
  })

  it('leaves slots untouched when only an inline color is overridden', () => {
    const parsed = JSON.parse(applyLottieColorOverrides(slotted(), { c0: '#00ffff' })!)
    expect(parsed.slots.accent.p.k).toEqual([1, 0, 0, 1])
    expect(parsed.layers[0].shapes[0].it[1].c.k).toEqual([0, 1, 1])
  })
})
