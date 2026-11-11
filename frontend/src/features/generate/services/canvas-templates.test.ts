import { describe, expect, it } from 'vitest'
import { connects, type CanvasGraph } from './canvas-graph'
import {
  besideGraph,
  instantiate,
  moveTo,
  readWorkflowFile,
  workflowFile,
  WORKFLOW_TEMPLATES,
} from './canvas-templates'

function counter() {
  let next = 0
  return () => `id${++next}`
}

describe('workflow templates', () => {
  it('make chains whose every edge makes sense, with the chosen models', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = instantiate(
        template,
        { x: 100, y: 50 },
        (task) =>
          task === 'image'
            ? [
                { provider: 'runware', id: 'a' },
                { provider: 'fal', id: 'b' },
              ]
            : [],
        (id, key) => `${id}.${key}`,
        counter(),
      )
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length)
      for (const edge of graph.edges) {
        const source = graph.nodes.find((node) => node.id === edge.source)!
        expect(
          connects(source, edge.targetHandle),
          `${template.id}: ${edge.source} into ${edge.targetHandle}`,
        ).toBe(true)
      }
      expect(Math.min(...graph.nodes.map((node) => node.position.x))).toBe(100)
      for (const node of graph.nodes)
        if (node.type === 'prompt') expect(node.data.text).toMatch(new RegExp(`^${template.id}\\.`))
    }
    const compare = instantiate(
      WORKFLOW_TEMPLATES.find((each) => each.id === 'compareImages')!,
      { x: 0, y: 0 },
      () => [
        { provider: 'runware', id: 'a' },
        { provider: 'fal', id: 'b' },
      ],
      () => '',
      counter(),
    )
    expect(
      compare.nodes
        .filter((node) => node.type === 'generate')
        .map((node) => (node.type === 'generate' ? (node.data.model?.id ?? null) : '')),
    ).toEqual(['a', 'b', null])
  })

  it('go to the right of what is on the canvas', () => {
    expect(besideGraph({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0 })
    const graph: CanvasGraph = {
      nodes: [{ id: 'p', type: 'prompt', position: { x: 200, y: -40 }, data: { text: '' } }],
      edges: [],
    }
    expect(besideGraph(graph)).toEqual({ x: 620, y: -40 })
  })
})

describe('workflow files', () => {
  const graph: CanvasGraph = {
    nodes: [
      {
        id: 'm',
        type: 'media',
        position: { x: 0, y: 0 },
        data: { ref: { media: 'local' }, kind: 'image', name: 'face.png' },
      },
      { id: 'p', type: 'prompt', position: { x: 0, y: 300 }, data: { text: 'Hello' } },
      {
        id: 'g',
        type: 'generate',
        position: { x: 340, y: 0 },
        data: { task: 'lip_sync', model: { provider: 'fal', id: 'x' }, job: 'job1' },
      },
    ],
    edges: [{ id: 'e', source: 'm', target: 'g', targetHandle: 'media' }],
  }

  it('carry the chain and prompts, not the files of this computer and the results', () => {
    const read = readWorkflowFile(workflowFile(graph, 'Talking head'), counter())
    expect(read.name).toBe('Talking head')
    expect(read.graph.nodes.map((node) => node.data)).toEqual([
      { ref: null, kind: 'image', name: '' },
      { text: 'Hello' },
      { task: 'lip_sync', model: { provider: 'fal', id: 'x' }, job: null },
    ])
    expect(read.graph.edges).toEqual([
      { id: 'id4', source: 'id1', target: 'id3', targetHandle: 'media' },
    ])
    expect(moveTo(read.graph, { x: 1000, y: 10 }).nodes[1]!.position).toEqual({ x: 1000, y: 310 })
  })

  it('name what is wrong in a file', () => {
    expect(() => readWorkflowFile('{}', counter())).toThrow('not a videosos-workflow file')
    expect(() => readWorkflowFile('not json', counter())).toThrow('the workflow file is not valid')
    const broken = JSON.parse(workflowFile(graph, 'x'))
    broken.graph.edges[0].target = 'nowhere'
    expect(() => readWorkflowFile(JSON.stringify(broken), counter())).toThrow('edge 1 joins nodes')
    const crossed = JSON.parse(workflowFile(graph, 'x'))
    crossed.graph.edges[0].source = 'p'
    expect(() => readWorkflowFile(JSON.stringify(crossed), counter())).toThrow(
      'passes a prompt node',
    )
    broken.graph.nodes[2].data.task = 'teleport'
    expect(() => readWorkflowFile(JSON.stringify(broken), counter())).toThrow(
      'unknown task teleport',
    )
  })
})
