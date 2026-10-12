// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index'

function emptyComposition(id: string): NonNullable<ProjectTimeline['compositions']>[number] {
  return {
    id,
    name: id,
    items: [],
    tracks: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 1,
  }
}

function baseProject(timeline: ProjectTimeline): Project {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: 12,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

describe('topLevelSequenceIds migration + normalization', () => {
  it('bumps a v12 project to the current schema version', () => {
    const result = migrateProject(baseProject({ tracks: [], items: [] }))
    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('prunes dangling and duplicate tab ids against the compositions registry', () => {
    const result = migrateProject(
      baseProject({
        tracks: [],
        items: [],
        compositions: [emptyComposition('comp-a'), emptyComposition('comp-b')],
        // 'ghost' has no composition; 'comp-a' is duplicated.
        topLevelSequenceIds: ['comp-a', 'ghost', 'comp-b', 'comp-a'],
      }),
    )

    expect(result.project.timeline?.topLevelSequenceIds).toEqual(['comp-a', 'comp-b'])
  })

  it('leaves the field absent when no tabs are declared', () => {
    const result = migrateProject(
      baseProject({ tracks: [], items: [], compositions: [emptyComposition('comp-a')] }),
    )
    expect(result.project.timeline?.topLevelSequenceIds).toBeUndefined()
  })
})
