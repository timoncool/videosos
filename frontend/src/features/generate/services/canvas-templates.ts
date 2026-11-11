/**
 * Ready workflows for the node canvas, as Weave's templates and Bulka's example patterns: a chain of nodes put
 * on the canvas in one go, its models the ones chosen for each task in the panel and its prompts in the person's
 * language. A canvas is also kept as a
 * workflow file to pass to someone else and put on their canvas: prompts and the chain travel, the files of this
 * computer and the results do not.
 */

import type { MediaKind, Task } from './generate-api'
import {
  connects,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
  type Position,
} from './canvas-graph'
import type { ModelRef } from '../stores/generate-store'

type TemplateNode =
  | { key: string; type: 'prompt'; at: Position }
  | { key: string; type: 'media'; at: Position; kind: MediaKind }
  | {
      key: string
      type: 'generate'
      at: Position
      task: Task
      /** Which of the task's chosen models: 0 the panel's, then the compared ones. */ pick?: number
    }

export interface WorkflowTemplate {
  id: string
  nodes: TemplateNode[]
  edges: Array<{ from: string; to: string; into: 'prompt' | 'media' }>
}

const COLUMN = 340
const ROW = 300

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'frameToVideo',
    nodes: [
      {
        key: 'idea',
        type: 'prompt',
        at: { x: 0, y: 0 },
      },
      { key: 'frame', type: 'generate', at: { x: COLUMN, y: 0 }, task: 'image' },
      {
        key: 'motion',
        type: 'prompt',
        at: { x: COLUMN, y: ROW },
      },
      { key: 'clip', type: 'generate', at: { x: COLUMN * 2, y: 0 }, task: 'video' },
    ],
    edges: [
      { from: 'idea', to: 'frame', into: 'prompt' },
      { from: 'frame', to: 'clip', into: 'media' },
      { from: 'motion', to: 'clip', into: 'prompt' },
    ],
  },
  {
    id: 'compareImages',
    nodes: [
      {
        key: 'idea',
        type: 'prompt',
        at: { x: 0, y: ROW },
      },
      { key: 'a', type: 'generate', at: { x: COLUMN, y: 0 }, task: 'image', pick: 0 },
      { key: 'b', type: 'generate', at: { x: COLUMN, y: ROW }, task: 'image', pick: 1 },
      { key: 'c', type: 'generate', at: { x: COLUMN, y: ROW * 2 }, task: 'image', pick: 2 },
    ],
    edges: [
      { from: 'idea', to: 'a', into: 'prompt' },
      { from: 'idea', to: 'b', into: 'prompt' },
      { from: 'idea', to: 'c', into: 'prompt' },
    ],
  },
  {
    id: 'promptWriter',
    nodes: [
      {
        key: 'idea',
        type: 'prompt',
        at: { x: 0, y: 0 },
      },
      { key: 'writer', type: 'generate', at: { x: COLUMN, y: 0 }, task: 'text' },
      { key: 'picture', type: 'generate', at: { x: COLUMN * 2, y: 0 }, task: 'image' },
    ],
    edges: [
      { from: 'idea', to: 'writer', into: 'prompt' },
      { from: 'writer', to: 'picture', into: 'prompt' },
    ],
  },
  {
    id: 'productShot',
    nodes: [
      { key: 'product', type: 'media', at: { x: 0, y: 0 }, kind: 'image' },
      { key: 'cutout', type: 'generate', at: { x: COLUMN, y: 0 }, task: 'remove_background' },
      {
        key: 'scene',
        type: 'prompt',
        at: { x: COLUMN, y: ROW },
      },
      { key: 'shot', type: 'generate', at: { x: COLUMN * 2, y: 0 }, task: 'image_edit' },
      { key: 'larger', type: 'generate', at: { x: COLUMN * 3, y: 0 }, task: 'upscale' },
    ],
    edges: [
      { from: 'product', to: 'cutout', into: 'media' },
      { from: 'cutout', to: 'shot', into: 'media' },
      { from: 'scene', to: 'shot', into: 'prompt' },
      { from: 'shot', to: 'larger', into: 'media' },
    ],
  },
  {
    id: 'talkingHead',
    nodes: [
      { key: 'face', type: 'media', at: { x: 0, y: 0 }, kind: 'image' },
      {
        key: 'words',
        type: 'prompt',
        at: { x: 0, y: ROW },
      },
      { key: 'voice', type: 'generate', at: { x: COLUMN, y: ROW }, task: 'speech' },
      { key: 'speaker', type: 'generate', at: { x: COLUMN * 2, y: 0 }, task: 'lip_sync' },
    ],
    edges: [
      { from: 'words', to: 'voice', into: 'prompt' },
      { from: 'face', to: 'speaker', into: 'media' },
      { from: 'voice', to: 'speaker', into: 'media' },
    ],
  },
  {
    id: 'soundtrack',
    nodes: [
      {
        key: 'mood',
        type: 'prompt',
        at: { x: 0, y: 0 },
      },
      { key: 'music', type: 'generate', at: { x: COLUMN, y: 0 }, task: 'music' },
      {
        key: 'effect',
        type: 'prompt',
        at: { x: 0, y: ROW },
      },
      { key: 'sound', type: 'generate', at: { x: COLUMN, y: ROW }, task: 'sound' },
    ],
    edges: [
      { from: 'mood', to: 'music', into: 'prompt' },
      { from: 'effect', to: 'sound', into: 'prompt' },
    ],
  },
]

/** The models a template's generation nodes start with: the panel's choice for the task, then the compared ones. */
export type ModelsFor = (task: Task) => ModelRef[]

/** A template's prompt by its node's key, in the person's language. */
export type PromptFor = (template: string, key: string) => string

/** The template's nodes and edges with ids of their own, placed with their left top at `origin`. */
export function instantiate(
  template: WorkflowTemplate,
  origin: Position,
  models: ModelsFor,
  promptFor: PromptFor,
  newId: () => string,
): CanvasGraph {
  const ids = new Map(template.nodes.map((node) => [node.key, newId()]))
  const nodes = template.nodes.map((node): CanvasNode => {
    const id = ids.get(node.key)!
    const position = { x: origin.x + node.at.x, y: origin.y + node.at.y }
    if (node.type === 'prompt')
      return { id, type: 'prompt', position, data: { text: promptFor(template.id, node.key) } }
    if (node.type === 'media')
      return { id, type: 'media', position, data: { ref: null, kind: node.kind, name: '' } }
    return {
      id,
      type: 'generate',
      position,
      data: { task: node.task, model: models(node.task)[node.pick ?? 0] ?? null, job: null },
    }
  })
  const edges = template.edges.map(
    (edge): CanvasEdge => ({
      id: newId(),
      source: ids.get(edge.from)!,
      target: ids.get(edge.to)!,
      targetHandle: edge.into,
    }),
  )
  return { nodes, edges }
}

/** Where a piece goes on a canvas: to the right of what is there, level with its top. */
export function besideGraph(graph: CanvasGraph): Position {
  if (graph.nodes.length === 0) return { x: 0, y: 0 }
  return {
    x: Math.max(...graph.nodes.map((node) => node.position.x)) + COLUMN + 80,
    y: Math.min(...graph.nodes.map((node) => node.position.y)),
  }
}

const FILE_KIND = 'videosos-workflow'

/** A canvas as a workflow file: the chain and the prompts, without this computer's files and the results. */
export function workflowFile(graph: CanvasGraph, name: string): string {
  const nodes = graph.nodes.map((node): CanvasNode => {
    if (node.type === 'media')
      return { ...node, data: { ref: null, kind: node.data.kind, name: '' } }
    if (node.type === 'generate') return { ...node, data: { ...node.data, job: null } }
    return node
  })
  return JSON.stringify(
    { kind: FILE_KIND, version: 1, name, graph: { nodes, edges: graph.edges } },
    null,
    2,
  )
}

const TASK_SET = new Set<string>([
  'image',
  'image_edit',
  'video',
  'video_edit',
  'lip_sync',
  'upscale',
  'remove_background',
  'music',
  'speech',
  'sound',
  'transcribe',
  'text',
])
const KIND_SET = new Set<string>(['image', 'video', 'audio'])
const PROVIDERS = new Set<string>(['openrouter', 'fal', 'runware', 'local'])

function bad(what: string): never {
  throw new Error(`the workflow file is not valid: ${what}`)
}

function positionOf(value: unknown, what: string): Position {
  const at = value as Position | null
  if (
    !at ||
    typeof at.x !== 'number' ||
    typeof at.y !== 'number' ||
    !Number.isFinite(at.x) ||
    !Number.isFinite(at.y)
  )
    bad(`${what} has no position`)
  return { x: at.x, y: at.y }
}

/** A workflow file read back, with ids of its own so it can go onto a canvas beside what is there. */
export function readWorkflowFile(
  text: string,
  newId: () => string,
): { name: string; graph: CanvasGraph } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (failure) {
    bad(failure instanceof Error ? failure.message : String(failure))
  }
  const file = value as {
    kind?: unknown
    version?: unknown
    name?: unknown
    graph?: { nodes?: unknown; edges?: unknown }
  }
  if (file?.kind !== FILE_KIND) bad(`it is not a ${FILE_KIND} file`)
  if (file.version !== 1) bad(`version ${String(file.version)} is not known`)
  if (!Array.isArray(file.graph?.nodes) || !Array.isArray(file.graph?.edges))
    bad('it has no nodes and edges')
  if (file.graph.nodes.length > 200) bad('it has more than 200 nodes')
  const ids = new Map<string, string>()
  const nodes = (file.graph.nodes as Array<Record<string, unknown>>).map(
    (raw, index): CanvasNode => {
      const what = `node ${index + 1}`
      if (typeof raw.id !== 'string' || ids.has(raw.id)) bad(`${what} has no id of its own`)
      const id = newId()
      ids.set(raw.id, id)
      const position = positionOf(raw.position, what)
      const data = (raw.data ?? {}) as Record<string, unknown>
      if (raw.type === 'prompt') {
        if (typeof data.text !== 'string') bad(`${what} has no text`)
        return { id, type: 'prompt', position, data: { text: data.text } }
      }
      if (raw.type === 'media') {
        const kind = data.kind === null || data.kind === undefined ? null : String(data.kind)
        if (kind !== null && !KIND_SET.has(kind)) bad(`${what} has an unknown kind ${kind}`)
        return {
          id,
          type: 'media',
          position,
          data: { ref: null, kind: kind as MediaKind | null, name: '' },
        }
      }
      if (raw.type === 'generate') {
        if (typeof data.task !== 'string' || !TASK_SET.has(data.task))
          bad(`${what} has an unknown task ${String(data.task)}`)
        const model = data.model as { provider?: unknown; id?: unknown } | null | undefined
        const known =
          model &&
          typeof model.id === 'string' &&
          typeof model.provider === 'string' &&
          PROVIDERS.has(model.provider)
        return {
          id,
          type: 'generate',
          position,
          data: {
            task: data.task as Task,
            model: known ? ({ provider: model.provider, id: model.id } as ModelRef) : null,
            job: null,
          },
        }
      }
      bad(`${what} is of an unknown type ${String(raw.type)}`)
    },
  )
  const edges = (file.graph.edges as Array<Record<string, unknown>>).map(
    (raw, index): CanvasEdge => {
      const source = ids.get(String(raw.source))
      const target = ids.get(String(raw.target))
      if (!source || !target) bad(`edge ${index + 1} joins nodes the file does not have`)
      if (raw.targetHandle !== 'prompt' && raw.targetHandle !== 'media')
        bad(`edge ${index + 1} goes into an unknown slot`)
      const from = nodes.find((node) => node.id === source)!
      if (!connects(from, raw.targetHandle))
        bad(`edge ${index + 1} passes a ${from.type} node into a slot that does not take it`)
      return { id: newId(), source, target, targetHandle: raw.targetHandle }
    },
  )
  const name =
    typeof file.name === 'string' && file.name.trim() ? file.name.trim().slice(0, 120) : 'Workflow'
  return { name, graph: { nodes, edges } }
}

/** The graph moved so its left top is at `origin`. */
export function moveTo(graph: CanvasGraph, origin: Position): CanvasGraph {
  if (graph.nodes.length === 0) return graph
  const left = Math.min(...graph.nodes.map((node) => node.position.x))
  const top = Math.min(...graph.nodes.map((node) => node.position.y))
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x - left + origin.x, y: node.position.y - top + origin.y },
    })),
  }
}
