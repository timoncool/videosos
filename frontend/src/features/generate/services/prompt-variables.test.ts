import { describe, expect, it } from 'vitest'
import { fillVariables, variablesOf } from './prompt-variables'

describe('prompt variables', () => {
  it('lists each variable once, in order, in any text field', () => {
    expect(variablesOf({ prompt: 'a {{subject}} in {{ place }}, {{subject}} again', negative_prompt: 'no {{колір}}', seed: 4 })).toEqual(['subject', 'place', 'колір'])
  })

  it('fills the variables it knows and leaves the others', () => {
    const values = { prompt: '{{subject}} at {{time}}', images: ['x'] }
    expect(fillVariables(values, { subject: 'a fox' })).toEqual({ prompt: 'a fox at {{time}}', images: ['x'] })
  })
})
