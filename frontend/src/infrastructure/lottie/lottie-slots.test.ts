import { describe, expect, it } from 'vite-plus/test'
import { extractLottieValueSlots } from './lottie-slots'

// An animation whose `slots` table mixes every value shape: a static scalar, an
// animated scalar (read from its first keyframe), a static 2D vector, plus a
// color (RGBA), a gradient (object) and a text document — the last three must be
// ignored here (handled by lottie-color / lottie-text).
function slotted() {
  return {
    v: '5.7.0',
    w: 100,
    h: 100,
    fr: 30,
    op: 60,
    slots: {
      opacity: { p: { a: 0, k: 80 } },
      spin: {
        p: {
          a: 1,
          k: [
            { t: 0, s: 45 },
            { t: 30, s: 360 },
          ],
        },
      },
      offset: { p: { a: 0, k: [12, -4] } },
      accent: { p: { a: 0, k: [1, 0, 0, 1] } }, // color -> skipped
      ramp: { p: { a: 0, k: { p: 2, k: [0, 1, 0, 0, 1, 0, 0, 1] } } }, // gradient -> skipped
      headline: { p: { a: 0, k: { t: 'Hi' } } }, // text -> skipped
    },
    layers: [{ ty: 4, shapes: [] }],
  }
}

describe('extractLottieValueSlots', () => {
  it('surfaces static + animated scalars and 2D vectors, skipping color/gradient/text', () => {
    expect(extractLottieValueSlots(slotted())).toEqual([
      { id: 'opacity', type: 'scalar', label: 'opacity', value: 80 },
      { id: 'spin', type: 'scalar', label: 'spin', value: 45 }, // first keyframe
      { id: 'offset', type: 'vector', label: 'offset', value: [12, -4] },
    ])
  })

  it('prefers a slot name over its id for the label', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      slots: { s1: { nm: 'Stroke width', p: { a: 0, k: 4 } } },
      layers: [{ ty: 4, shapes: [] }],
    }
    expect(extractLottieValueSlots(anim)[0]).toEqual({
      id: 's1',
      type: 'scalar',
      label: 'Stroke width',
      value: 4,
    })
  })

  it('accepts a JSON string and returns [] for slotless / non-Lottie input', () => {
    expect(extractLottieValueSlots(JSON.stringify(slotted()))).toHaveLength(3)
    expect(extractLottieValueSlots({ w: 1, h: 1, layers: [] })).toEqual([])
    expect(extractLottieValueSlots('not json')).toEqual([])
    expect(extractLottieValueSlots(null)).toEqual([])
  })

  it('ignores a length-3 array (ambiguous with RGB) and malformed slot props', () => {
    const anim = {
      w: 1,
      h: 1,
      fr: 30,
      op: 1,
      slots: {
        vec3: { p: { a: 0, k: [1, 2, 3] } }, // 3D/ RGB ambiguity -> skipped
        broken: { p: { a: 1, k: [] } }, // animated, no keyframe -> skipped
        empty: {}, // no prop -> skipped
      },
      layers: [{ ty: 4, shapes: [] }],
    }
    expect(extractLottieValueSlots(anim)).toEqual([])
  })
})
