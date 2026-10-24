/**
 * Checkpoints of the open project's timeline, as WeftCut keeps them for its agent: the timeline is kept on the
 * server before each agent's edit and whenever asked, and going back to one is a single step that undo takes
 * back, after the timeline as it was is kept as a checkpoint too.
 */

import { useProjectStore } from '../deps/projects'
import { buildTimelineFromStores, hydrateTimelineStoresFromProject, saveTimeline } from '../stores/timeline-persistence'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { captureSnapshot } from '../stores/commands/snapshot'
import type { ProjectTimeline } from '@/types/project'

export interface CheckpointSummary {
  id: string
  created: number
  /** `agent` before an agent's edit, `restore` before going back, `asked` when made on purpose. */
  reason: 'agent' | 'restore' | 'asked'
  edits?: number | null
  label?: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`)
  return JSON.parse(text) as T
}

export function listCheckpoints(projectId: string): Promise<CheckpointSummary[]> {
  return request(`/api/checkpoints/${encodeURIComponent(projectId)}`)
}

/** Keeps the timeline as it is now. */
export function keepCheckpoint(projectId: string, reason: CheckpointSummary['reason'], extra: { edits?: number; label?: string } = {}): Promise<CheckpointSummary> {
  return request(`/api/checkpoints/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify({ reason, ...extra, timeline: buildTimelineFromStores() }),
  })
}

/** Brings the open project's timeline back to a checkpoint as one undoable step, keeping the present one first. */
export async function restoreCheckpoint(id: string): Promise<void> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('no project is open')
  const checkpoint = await request<CheckpointSummary & { timeline: ProjectTimeline }>(`/api/checkpoints/${encodeURIComponent(project.id)}/${encodeURIComponent(id)}`)
  await keepCheckpoint(project.id, 'restore')
  const before = captureSnapshot()
  await hydrateTimelineStoresFromProject({ ...project, timeline: checkpoint.timeline })
  useTimelineCommandStore.getState().addUndoEntry({ type: 'RESTORE_CHECKPOINT', payload: { id } }, before)
  await saveTimeline(project.id)
}
