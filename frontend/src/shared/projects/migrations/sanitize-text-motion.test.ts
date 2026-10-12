// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { TextMotionSpec } from '@/types/text-motion'
import { sanitizeTextMotion } from './sanitize-text-motion'
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index'

function validSpec(): TextMotionSpec {
  return {
    in: {
      presetId: 'fade-up',
      durationFrames: 12,
      staggerFrames: 2,
      intensity: 1.5,
      order: 'random',
      easing: 'overshoot',
      seed: 42,
    },
    out: {
      presetId: 'sink',
      durationFrames: 8,
      staggerFrames: 0,
      intensity: 0,
      order: 'backward',
      easing: 'linear',
      seed: -3,
    },
    loop: {
      presetId: 'pulse',
      durationFrames: 30,
      staggerFrames: 5,
      intensity: 2,
      order: 'center',
      easing: 'ease-in-out',
      seed: 0,
    },
  }
}

describe('sanitizeTextMotion', () => {
  it('passes a fully valid spec through unchanged', () => {
    const spec = validSpec()
    expect(sanitizeTextMotion(spec)).toEqual(spec)
  })

  it('keeps a valid unit override and drops an invalid one', () => {
    const base = validSpec().in!
    const result = sanitizeTextMotion({
      in: { ...base, unit: 'whole-clip' },
      out: { ...validSpec().out!, unit: 'sentence' }, // not a valid unit
    })
    expect(result?.in).toMatchObject({ unit: 'whole-clip' })
    expect(result?.out && 'unit' in result.out).toBe(false)
  })

  it('returns undefined for non-object values', () => {
    expect(sanitizeTextMotion(undefined)).toBeUndefined()
    expect(sanitizeTextMotion(null)).toBeUndefined()
    expect(sanitizeTextMotion('fade-up')).toBeUndefined()
    expect(sanitizeTextMotion(7)).toBeUndefined()
    expect(sanitizeTextMotion([validSpec().in])).toBeUndefined()
  })

  it('drops malformed slots and keeps valid ones', () => {
    const spec = validSpec()
    const result = sanitizeTextMotion({
      in: 'typewriter', // not an object
      out: spec.out,
      loop: [spec.loop], // array is not a slot
    })
    expect(result).toEqual({ out: spec.out })
  })

  it('drops slots whose presetId is not in that slot list (including cross-slot ids)', () => {
    const base = validSpec().in!
    const result = sanitizeTextMotion({
      in: { ...base, presetId: 'pulse' }, // loop preset in the in slot
      out: { ...base, presetId: 'nonsense' },
      loop: { ...base, presetId: 'wave' },
    })
    expect(result).toEqual({
      loop: expect.objectContaining({ presetId: 'wave' }),
    })
  })

  it('clamps numerics to their valid ranges', () => {
    const result = sanitizeTextMotion({
      in: {
        presetId: 'pop',
        durationFrames: 0,
        offsetFrames: -12,
        staggerFrames: -4,
        intensity: 99,
        order: 'forward',
        easing: 'ease-out',
        seed: 3.7,
      },
      out: {
        presetId: 'blur-out',
        durationFrames: 9.4,
        offsetFrames: 14.6,
        staggerFrames: 2.6,
        intensity: -1,
        order: 'forward',
        easing: 'ease-out',
        seed: Number.POSITIVE_INFINITY,
      },
    })
    expect(result?.in).toEqual({
      presetId: 'pop',
      durationFrames: 1, // int >= 1
      staggerFrames: 0, // int >= 0
      intensity: 2, // 0..2
      order: 'forward',
      easing: 'ease-out',
      seed: 4, // rounded to int
    })
    expect(result?.out).toEqual({
      presetId: 'blur-out',
      durationFrames: 9,
      offsetFrames: 15,
      staggerFrames: 3,
      intensity: 0,
      order: 'forward',
      easing: 'ease-out',
      seed: 0, // non-finite falls back
    })
  })

  it('applies defaults for missing numeric fields and strips unknown keys', () => {
    const result = sanitizeTextMotion({
      in: { presetId: 'typewriter', bogusField: true },
    })
    expect(result).toEqual({
      in: {
        presetId: 'typewriter',
        durationFrames: 12,
        staggerFrames: 0,
        intensity: 1,
        order: 'forward',
        easing: 'ease-out',
        seed: 0,
      },
    })
  })

  it('falls back to forward/ease-out for out-of-enum order and easing', () => {
    const result = sanitizeTextMotion({
      loop: {
        presetId: 'shimmer',
        durationFrames: 20,
        staggerFrames: 1,
        intensity: 1,
        order: 'sideways',
        easing: 'spring',
        seed: 5,
      },
    })
    expect(result?.loop?.order).toBe('forward')
    expect(result?.loop?.easing).toBe('ease-out')
  })

  it('collapses to undefined when no slots survive', () => {
    expect(sanitizeTextMotion({})).toBeUndefined()
    expect(sanitizeTextMotion({ in: { presetId: 'not-a-preset' }, out: 12 })).toBeUndefined()
  })
})

function createTrack(id: string): ProjectTimeline['tracks'][number] {
  return {
    id,
    name: id,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
  }
}

function createProjectAtVersion(schemaVersion: number, timeline: ProjectTimeline): Project {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

function textItemWith(id: string, textMotion: unknown): ProjectTimeline['items'][number] {
  return {
    id,
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: id,
    type: 'text',
    text: 'Hello',
    textMotion: textMotion as TextMotionSpec,
  }
}

describe('migration v12: textMotion sanitization', () => {
  it('bumps old projects to the current schema version and sanitizes textMotion', () => {
    const spec = validSpec()
    const project = createProjectAtVersion(11, {
      tracks: [createTrack('track-1')],
      items: [
        textItemWith('text-valid', spec),
        textItemWith('text-broken', {
          in: { presetId: 'not-a-real-preset', durationFrames: 12 },
          loop: {
            presetId: 'swing',
            durationFrames: -5,
            staggerFrames: 1,
            intensity: 3,
            order: 'forward',
            easing: 'ease-out',
            seed: 1,
          },
        }),
      ],
      compositions: [
        {
          id: 'comp-1',
          name: 'Comp 1',
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 60,
          tracks: [createTrack('track-1')],
          items: [textItemWith('comp-text', { in: 'garbage', out: null })],
        },
      ],
    })

    const result = migrateProject(project)
    expect(result.migrated).toBe(true)
    expect(result.appliedMigrations).toContain(12)
    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)

    const itemById = Object.fromEntries(
      result.project.timeline!.items.map((item) => [item.id, item]),
    )
    // Valid spec is preserved
    expect(itemById['text-valid']?.textMotion).toEqual(spec)
    // Unknown preset slot dropped, loop numerics clamped
    expect(itemById['text-broken']?.textMotion).toEqual({
      loop: expect.objectContaining({ presetId: 'swing', durationFrames: 1, intensity: 2 }),
    })
    // Composition text items are walked too — empty spec collapses to undefined
    expect(result.project.timeline?.compositions?.[0]?.items[0]?.textMotion).toBeUndefined()
  })

  it('sanitizes textMotion via normalization even when the project is already at the current version', () => {
    const project = createProjectAtVersion(CURRENT_SCHEMA_VERSION, {
      tracks: [createTrack('track-1')],
      items: [textItemWith('text-1', { in: { presetId: 'bogus' } })],
    })

    const result = migrateProject(project)
    expect(result.appliedMigrations).toEqual([])
    expect(result.project.timeline?.items[0]?.textMotion).toBeUndefined()
  })
})
