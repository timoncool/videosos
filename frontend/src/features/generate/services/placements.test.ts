import { describe, expect, it } from 'vitest'
import { placementsOf } from './placements'
import type { Field, Job, ModelForm } from './generate-api'

const job = (over: Partial<Job>): Job =>
  ({
    id: 'a',
    project_id: 'p',
    provider: 'fal',
    model: 'm',
    model_name: 'Model',
    title: '',
    task: 'video',
    values: {},
    status: 'running',
    progress: 0.5,
    error: null,
    error_code: null,
    estimate: null,
    cost: null,
    cost_source: null,
    outputs: [],
    imported: [],
    place: true,
    place_at: 2,
    origin: 'window',
    created: 0,
    updated: 0,
    ...over,
  }) as Job
const form = (fields: Partial<Field>[]): ModelForm =>
  ({ provider: 'fal', id: 'm', fields }) as unknown as ModelForm

describe('generations drawn on the timeline', () => {
  it('takes the running placed jobs of the open project with the length their duration field asks for', () => {
    const forms = { 'fal:m': form([{ key: 'duration', role: 'duration', default: '5' }]) }
    const jobs = [
      job({ id: 'a', values: { duration: '8' } }),
      job({ id: 'b', status: 'queued', place_at: null }),
      job({ id: 'c', status: 'done' }),
      job({ id: 'd', place: false }),
      job({ id: 'e', project_id: 'other' }),
      job({ id: 'f', task: 'music', provider: 'runware', model: 'x' }),
      job({ id: 'g', task: 'text' }),
    ]
    expect(placementsOf(jobs, 'p', forms)).toEqual([
      {
        id: 'a',
        at: 2,
        seconds: 8,
        lane: 'picture',
        model: 'Model',
        status: 'running',
        progress: 0.5,
      },
      {
        id: 'b',
        at: null,
        seconds: 5,
        lane: 'picture',
        model: 'Model',
        status: 'queued',
        progress: 0.5,
      },
      {
        id: 'f',
        at: 2,
        seconds: null,
        lane: 'sound',
        model: 'Model',
        status: 'running',
        progress: 0.5,
      },
    ])
  })

  it('draws nothing without an open project', () => {
    expect(placementsOf([job({})], null, {})).toEqual([])
  })
})
