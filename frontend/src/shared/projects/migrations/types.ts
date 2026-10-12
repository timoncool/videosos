/**
 * Migration System Types
 *
 * Defines the structure for version-based project migrations.
 */

import type { Project } from '@/types/project'

/**
 * Current schema version.
 * Increment this when adding a new migration.
 */
export const CURRENT_SCHEMA_VERSION = 15

/**
 * A migration function transforms a project from version N to N+1.
 * Migrations should be pure functions that don't modify the input.
 */
export type MigrationFn = (project: Project) => Project

/**
 * Migration definition with metadata.
 */
export interface Migration {
  /** Target version (the version after this migration runs) */
  version: number
  /** Human-readable description of what this migration does */
  description: string
  /** The migration function */
  migrate: MigrationFn
}

/**
 * Non-fatal problem detected while normalizing a project on load.
 *
 * Normalization silently repairs what it can (e.g. shifting overlapping items),
 * but for programmatically-built projects a silent repair hides authoring bugs —
 * these warnings make the repairs and un-renderable items visible to callers
 * (the headless harness logs them and can fail hard in --strict mode).
 */
export interface ProjectWarning {
  code: 'TRACK_OVERLAP_REPAIRED' | 'SHAPE_MISSING_TYPE'
  message: string
  itemIds?: string[]
  trackId?: string
  /** Sub-composition id when the finding is inside a pre-comp. */
  compositionId?: string
}

/**
 * Result of running migrations on a project.
 */
export interface MigrationResult {
  /** The migrated project */
  project: Project
  /** Whether any migrations were applied */
  migrated: boolean
  /** List of migrations that were applied */
  appliedMigrations: number[]
  /** The original schema version */
  fromVersion: number
  /** The final schema version */
  toVersion: number
  /** Non-fatal findings from normalization (silent repairs, un-renderable items). */
  warnings: ProjectWarning[]
}
