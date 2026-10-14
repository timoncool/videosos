import { describe, expect, it } from 'vitest'
import { aspectOf, sentSeconds, shotValues } from './storyboard'
import type { Field } from './generate-api'

const base = { required: false, advanced: false }
const fields = [
  { ...base, key: 'prompt', label: 'Prompt', type: 'textarea', role: 'prompt' },
  { ...base, key: 'frame', label: 'First frame', type: 'media', media: 'image', min: 0, max: 1, list: true, role: 'first_frame' },
  { ...base, key: 'duration', label: 'Duration', type: 'select', role: 'duration', options: [{ value: '5', label: '5' }, { value: '10', label: '10' }] },
  { ...base, key: 'aspect_ratio', label: 'Aspect', type: 'select', role: 'aspect', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }] },
] as Field[]

describe('a shot in a model form', () => {
  it('fills the prompt, the nearest length, the first frame and the project aspect by what the fields mean', () => {
    expect(shotValues(fields, { prompt: 'a fox runs', seconds: 7, firstFrame: { job: 'j', index: 0 }, aspect: aspectOf(1920, 1080) })).toEqual({
      prompt: 'a fox runs',
      frame: [{ job: 'j', index: 0 }],
      duration: '5',
      aspect_ratio: '16:9',
    })
    expect(shotValues(fields, { prompt: 'x', seconds: 7.5 }).duration).toBe('10')
  })

  it('leaves out an aspect the model does not have and a length a model without duration cannot take', () => {
    expect(shotValues(fields, { prompt: 'x', aspect: '4:3' })).toEqual({ prompt: 'x' })
    const integer = [{ ...base, key: 'seconds', label: 'S', type: 'integer', min: 2, max: 8, role: 'duration' }] as Field[]
    expect(shotValues(integer, { prompt: 'x', seconds: 12 })).toEqual({ seconds: 8 })
  })

  it('knows how long the run is from the value it is sent with', () => {
    expect(sentSeconds(fields, { duration: '10' }, 3)).toBe(10)
    expect(sentSeconds([], {}, 3)).toBe(3)
  })
})
