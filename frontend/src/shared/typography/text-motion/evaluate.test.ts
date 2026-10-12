import { describe, expect, it } from 'vite-plus/test'
import type { TextMotionSpec } from '@/types/text-motion'
import {
  evaluateGlyphMotion,
  getActiveTextMotionSlot,
  isTextMotionActive,
  type GlyphMotionContext,
} from './evaluate'
import type { GlyphMotionState } from './evaluate'
import { createTextMotionEffect } from './text-motion-presets'

function ctx(overrides: Partial<GlyphMotionContext> = {}): GlyphMotionContext {
  return {
    relativeFrame: 0,
    fps: 30,
    durationInFrames: 300,
    unitIndex: 0,
    unitCount: 1,
    fontSize: 100,
    boxWidth: 800,
    boxHeight: 200,
    ...overrides,
  }
}

function evalState(spec: TextMotionSpec, context: GlyphMotionContext): GlyphMotionState {
  const state = evaluateGlyphMotion(spec, context)
  if (!state) throw new Error('expected a non-identity motion state')
  return state
}

describe('evaluateGlyphMotion — in-slot progress and order', () => {
  const inBase = {
    ...createTextMotionEffect('fade-up'),
    durationFrames: 10,
    staggerFrames: 5,
    easing: 'linear' as const,
  }
  const spec: TextMotionSpec = { in: inBase }

  it('staggers units forward: delay = rank * staggerFrames', () => {
    // unit 0 finished (p = 1) → identity → null
    expect(
      evaluateGlyphMotion(spec, ctx({ relativeFrame: 10, unitIndex: 0, unitCount: 4 })),
    ).toBeNull()
    // unit 1 (delay 5) is at p = 0.5
    const unit1 = evalState(spec, ctx({ relativeFrame: 10, unitIndex: 1, unitCount: 4 }))
    expect(unit1.alpha).toBeCloseTo(0.5, 6)
    expect(unit1.dy).toBeCloseTo(0.5 * 0.25 * 100, 6)
    // unit 3 (delay 15) has not started: hidden start state
    const unit3 = evalState(spec, ctx({ relativeFrame: 10, unitIndex: 3, unitCount: 4 }))
    expect(unit3.alpha).toBe(0)
  })

  it('reverses delays for backward order', () => {
    const backward: TextMotionSpec = {
      in: { ...inBase, order: 'backward' },
    }
    expect(
      evaluateGlyphMotion(backward, ctx({ relativeFrame: 10, unitIndex: 3, unitCount: 4 })),
    ).toBeNull()
    const unit0 = evalState(backward, ctx({ relativeFrame: 10, unitIndex: 0, unitCount: 4 }))
    expect(unit0.alpha).toBe(0)
  })

  it('ranks center order symmetrically from the middle', () => {
    const center: TextMotionSpec = {
      in: { ...inBase, order: 'center', durationFrames: 8, staggerFrames: 4 },
    }
    // 5 units → ranks [2, 1, 0, 1, 2]
    expect(
      evaluateGlyphMotion(center, ctx({ relativeFrame: 8, unitIndex: 2, unitCount: 5 })),
    ).toBeNull()
    const unit1 = evalState(center, ctx({ relativeFrame: 8, unitIndex: 1, unitCount: 5 }))
    const unit3 = evalState(center, ctx({ relativeFrame: 8, unitIndex: 3, unitCount: 5 }))
    expect(unit1.alpha).toBeCloseTo(0.5, 6)
    expect(unit3.alpha).toBeCloseTo(0.5, 6)
    const unit0 = evalState(center, ctx({ relativeFrame: 8, unitIndex: 0, unitCount: 5 }))
    expect(unit0.alpha).toBe(0)
  })

  describe('random order', () => {
    const UNITS = 8

    /**
     * With duration 1 / stagger 10, the unit of rank r settles (returns null)
     * from frame 10r + 1 onward — scanning settle frames recovers each
     * unit's rank.
     */
    function settleRanks(seed: number): number[] {
      const random: TextMotionSpec = {
        in: {
          ...createTextMotionEffect('fade-up'),
          durationFrames: 1,
          staggerFrames: 10,
          easing: 'linear',
          order: 'random',
          seed,
        },
      }
      const probeFrames = Array.from({ length: UNITS }, (_, rank) => 10 * rank + 1)
      return Array.from({ length: UNITS }, (_, unitIndex) =>
        probeFrames.findIndex(
          (frame) =>
            evaluateGlyphMotion(
              random,
              ctx({ relativeFrame: frame, unitIndex, unitCount: UNITS }),
            ) === null,
        ),
      )
    }

    it('produces a deterministic permutation of ranks for a given seed', () => {
      const ranks = settleRanks(7)
      expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      expect(settleRanks(7)).toEqual(ranks)
    })

    it('shuffles differently for a different seed', () => {
      expect(settleRanks(8)).not.toEqual(settleRanks(7))
    })
  })
})

describe('evaluateGlyphMotion — stagger compression on short clips', () => {
  // Uncompressed window = 20 + 10·9 = 110 frames on a 60-frame clip →
  // uniformly compressed to 30 (durationInFrames / 2): duration 60/11,
  // stagger 300/110.
  const spec: TextMotionSpec = {
    in: {
      ...createTextMotionEffect('fade-up'),
      durationFrames: 20,
      staggerFrames: 10,
      easing: 'linear',
    },
  }
  const clip = { durationInFrames: 60, unitCount: 10 }

  it('squeezes the whole reveal into half the clip instead of truncating', () => {
    // Last unit (rank 9, compressed delay ≈ 24.55) is mid-flight at frame 28…
    const lastUnit = evalState(spec, ctx({ ...clip, relativeFrame: 28, unitIndex: 9 }))
    expect(lastUnit.alpha).toBeCloseTo((28 - 270 / 11) / (60 / 11), 4)
    // …and fully settled just past the half-clip boundary.
    expect(evaluateGlyphMotion(spec, ctx({ ...clip, relativeFrame: 31, unitIndex: 9 }))).toBeNull()
  })

  it('compresses per-unit duration too (uniform window scale)', () => {
    // Uncompressed, unit 0 would still be at p = 0.3 at frame 6; compressed
    // duration is 60/11 ≈ 5.45 so it has already settled.
    expect(evaluateGlyphMotion(spec, ctx({ ...clip, relativeFrame: 6, unitIndex: 0 }))).toBeNull()
  })

  it('leaves windows that already fit untouched', () => {
    const roomy = ctx({ relativeFrame: 10, unitIndex: 0, unitCount: 2, durationInFrames: 300 })
    const state = evalState(spec, roomy)
    expect(state.alpha).toBeCloseTo(0.5, 6) // duration stays 20
  })
})

describe('evaluateGlyphMotion — out slot mirrors the clip end', () => {
  const spec: TextMotionSpec = {
    out: {
      ...createTextMotionEffect('fade-down'),
      durationFrames: 10,
      staggerFrames: 0,
      easing: 'linear',
    },
  }

  it('is identity before the out window and animates to gone at the end', () => {
    const base = { durationInFrames: 40, unitCount: 1, unitIndex: 0 }
    expect(evaluateGlyphMotion(spec, ctx({ ...base, relativeFrame: 25 }))).toBeNull()
    // Window start (frame 30) is p = 0 → still identity.
    expect(evaluateGlyphMotion(spec, ctx({ ...base, relativeFrame: 30 }))).toBeNull()
    const mid = evalState(spec, ctx({ ...base, relativeFrame: 35 }))
    expect(mid.alpha).toBeCloseTo(0.5, 6)
    expect(mid.dy).toBeCloseTo(0.5 * 0.25 * 100, 6)
    const late = evalState(spec, ctx({ ...base, relativeFrame: 39 }))
    expect(late.alpha).toBeCloseTo(0.1, 6)
  })
})

describe('evaluateGlyphMotion — out wins over in on short clips', () => {
  // Both slots ask for 100-frame windows on a 20-frame clip; each compresses
  // to 10 frames, so in owns [0, 10) and out owns [10, 20) — the in slot is
  // clamped to settled the moment the out window starts.
  const spec: TextMotionSpec = {
    in: {
      ...createTextMotionEffect('fade-up'),
      durationFrames: 100,
      staggerFrames: 0,
      easing: 'linear',
    },
    out: {
      ...createTextMotionEffect('fade-down'),
      durationFrames: 100,
      staggerFrames: 0,
      easing: 'linear',
    },
  }
  const base = { durationInFrames: 20, unitCount: 1, unitIndex: 0 }

  it('runs the in slot in the first half', () => {
    expect(evalState(spec, ctx({ ...base, relativeFrame: 5 })).alpha).toBeCloseTo(0.5, 6)
    expect(evalState(spec, ctx({ ...base, relativeFrame: 9 })).alpha).toBeCloseTo(0.9, 6)
  })

  it('clamps to settled at the out window start (never a glitch)', () => {
    expect(evaluateGlyphMotion(spec, ctx({ ...base, relativeFrame: 10 }))).toBeNull()
  })

  it('evaluates only the out slot from the out window start', () => {
    const state = evalState(spec, ctx({ ...base, relativeFrame: 15 }))
    expect(state.alpha).toBeCloseTo(0.5, 6)
    expect(state.dy).toBeGreaterThan(0) // fade-down travels downward
  })
})

describe('evaluateGlyphMotion — frame-rate independence', () => {
  it('one-shot slots match at equivalent wall-clock times across fps', () => {
    const at24: TextMotionSpec = {
      in: { ...createTextMotionEffect('rise'), durationFrames: 12, staggerFrames: 6 },
    }
    const at60: TextMotionSpec = {
      in: { ...createTextMotionEffect('rise'), durationFrames: 30, staggerFrames: 15 },
    }
    const state24 = evalState(
      at24,
      ctx({ relativeFrame: 12, fps: 24, durationInFrames: 48, unitIndex: 1, unitCount: 3 }),
    )
    const state60 = evalState(
      at60,
      ctx({ relativeFrame: 30, fps: 60, durationInFrames: 120, unitIndex: 1, unitCount: 3 }),
    )
    expect(state24.alpha).toBeCloseTo(state60.alpha, 10)
    expect(state24.dy).toBeCloseTo(state60.dy, 10)
  })

  it('loop phase matches at equivalent wall-clock times across fps', () => {
    const at24: TextMotionSpec = {
      loop: { ...createTextMotionEffect('pulse'), durationFrames: 24 },
    }
    const at60: TextMotionSpec = {
      loop: { ...createTextMotionEffect('pulse'), durationFrames: 60 },
    }
    const state24 = evalState(at24, ctx({ relativeFrame: 18, fps: 24, durationInFrames: 240 }))
    const state60 = evalState(at60, ctx({ relativeFrame: 45, fps: 60, durationInFrames: 600 }))
    expect(state24.scale).toBeCloseTo(state60.scale, 10)
  })
})

describe('evaluateGlyphMotion — loop slot', () => {
  it('starts each cycle at identity and wraps cleanly', () => {
    const spec: TextMotionSpec = {
      loop: { ...createTextMotionEffect('pulse'), durationFrames: 36 },
    }
    // Phase 0 at the loop start → identity fast path.
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 0 }))).toBeNull()
    // Quarter cycle → peak scale.
    expect(evalState(spec, ctx({ relativeFrame: 9 })).scale).toBeCloseTo(1.06, 6)
    // Full cycle wraps back to phase 0 → identity again.
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 36 }))).toBeNull()
  })

  it('runs only between the in and out windows', () => {
    const spec: TextMotionSpec = {
      in: {
        ...createTextMotionEffect('fade-up'),
        durationFrames: 10,
        staggerFrames: 0,
        easing: 'linear',
      },
      loop: { ...createTextMotionEffect('pulse'), durationFrames: 36 },
    }
    // Inside the in window → the in slot, untouched by the loop.
    const entering = evalState(spec, ctx({ relativeFrame: 5 }))
    expect(entering.alpha).toBeCloseTo(0.5, 6)
    expect(entering.scale).toBe(1)
    // Loop phase starts at 0 when the in window ends.
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 10 }))).toBeNull()
    expect(evalState(spec, ctx({ relativeFrame: 19 })).scale).toBeCloseTo(1.06, 6)
  })

  it('yields to the out slot at the out window start', () => {
    const spec: TextMotionSpec = {
      loop: { ...createTextMotionEffect('pulse'), durationFrames: 36 },
      out: {
        ...createTextMotionEffect('fade-down'),
        durationFrames: 10,
        staggerFrames: 0,
        easing: 'linear',
      },
    }
    const base = { durationInFrames: 40, unitCount: 1, unitIndex: 0 }
    const looping = evalState(spec, ctx({ ...base, relativeFrame: 20 }))
    expect(looping.alpha).toBe(1)
    expect(looping.scale).not.toBe(1)
    const exiting = evalState(spec, ctx({ ...base, relativeFrame: 35 }))
    expect(exiting.alpha).toBeCloseTo(0.5, 6)
    expect(exiting.scale).toBe(1)
  })

  it('phase-offsets units by stagger and holds identity until their cycle starts', () => {
    const spec: TextMotionSpec = {
      loop: { ...createTextMotionEffect('wave'), durationFrames: 30, staggerFrames: 3 },
    }
    const base = { unitIndex: 2, unitCount: 5 }
    // rank 2 → delay 6 frames: identity until the unit's own cycle begins.
    expect(evaluateGlyphMotion(spec, ctx({ ...base, relativeFrame: 6 }))).toBeNull()
    expect(evalState(spec, ctx({ ...base, relativeFrame: 13 })).dy).toBeGreaterThan(0)
  })
})

describe('typewriter step behavior', () => {
  it('holds alpha at 0 until per-unit progress completes, then snaps visible', () => {
    const spec: TextMotionSpec = {
      in: { ...createTextMotionEffect('typewriter'), durationFrames: 2, staggerFrames: 3 },
    }
    const unit1 = { unitIndex: 1, unitCount: 4 }
    expect(evalState(spec, ctx({ ...unit1, relativeFrame: 0 })).alpha).toBe(0)
    // Mid-progress (p = 0.5) is still fully hidden — step, not a fade.
    expect(evalState(spec, ctx({ ...unit1, relativeFrame: 4 })).alpha).toBe(0)
    // p = 1 → visible → identity fast path.
    expect(evaluateGlyphMotion(spec, ctx({ ...unit1, relativeFrame: 5 }))).toBeNull()
  })

  it('typewriter-erase reverse-reveals from the end by default', () => {
    const spec: TextMotionSpec = { out: createTextMotionEffect('typewriter-erase') }
    // durationFrames 1, staggerFrames 2, order backward → window 5, start 295.
    const base = { durationInFrames: 300, unitCount: 3 }
    // Last unit (rank 0) erases first…
    expect(evaluateGlyphMotion(spec, ctx({ ...base, unitIndex: 2, relativeFrame: 295 }))).toBeNull()
    expect(evalState(spec, ctx({ ...base, unitIndex: 2, relativeFrame: 296 })).alpha).toBe(0)
    // …while the first unit (rank 2, delay 4) is still visible.
    expect(evaluateGlyphMotion(spec, ctx({ ...base, unitIndex: 0, relativeFrame: 297 }))).toBeNull()
  })
})

describe('preset channel scaling', () => {
  it('scales travel by intensity, clamped to 0–2', () => {
    function riseDy(intensity: number): number {
      const spec: TextMotionSpec = {
        in: {
          ...createTextMotionEffect('rise'),
          durationFrames: 10,
          staggerFrames: 0,
          easing: 'linear',
          intensity,
        },
      }
      return evalState(spec, ctx({ relativeFrame: 5 })).dy
    }
    expect(riseDy(2)).toBeCloseTo(0.5 * 0.6 * 100 * 2, 6)
    expect(riseDy(5)).toBeCloseTo(riseDy(2), 6) // clamped
    expect(riseDy(0)).toBe(0)
  })

  it('slide-mask travels by the box width', () => {
    const spec: TextMotionSpec = { in: createTextMotionEffect('slide-mask') }
    const state = evalState(spec, ctx({ relativeFrame: 0, boxWidth: 800 }))
    expect(state.dx).toBe(-800)
    expect(state.alpha).toBe(1) // masked reveal — no fade
  })

  it('overshoot easing carries scale past 1 before settling back exactly to identity', () => {
    const spec: TextMotionSpec = {
      in: { ...createTextMotionEffect('pop'), durationFrames: 10, staggerFrames: 0 },
    }
    expect(evalState(spec, ctx({ relativeFrame: 8 })).scale).toBeGreaterThan(1)
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 10 }))).toBeNull()
  })
})

describe('isTextMotionActive', () => {
  const inSpec: TextMotionSpec = {
    in: { ...createTextMotionEffect('fade-up'), durationFrames: 10, staggerFrames: 0 },
  }
  const outSpec: TextMotionSpec = {
    out: { ...createTextMotionEffect('fade-down'), durationFrames: 10, staggerFrames: 0 },
  }

  it('is exact at the in window edges when stagger is 0', () => {
    expect(isTextMotionActive(inSpec, 0, 30, 100)).toBe(true)
    expect(isTextMotionActive(inSpec, 9, 30, 100)).toBe(true)
    expect(isTextMotionActive(inSpec, 10, 30, 100)).toBe(false)
    expect(isTextMotionActive(inSpec, 50, 30, 100)).toBe(false)
  })

  it('is exact at the out window edges when stagger is 0', () => {
    expect(isTextMotionActive(outSpec, 89, 30, 100)).toBe(false)
    expect(isTextMotionActive(outSpec, 90, 30, 100)).toBe(true)
    expect(isTextMotionActive(outSpec, 99, 30, 100)).toBe(true)
  })

  it('accounts for delayed in and early out offsets', () => {
    const offsetIn: TextMotionSpec = {
      in: { ...inSpec.in!, offsetFrames: 15 },
    }
    const offsetOut: TextMotionSpec = {
      out: { ...outSpec.out!, offsetFrames: 20 },
    }
    expect(isTextMotionActive(offsetIn, 24, 30, 100)).toBe(true)
    expect(isTextMotionActive(offsetIn, 25, 30, 100)).toBe(false)
    expect(isTextMotionActive(offsetOut, 69, 30, 100)).toBe(false)
    expect(isTextMotionActive(offsetOut, 70, 30, 100)).toBe(true)
    expect(isTextMotionActive(offsetOut, 99, 30, 100)).toBe(true)
  })

  it('is conservative (half-clip) when a stagger is present', () => {
    const staggered: TextMotionSpec = {
      in: { ...createTextMotionEffect('fade-up'), durationFrames: 4, staggerFrames: 2 },
    }
    expect(isTextMotionActive(staggered, 49, 30, 100)).toBe(true)
    expect(isTextMotionActive(staggered, 50, 30, 100)).toBe(false)
  })

  it('reports active whenever a loop slot exists', () => {
    const looping: TextMotionSpec = { loop: createTextMotionEffect('pulse') }
    expect(isTextMotionActive(looping, 0, 30, 100)).toBe(true)
    expect(isTextMotionActive(looping, 99, 30, 100)).toBe(true)
  })

  it('handles empty specs and degenerate frames', () => {
    expect(isTextMotionActive({}, 0, 30, 100)).toBe(false)
    expect(isTextMotionActive(inSpec, -1, 30, 100)).toBe(false)
    expect(isTextMotionActive(inSpec, 0, 30, 0)).toBe(false)
  })
})

describe('getActiveTextMotionSlot', () => {
  const inFx = {
    ...createTextMotionEffect('fade-up'),
    durationFrames: 10,
    staggerFrames: 0,
    easing: 'linear' as const,
  }
  const outFx = {
    ...createTextMotionEffect('fade-down'),
    durationFrames: 10,
    staggerFrames: 0,
    easing: 'linear' as const,
  }

  it('dispatches in → loop → out across the clip', () => {
    const spec: TextMotionSpec = { in: inFx, out: outFx, loop: createTextMotionEffect('pulse') }
    expect(getActiveTextMotionSlot(spec, 0, 100)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 9, 100)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 10, 100)).toBe('loop')
    expect(getActiveTextMotionSlot(spec, 89, 100)).toBe('loop')
    expect(getActiveTextMotionSlot(spec, 90, 100)).toBe('out')
    expect(getActiveTextMotionSlot(spec, 99, 100)).toBe('out')
  })

  it('out wins where compressed windows meet on a short clip', () => {
    // Both slots ask for 100-frame windows on a 20-frame clip; each
    // compresses to 10 — the same overlap case evaluateGlyphMotion clamps.
    const spec: TextMotionSpec = {
      in: { ...inFx, durationFrames: 100 },
      out: { ...outFx, durationFrames: 100 },
    }
    expect(getActiveTextMotionSlot(spec, 9, 20)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 10, 20)).toBe('out')
    expect(getActiveTextMotionSlot(spec, 19, 20)).toBe('out')
  })

  it('returns null when settled and no loop exists', () => {
    const spec: TextMotionSpec = { in: inFx, out: outFx }
    expect(getActiveTextMotionSlot(spec, 50, 100)).toBeNull()
    expect(getActiveTextMotionSlot({}, 0, 100)).toBeNull()
    expect(getActiveTextMotionSlot(spec, 0, 0)).toBeNull()
  })

  it('holds delayed in and early out endpoint states outside their moving windows', () => {
    const spec: TextMotionSpec = {
      in: { ...inFx, offsetFrames: 10 },
      out: { ...outFx, offsetFrames: 15 },
    }

    expect(getActiveTextMotionSlot(spec, 0, 100)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 19, 100)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 20, 100)).toBeNull()
    expect(getActiveTextMotionSlot(spec, 74, 100)).toBeNull()
    expect(getActiveTextMotionSlot(spec, 75, 100)).toBe('out')
    expect(getActiveTextMotionSlot(spec, 99, 100)).toBe('out')

    const beforeIn = evaluateGlyphMotion(spec, ctx({ relativeFrame: 5, durationInFrames: 100 }))
    const afterOut = evaluateGlyphMotion(spec, ctx({ relativeFrame: 90, durationInFrames: 100 }))
    expect(beforeIn?.alpha).toBe(0)
    expect(afterOut?.alpha).toBe(0)
  })

  it('widens staggered windows to the half-clip cap (never drops a stagger tail)', () => {
    const spec: TextMotionSpec = { in: { ...inFx, durationFrames: 4, staggerFrames: 2 } }
    expect(getActiveTextMotionSlot(spec, 49, 100)).toBe('in')
    expect(getActiveTextMotionSlot(spec, 50, 100)).toBeNull()
  })

  it('agrees with evaluateGlyphMotion dispatch when staggers are 0', () => {
    const spec: TextMotionSpec = { in: inFx, out: outFx }
    // Frame 15 on a 20-frame clip: in compresses to [0, 10), out owns
    // [10, 20) — the slot says out, and the evaluator produces the out
    // preset's channels (fade-down travels downward).
    const shortSpec: TextMotionSpec = {
      in: { ...inFx, durationFrames: 100 },
      out: { ...outFx, durationFrames: 100 },
    }
    expect(getActiveTextMotionSlot(shortSpec, 15, 20)).toBe('out')
    const state = evaluateGlyphMotion(shortSpec, ctx({ relativeFrame: 15, durationInFrames: 20 }))
    expect(state?.dy).toBeGreaterThan(0)
    // Settled mid-clip: slot null and evaluator identity, in lockstep.
    expect(getActiveTextMotionSlot(spec, 50, 100)).toBeNull()
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 50, durationInFrames: 100 }))).toBeNull()
  })
})

describe('identity fast path', () => {
  it('returns null between windows when no loop is set', () => {
    const spec: TextMotionSpec = {
      in: { ...createTextMotionEffect('fade-up'), durationFrames: 10, staggerFrames: 0 },
      out: { ...createTextMotionEffect('fade-down'), durationFrames: 10, staggerFrames: 0 },
    }
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 150, durationInFrames: 300 }))).toBeNull()
  })

  it('returns null for an empty spec and degenerate clip durations', () => {
    expect(evaluateGlyphMotion({}, ctx({ relativeFrame: 0 }))).toBeNull()
    const spec: TextMotionSpec = { in: createTextMotionEffect('fade-up') }
    expect(evaluateGlyphMotion(spec, ctx({ relativeFrame: 0, durationInFrames: 0 }))).toBeNull()
  })
})
