import { describe, expect, it } from 'vitest'
import { connects, nodeValues, type CanvasGraph } from './canvas-graph'
import type { Field, Job } from './generate-api'

const base = { required: false, advanced: false }
const video = [
  { ...base, key: 'prompt', label: 'Prompt', type: 'textarea', role: 'prompt' },
  {
    ...base,
    key: 'refs',
    label: 'References',
    type: 'media',
    media: 'image',
    min: 0,
    max: 2,
    list: true,
    role: 'reference',
  },
  {
    ...base,
    key: 'frame',
    label: 'First frame',
    type: 'media',
    media: 'image',
    min: 0,
    max: 1,
    list: true,
    role: 'first_frame',
  },
] as Field[]

const done = (id: string, kind: 'image' | 'text', text?: string) =>
  ({
    id,
    status: 'done',
    outputs: [{ index: 0, kind, file: 'x', mime: '', size: 0, text }],
  }) as unknown as Job

describe('the node canvas', () => {
  const graph: CanvasGraph = {
    nodes: [
      { id: 'p', type: 'prompt', position: { x: 0, y: 0 }, data: { text: 'a fox runs' } },
      {
        id: 'm',
        type: 'media',
        position: { x: 0, y: 0 },
        data: { ref: { media: 'a' }, kind: 'image', name: 'a.png' },
      },
      {
        id: 'g1',
        type: 'generate',
        position: { x: 0, y: 0 },
        data: { task: 'image', model: null, job: 'j1' },
      },
      {
        id: 'g0',
        type: 'generate',
        position: { x: 0, y: 0 },
        data: { task: 'image', model: null, job: null },
      },
      {
        id: 'v',
        type: 'generate',
        position: { x: 0, y: 0 },
        data: { task: 'video', model: null, job: null },
      },
    ],
    edges: [
      { id: '1', source: 'p', target: 'v', targetHandle: 'prompt' },
      { id: '2', source: 'm', target: 'v', targetHandle: 'media' },
      { id: '3', source: 'g1', target: 'v', targetHandle: 'media' },
      { id: '4', source: 'g0', target: 'v', targetHandle: 'media' },
    ],
  }

  it('fills the prompt and puts files in the slots by meaning, the first frame first', () => {
    const { values, waiting, left } = nodeValues(
      graph,
      'v',
      video,
      new Map([['j1', done('j1', 'image')]]),
    )
    expect(values).toEqual({
      prompt: 'a fox runs',
      frame: [{ media: 'a' }],
      refs: [{ job: 'j1', index: 0 }],
    })
    expect(waiting).toEqual(['g0'])
    expect(left).toBe(0)
  })

  it('takes text into prompts and files into file slots only', () => {
    expect(connects(graph.nodes[0]!, 'prompt')).toBe(true)
    expect(connects(graph.nodes[0]!, 'media')).toBe(false)
    expect(connects(graph.nodes[1]!, 'media')).toBe(true)
    expect(
      connects(
        {
          id: 't',
          type: 'generate',
          position: { x: 0, y: 0 },
          data: { task: 'text', model: null, job: null },
        },
        'prompt',
      ),
    ).toBe(true)
  })
})
