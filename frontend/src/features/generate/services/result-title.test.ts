import { describe, expect, it } from 'vitest'
import { promptOf, resultFileName } from './result-title'

describe('result names', () => {
  it('takes the prompt, never the negative prompt', () => {
    expect(promptOf({ negative_prompt: 'blur', prompt: 'a lighthouse at dusk' })).toBe('a lighthouse at dusk')
    expect(promptOf({ positivePrompt: 'neon city' })).toBe('neon city')
    expect(promptOf({ image_url: 'x' })).toBeNull()
  })

  it('names a file by the title, numbered when there are several', () => {
    expect(resultFileName({ title: 'Кот на крыше: закат?' }, 0, 1, 'jpg')).toBe('Кот на крыше закат.jpg')
    expect(resultFileName({ title: 'A lighthouse at dusk.' }, 1, 2, 'png')).toBe('A lighthouse at dusk (2).png')
  })
})
