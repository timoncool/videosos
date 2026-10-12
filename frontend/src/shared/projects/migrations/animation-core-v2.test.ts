// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { CURRENT_SCHEMA_VERSION, migrateProject } from './index'

describe('Animation Core v2 migration', () => {
  it('versions root and composition animation records without rewriting scalar lanes', () => {
    const scalarLane = {
      itemId: 'item-1',
      properties: [
        {
          property: 'x' as const,
          keyframes: [{ id: 'x-1', frame: 0, value: 42, easing: 'linear' as const }],
        },
      ],
    }
    const project: Project = {
      id: 'project-1',
      name: 'Project',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 1,
      schemaVersion: 14,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [],
        items: [],
        keyframes: [scalarLane],
        compositions: [
          {
            id: 'comp-1',
            name: 'Comp',
            items: [],
            tracks: [],
            keyframes: [{ ...scalarLane, itemId: 'nested-1' }],
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 30,
          },
        ],
      },
    }

    const result = migrateProject(project)

    expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.appliedMigrations).toEqual([15])
    expect(result.project.timeline?.keyframes?.[0]).toMatchObject({
      animationVersion: 2,
      properties: scalarLane.properties,
    })
    expect(result.project.timeline?.compositions?.[0]?.keyframes?.[0]?.animationVersion).toBe(2)
  })
})
