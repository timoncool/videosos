/**
 * The generations of the open project that will land on its timeline, as the timeline draws them while they
 * run: where, how long the result is asked to be (the model's duration field) and on which kind of track.
 */

import type { GenerationPlacement } from '@/shared/state/generation-placements-store'
import type { Job, ModelForm, Task } from './generate-api'
import { modelKey } from '../stores/generate-store'

const SOUND: Task[] = ['music', 'speech', 'sound']
const NO_MEDIA: Task[] = ['text', 'transcribe']

function secondsOf(job: Job, form: ModelForm | undefined): number | null {
  const field = form?.fields.find((each) => each.role === 'duration')
  if (!field) return null
  const value = job.values[field.key] ?? field.default
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

export function placementsOf(jobs: Job[], projectId: string | null, forms: Record<string, ModelForm>): GenerationPlacement[] {
  return jobs.flatMap((job) => {
    if (!job.place || !projectId || job.project_id !== projectId || NO_MEDIA.includes(job.task as Task)) return []
    if (job.status !== 'queued' && job.status !== 'sending' && job.status !== 'running') return []
    return [{
      id: job.id,
      at: job.place_at,
      seconds: secondsOf(job, forms[modelKey(job.provider, job.model)]),
      lane: SOUND.includes(job.task as Task) ? 'sound' : 'picture',
      model: job.model_name,
      status: job.status,
      progress: job.progress,
    }]
  })
}
