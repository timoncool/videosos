import { describe, expect, it } from 'vitest'
import { carryValues } from './batch-values'
import type { Field } from './generate-api'

const field = (key: string, role?: Field['role']): Field => ({ key, label: key, type: 'text', required: false, advanced: false, role }) as Field

describe('carrying a form to another model', () => {
  it('matches fields by what they mean, then by key', () => {
    const from = [field('prompt', 'prompt'), field('negative_prompt', 'negative_prompt'), field('seed', 'seed'), field('style')]
    const to = [field('positivePrompt', 'prompt'), field('negativePrompt', 'negative_prompt'), field('style'), field('steps')]
    const values = { prompt: 'a fox', negative_prompt: 'blur', seed: 7, style: 'film' }
    expect(carryValues(from, values, to)).toEqual({ positivePrompt: 'a fox', negativePrompt: 'blur', style: 'film' })
  })
})
