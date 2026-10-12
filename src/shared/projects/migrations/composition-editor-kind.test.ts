// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index'

function composition(
  id: string,
  editorKind?: 'sequence' | 'composite-2d',
): NonNullable<ProjectTimeline['compositions']>[number] {
  return {
    id,
    name: id,
    ...(editorKind && { editorKind }),
    items: [],
    tracks: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 1,
  }
}

function project(timeline: ProjectTimeline): Project {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: 13,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

describe('composition editor kind migration', () => {
  it('marks legacy compositions as classic sequences and preserves composite-2d', () => {
    const result = migrateProject(
      project({
        tracks: [],
        items: [],
        compositions: [composition('legacy'), composition('motion', 'composite-2d')],
      }),
    )

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.project.timeline?.compositions?.map((entry) => entry.editorKind)).toEqual([
      'sequence',
      'composite-2d',
    ])
  })

  it('keeps composite compositions out of the classic sequence tab registry', () => {
    const result = migrateProject(
      project({
        tracks: [],
        items: [],
        compositions: [composition('sequence'), composition('motion', 'composite-2d')],
        topLevelSequenceIds: ['sequence', 'motion'],
      }),
    )

    expect(result.project.timeline?.topLevelSequenceIds).toEqual(['sequence'])
  })
})
