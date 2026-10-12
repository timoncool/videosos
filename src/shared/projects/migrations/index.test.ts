// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index'
import { getMigrationsToApply } from './migrations'

function createTrack(
  id: string,
  order: number,
  kind: 'video' | 'audio',
): ProjectTimeline['tracks'][number] {
  return {
    id,
    name: id,
    kind,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
  }
}

function createBaseProject(timeline: ProjectTimeline): Project {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 7,
    metadata: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline,
  }
}

describe('migrateProject transition normalization', () => {
  it('converts legacy overlap transitions back to adjacent cuts and restores linked audio alignment', () => {
    const project = createBaseProject({
      tracks: [createTrack('video-track', 0, 'video'), createTrack('audio-track', 1, 'audio')],
      items: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'video-track',
          from: 0,
          durationInFrames: 50,
          label: 'Video 1',
          src: 'video-1.mp4',
          mediaId: 'media-1',
          linkedGroupId: 'group-1',
          sourceStart: 0,
          sourceEnd: 80,
          sourceDuration: 100,
        },
        {
          id: 'video-2',
          type: 'video',
          trackId: 'video-track',
          from: 30,
          durationInFrames: 50,
          label: 'Video 2',
          src: 'video-2.mp4',
          mediaId: 'media-2',
          linkedGroupId: 'group-2',
          sourceStart: 20,
          sourceEnd: 70,
          sourceDuration: 100,
        },
        {
          id: 'video-3',
          type: 'video',
          trackId: 'video-track',
          from: 80,
          durationInFrames: 30,
          label: 'Video 3',
          src: 'video-3.mp4',
          mediaId: 'media-3',
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
        },
        {
          id: 'audio-1',
          type: 'audio',
          trackId: 'audio-track',
          from: 0,
          durationInFrames: 50,
          label: 'Audio 1',
          src: 'audio-1.wav',
          mediaId: 'media-1',
          linkedGroupId: 'group-1',
          sourceStart: 0,
          sourceEnd: 80,
          sourceDuration: 100,
        },
        {
          id: 'audio-2',
          type: 'audio',
          trackId: 'audio-track',
          from: 30,
          durationInFrames: 50,
          label: 'Audio 2',
          src: 'audio-2.wav',
          mediaId: 'media-2',
          linkedGroupId: 'group-2',
          sourceStart: 20,
          sourceEnd: 70,
          sourceDuration: 100,
        },
        {
          id: 'audio-3',
          type: 'audio',
          trackId: 'audio-track',
          from: 80,
          durationInFrames: 30,
          label: 'Audio 3',
          src: 'audio-3.wav',
          mediaId: 'media-3',
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'video-track',
          durationInFrames: 20,
          presentation: 'fade',
          timing: 'linear',
          alignment: 0.5,
        },
      ],
    })

    const result = migrateProject(project)
    const itemById = Object.fromEntries(
      result.project.timeline!.items.map((item) => [item.id, item]),
    )

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(itemById['video-2']?.from).toBe(50)
    expect(itemById['video-3']?.from).toBe(100)
    expect(itemById['audio-2']?.from).toBe(50)
    expect(itemById['audio-3']?.from).toBe(100)
    expect(result.project.timeline?.transitions).toEqual([
      expect.objectContaining({ id: 'transition-1', durationInFrames: 20 }),
    ])
  })

  it('drops legacy overlap transitions that do not have enough source handle after normalization', () => {
    const project = createBaseProject({
      tracks: [createTrack('video-track', 0, 'video')],
      items: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'video-track',
          from: 0,
          durationInFrames: 50,
          label: 'Video 1',
          src: 'video-1.mp4',
          mediaId: 'media-1',
          sourceStart: 0,
          sourceEnd: 50,
          sourceDuration: 50,
        },
        {
          id: 'video-2',
          type: 'video',
          trackId: 'video-track',
          from: 30,
          durationInFrames: 50,
          label: 'Video 2',
          src: 'video-2.mp4',
          mediaId: 'media-2',
          sourceStart: 0,
          sourceEnd: 50,
          sourceDuration: 50,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'video-track',
          durationInFrames: 20,
          presentation: 'fade',
          timing: 'linear',
          alignment: 0.5,
        },
      ],
    })

    const result = migrateProject(project)
    const itemById = Object.fromEntries(
      result.project.timeline!.items.map((item) => [item.id, item]),
    )

    expect(itemById['video-2']?.from).toBe(50)
    expect(result.project.timeline?.transitions).toEqual([])
  })

  it('normalizes legacy overlap transitions inside sub-compositions', () => {
    const project = createBaseProject({
      tracks: [createTrack('root-video-track', 0, 'video')],
      items: [],
      transitions: [],
      compositions: [
        {
          id: 'comp-1',
          name: 'Comp 1',
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 120,
          tracks: [createTrack('comp-video-track', 0, 'video')],
          items: [
            {
              id: 'comp-video-1',
              type: 'video',
              trackId: 'comp-video-track',
              from: 0,
              durationInFrames: 40,
              label: 'Comp Video 1',
              src: 'comp-video-1.mp4',
              sourceStart: 0,
              sourceEnd: 60,
              sourceDuration: 80,
            },
            {
              id: 'comp-video-2',
              type: 'video',
              trackId: 'comp-video-track',
              from: 20,
              durationInFrames: 40,
              label: 'Comp Video 2',
              src: 'comp-video-2.mp4',
              sourceStart: 20,
              sourceEnd: 60,
              sourceDuration: 80,
            },
          ],
          transitions: [
            {
              id: 'comp-transition-1',
              type: 'crossfade',
              leftClipId: 'comp-video-1',
              rightClipId: 'comp-video-2',
              trackId: 'comp-video-track',
              durationInFrames: 20,
              presentation: 'fade',
              timing: 'linear',
              alignment: 0.5,
            },
          ],
        },
      ],
    })

    const result = migrateProject(project)
    const composition = result.project.timeline?.compositions?.[0]
    const itemById = Object.fromEntries((composition?.items ?? []).map((item) => [item.id, item]))

    expect(itemById['comp-video-2']?.from).toBe(40)
    expect(composition?.transitions).toEqual([
      expect.objectContaining({ id: 'comp-transition-1', durationInFrames: 20 }),
    ])
  })

  it('normalizes legacy spring transition timing to linear', () => {
    const project = createBaseProject({
      tracks: [createTrack('video-track', 0, 'video')],
      items: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'video-track',
          from: 0,
          durationInFrames: 40,
          label: 'Video 1',
          src: 'video-1.mp4',
          mediaId: 'media-1',
          sourceStart: 0,
          sourceEnd: 60,
          sourceDuration: 80,
        },
        {
          id: 'video-2',
          type: 'video',
          trackId: 'video-track',
          from: 40,
          durationInFrames: 40,
          label: 'Video 2',
          src: 'video-2.mp4',
          mediaId: 'media-2',
          sourceStart: 20,
          sourceEnd: 60,
          sourceDuration: 80,
        },
      ],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'video-1',
          rightClipId: 'video-2',
          trackId: 'video-track',
          durationInFrames: 12,
          presentation: 'fade',
          timing: 'spring' as unknown as NonNullable<
            ProjectTimeline['transitions']
          >[number]['timing'],
          alignment: 0.5,
        },
      ],
    })

    const result = migrateProject(project)

    expect(result.project.timeline?.transitions?.[0]?.timing).toBe('linear')
  })

  it('renumbers legacy track orders and backfills missing origin ids', () => {
    const project = createBaseProject({
      tracks: [
        createTrack('video-top', -2, 'video'),
        createTrack('video-main', 4, 'video'),
        createTrack('audio-main', 9, 'audio'),
      ],
      items: [
        {
          id: 'composition-1',
          type: 'composition',
          trackId: 'video-main',
          from: 0,
          durationInFrames: 60,
          label: 'Legacy comp',
          compositionId: 'comp-1',
          compositionWidth: 1920,
          compositionHeight: 1080,
        },
      ],
      transitions: [],
      compositions: [
        {
          id: 'comp-1',
          name: 'Comp 1',
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 60,
          tracks: [createTrack('comp-video', 7, 'video'), createTrack('comp-audio', 12, 'audio')],
          items: [
            {
              id: 'comp-video-1',
              type: 'video',
              trackId: 'comp-video',
              from: 0,
              durationInFrames: 60,
              label: 'Comp Video',
              src: 'comp-video.mp4',
              mediaId: 'media-1',
            },
          ],
        },
      ],
    })

    const result = migrateProject(project)

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(
      result.project.timeline?.tracks.map((track) => ({ id: track.id, order: track.order })),
    ).toEqual([
      { id: 'video-top', order: 0 },
      { id: 'video-main', order: 1 },
      { id: 'audio-main', order: 2 },
    ])
    expect(result.project.timeline?.items[0]?.originId).toBe('composition-1')
    expect(
      result.project.timeline?.compositions?.[0]?.tracks.map((track) => ({
        id: track.id,
        order: track.order,
      })),
    ).toEqual([
      { id: 'comp-video', order: 0 },
      { id: 'comp-audio', order: 1 },
    ])
    expect(result.project.timeline?.compositions?.[0]?.items[0]?.originId).toBe('comp-video-1')
  })

  it('preserves legacy array order when tracks are missing explicit order values', () => {
    const project = createBaseProject({
      tracks: [
        {
          ...createTrack('video-top', 0, 'video'),
          order: undefined,
        } as unknown as ProjectTimeline['tracks'][number],
        {
          ...createTrack('audio-main', 1, 'audio'),
          order: undefined,
        } as unknown as ProjectTimeline['tracks'][number],
        {
          ...createTrack('video-overlay', 2, 'video'),
          order: undefined,
        } as unknown as ProjectTimeline['tracks'][number],
      ],
      items: [],
      transitions: [],
    })

    const result = migrateProject(project)

    expect(result.project.timeline?.tracks.map((track) => track.id)).toEqual([
      'video-top',
      'audio-main',
      'video-overlay',
    ])
    expect(result.project.timeline?.tracks.map((track) => track.order)).toEqual([0, 1, 2])
  })
})

describe('migrateProject validation warnings', () => {
  it('reports a TRACK_OVERLAP_REPAIRED warning with both item ids when items overlap', () => {
    const project = createBaseProject({
      tracks: [createTrack('t-ov', 0, 'video')],
      items: [
        {
          id: 'ov_a',
          type: 'text',
          trackId: 't-ov',
          from: 0,
          durationInFrames: 50,
          label: 'A',
          text: 'A',
          color: '#fff',
        },
        {
          id: 'ov_b',
          type: 'text',
          trackId: 't-ov',
          from: 0,
          durationInFrames: 50,
          label: 'B',
          text: 'B',
          color: '#fff',
        },
      ] as ProjectTimeline['items'],
      transitions: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as unknown as ProjectTimeline)

    const result = migrateProject(project)

    const overlap = result.warnings.filter((w) => w.code === 'TRACK_OVERLAP_REPAIRED')
    expect(overlap).toHaveLength(1)
    expect(overlap[0]!.itemIds).toEqual(['ov_a', 'ov_b'])
    expect(overlap[0]!.trackId).toBe('t-ov')
    // The repair itself is unchanged: the later item is shifted, not dropped.
    const shifted = result.project.timeline!.items.find((item) => item.id === 'ov_b')!
    expect(shifted.from).toBe(50)
  })

  it('reports SHAPE_MISSING_TYPE for a shape item without shapeType', () => {
    const project = createBaseProject({
      tracks: [createTrack('t-bg', 0, 'video')],
      items: [
        {
          id: 'bg',
          type: 'shape',
          trackId: 't-bg',
          from: 0,
          durationInFrames: 50,
          label: 'bg',
          // shapeType deliberately missing — the renderer draws nothing.
          fillColor: '#0B0E14',
        },
      ] as unknown as ProjectTimeline['items'],
      transitions: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as unknown as ProjectTimeline)

    const result = migrateProject(project)

    const shape = result.warnings.filter((w) => w.code === 'SHAPE_MISSING_TYPE')
    expect(shape).toHaveLength(1)
    expect(shape[0]!.itemIds).toEqual(['bg'])
  })

  it('collects no warnings for a clean timeline', () => {
    const project = createBaseProject({
      tracks: [createTrack('t-1', 0, 'video')],
      items: [
        {
          id: 'ok',
          type: 'text',
          trackId: 't-1',
          from: 0,
          durationInFrames: 50,
          label: 'ok',
          text: 'ok',
          color: '#fff',
        },
      ] as ProjectTimeline['items'],
      transitions: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as unknown as ProjectTimeline)

    expect(migrateProject(project).warnings).toEqual([])
  })
})

describe('migration v5: transitions virtual-window → FCP overlap model', () => {
  function v4Project(rightFrom: number, transitionFrames: number): Project {
    return {
      ...createBaseProject({
        tracks: [createTrack('t-v', 0, 'video')],
        items: [
          {
            id: 'left',
            type: 'video',
            trackId: 't-v',
            from: 0,
            durationInFrames: 60,
            label: 'L',
            src: 'l.mp4',
            mediaId: 'm1',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 300,
          },
          {
            id: 'right',
            type: 'video',
            trackId: 't-v',
            from: rightFrom,
            durationInFrames: 60,
            label: 'R',
            src: 'r.mp4',
            mediaId: 'm2',
            sourceStart: 100,
            sourceEnd: 160,
            sourceDuration: 300,
          },
          {
            id: 'tail',
            type: 'video',
            trackId: 't-v',
            from: rightFrom + 60,
            durationInFrames: 30,
            label: 'T',
            src: 't.mp4',
            mediaId: 'm3',
            sourceStart: 0,
            sourceEnd: 30,
            sourceDuration: 300,
          },
        ],
        transitions: [
          {
            id: 'tr',
            type: 'fade',
            presentation: 'fade',
            timing: 'linear',
            leftClipId: 'left',
            rightClipId: 'right',
            trackId: 't-v',
            durationInFrames: transitionFrames,
          },
        ],
        currentFrame: 0,
        zoomLevel: 1,
        scrollPosition: 0,
      } as unknown as ProjectTimeline),
      schemaVersion: 4,
    }
  }

  const applyV5 = (project: Project): Project => {
    const migration = getMigrationsToApply(4, 5)[0]!
    return migration.migrate(project)
  }

  it('slides the right clip left by the transition duration and ripples the tail', () => {
    const project = applyV5(v4Project(60, 10))
    const items = Object.fromEntries(project.timeline!.items.map((i) => [i.id, i]))
    expect(items['right']!.from).toBe(50) // 60 − 10 overlap
    expect(items['tail']!.from).toBe(110) // rippled left with it
    // sourceStart stays: the first D source frames become the transition-in.
    expect((items['right'] as { sourceStart?: number }).sourceStart).toBe(100)
  })

  it('clamps the transition to the shorter clip minus one frame', () => {
    const project = applyV5(v4Project(60, 90))
    const transition = project.timeline!.transitions![0]!
    expect(transition.durationInFrames).toBe(59) // min(60,60) − 1
  })

  it('leaves already-overlapping (post-v5) clips untouched', () => {
    const project = applyV5(v4Project(45, 10)) // already overlaps by 15
    const items = Object.fromEntries(project.timeline!.items.map((i) => [i.id, i]))
    expect(items['right']!.from).toBe(45)
  })
})

describe('migration v6: legacy effects → GPU shader effects', () => {
  function v5ProjectWithEffects(effects: unknown[]): Project {
    return {
      ...createBaseProject({
        tracks: [createTrack('t-v', 0, 'video')],
        items: [
          {
            id: 'clip',
            type: 'video',
            trackId: 't-v',
            from: 0,
            durationInFrames: 30,
            label: 'C',
            src: 'c.mp4',
            mediaId: 'm1',
            effects,
          },
        ],
        transitions: [],
        currentFrame: 0,
        zoomLevel: 1,
        scrollPosition: 0,
      } as unknown as ProjectTimeline),
      schemaVersion: 5,
    }
  }

  function effectsOf(project: Project): Array<{ effect: Record<string, unknown> }> {
    return (
      project.timeline!.items[0] as unknown as {
        effects: Array<{ effect: Record<string, unknown> }>
      }
    ).effects
  }

  const applyV6 = (project: Project): Project => getMigrationsToApply(5, 6)[0]!.migrate(project)

  it('converts css-filter brightness/blur with the documented param math', () => {
    const project = applyV6(
      v5ProjectWithEffects([
        {
          id: 'e1',
          enabled: true,
          effect: { type: 'css-filter', filter: 'brightness', value: 150 },
        },
        { id: 'e2', enabled: true, effect: { type: 'css-filter', filter: 'blur', value: 8 } },
      ]),
    )
    const effects = effectsOf(project)
    expect(effects[0]!.effect).toMatchObject({
      type: 'gpu-effect',
      gpuEffectType: 'gpu-brightness',
      params: { amount: 0.5 }, // (150 − 100) / 100
    })
    expect(effects[1]!.effect).toMatchObject({
      type: 'gpu-effect',
      gpuEffectType: 'gpu-gaussian-blur',
      params: { radius: 8 },
    })
  })

  it('passes existing gpu-effect entries through unchanged', () => {
    const gpu = { type: 'gpu-effect', gpuEffectType: 'gpu-sepia', params: { amount: 0.4 } }
    const project = applyV6(v5ProjectWithEffects([{ id: 'e1', enabled: false, effect: gpu }]))
    expect(effectsOf(project)[0]!.effect).toEqual(gpu)
  })
})
