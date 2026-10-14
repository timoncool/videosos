import { describe, expect, it } from 'vitest'
import { promptOf, resultFileName, trimTitle } from './result-title'

describe('result names', () => {
  it('takes the prompt, never the negative prompt', () => {
    expect(promptOf({ negative_prompt: 'blur', prompt: 'a lighthouse at dusk' })).toBe('a lighthouse at dusk')
    expect(promptOf({ positivePrompt: 'neon city' })).toBe('neon city')
    expect(promptOf({ image_url: 'x' })).toBeNull()
  })

  it('ends at the first sentence and keeps two phrases', () => {
    expect(trimTitle('A lighthouse at dusk. Waves crash below.')).toBe('A lighthouse at dusk.')
    expect(trimTitle('red fox, snow, morning light, 35mm')).toBe('red fox, snow')
  })

  it('cuts a long prompt on a word', () => {
    const title = trimTitle('an extremely detailed cinematic wide shot of an ancient mountain monastery wrapped in fog')
    expect(title.endsWith('…')).toBe(true)
    expect(Array.from(title).length).toBeLessThanOrEqual(51)
    expect(title).toBe('an extremely detailed cinematic wide shot of an…')
  })

  it('names a file by the title, numbered when there are several, and by the model without a prompt', () => {
    const job = { values: { prompt: 'Кот на крыше: закат?' }, model_name: 'FLUX.1 [schnell]', model: 'runware:100@1' }
    expect(resultFileName(job, 0, 1, 'jpg')).toBe('Кот на крыше закат.jpg')
    expect(resultFileName(job, 1, 2, 'jpg')).toBe('Кот на крыше закат (2).jpg')
    expect(resultFileName({ values: {}, model_name: 'Clarity Upscaler', model: 'fal-ai/clarity' }, 0, 1, 'png')).toBe('Clarity Upscaler.png')
  })
})
