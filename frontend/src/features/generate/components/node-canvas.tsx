import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Film, ImageIcon, Loader2, Play, Plus, Sparkles, Type, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getMediaDragData, useMediaLibraryStore, useProjectStore } from '../deps/editor'
import {
  formatUsd,
  generateApi,
  TASKS,
  type Job,
  type MediaKind,
  type ModelForm,
  type Task,
} from '../services/generate-api'
import { applyElements } from '../services/prompt-elements'
import {
  EMPTY_GRAPH,
  connects,
  nodeValues,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
} from '../services/canvas-graph'
import { placeMediaAtPlayhead } from '../services/timeline-actions'
import { useEstimate } from '../hooks/use-estimate'
import { modelKey, useGenerateStore, type ModelRef } from '../stores/generate-store'
import { MediaThumb, OUTPUT_DRAG_TYPE } from './field-control'
import { ModelPicker } from './model-picker'

const ACTIVE = new Set(['queued', 'sending', 'running'])
const KINDS: MediaKind[] = ['image', 'video', 'audio']

type Change = (id: string, data: Partial<CanvasNode['data']>) => void
interface NodeContext {
  graph: CanvasGraph
  change: Change
  remove: (id: string) => void
  jobs: Map<string, Job>
}

const CanvasContext = createContext<NodeContext>({
  graph: EMPTY_GRAPH,
  change: () => undefined,
  remove: () => undefined,
  jobs: new Map(),
})

function NodeShell({
  id,
  icon: Icon,
  title,
  children,
  inputs = [],
  output = true,
}: {
  id: string
  icon: typeof Type
  title: string
  children: React.ReactNode
  inputs?: Array<'prompt' | 'media'>
  output?: boolean
}) {
  const { t } = useTranslation()
  const context = useContext(CanvasContext)
  return (
    <div className="relative w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-xl">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <Icon className="size-3.5 text-[var(--color-accent)]" aria-hidden />
        <span className="flex-1 text-xs font-semibold">{title}</span>
        <button
          type="button"
          onClick={() => context.remove(id)}
          className="nodrag rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          aria-label={t('generate.canvas.remove')}
          title={t('generate.canvas.remove')}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-2 p-3">{children}</div>
      {inputs.map((handle, index) => (
        <Handle
          key={handle}
          id={handle}
          type="target"
          position={Position.Left}
          style={{ top: 48 + index * 28 }}
          className="!size-3 !border-2 !border-[var(--color-surface)] !bg-[var(--color-accent)]"
          title={t(`generate.canvas.input.${handle}`)}
        />
      ))}
      {inputs.map((handle, index) => (
        <span
          key={`label-${handle}`}
          className="pointer-events-none absolute -left-1 -translate-x-full text-[10px] text-[var(--color-muted)]"
          style={{ top: 41 + index * 28 }}
        >
          {t(`generate.canvas.input.${handle}`)}
        </span>
      ))}
      {output && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-3 !border-2 !border-[var(--color-surface)] !bg-[var(--color-accent-2)]"
        />
      )}
    </div>
  )
}

const PromptNode = memo(function PromptNode({ id, data }: NodeProps<Node<{ text: string }>>) {
  const { t } = useTranslation()
  const context = useContext(CanvasContext)
  return (
    <NodeShell id={id} icon={Type} title={t('generate.canvas.prompt')}>
      <Textarea
        value={data.text}
        onChange={(event) => context.change(id, { text: event.target.value })}
        placeholder={t('generate.canvas.promptHint')}
        className="nodrag nowheel min-h-24 resize-y bg-secondary/30 text-xs"
        aria-label={t('generate.canvas.prompt')}
      />
    </NodeShell>
  )
})

const MediaNode = memo(function MediaNode({
  id,
  data,
}: NodeProps<Node<Extract<CanvasNode, { type: 'media' }>['data']>>) {
  const { t } = useTranslation()
  return (
    <NodeShell id={id} icon={ImageIcon} title={data.name || t('generate.canvas.media')}>
      {data.ref ? (
        <div className="aspect-video overflow-hidden rounded bg-secondary">
          <MediaThumb reference={data.ref} />
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">{t('generate.canvas.mediaHint')}</p>
      )}
    </NodeShell>
  )
})

const GenerateNode = memo(function GenerateNode({
  id,
  data,
}: NodeProps<Node<Extract<CanvasNode, { type: 'generate' }>['data']>>) {
  const { t } = useTranslation()
  const context = useContext(CanvasContext)
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const keys = useGenerateStore((state) => state.keys)
  const elements = useGenerateStore((state) => state.elements)
  const form = useGenerateStore((state) =>
    data.model ? state.forms[modelKey(data.model.provider, data.model.id)] : undefined,
  ) as ModelForm | undefined
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!data.model || form) return
    generateApi.form(data.model.provider, data.model.id).then(
      (answer) => useGenerateStore.getState().setForm(answer.form),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    )
  }, [data.model, form])
  const inputs = form
    ? nodeValues(context.graph, id, form.fields, context.jobs)
    : { values: {}, waiting: [], left: 0 }
  const values = form ? applyElements(form.fields, inputs.values, elements).values : {}
  const { estimate } = useEstimate(
    form ? data.model?.provider : undefined,
    data.model?.id,
    values,
    1,
  )
  const missing = (form?.fields ?? []).filter(
    (field) =>
      field.required &&
      field.default === undefined &&
      (values[field.key] === undefined || values[field.key] === ''),
  )
  const job = data.job ? context.jobs.get(data.job) : undefined
  const busy = running || ACTIVE.has(job?.status ?? '')
  const output =
    job?.status === 'done'
      ? (job.outputs.find((each) => each.kind !== 'text') ?? job.outputs[0])
      : undefined
  const run = async () => {
    if (!data.model || !projectId) return
    setRunning(true)
    setError(null)
    try {
      const { jobs } = await generateApi.createJobs({
        provider: data.model.provider,
        model: data.model.id,
        task: data.task,
        values,
        project_id: projectId,
        repeat: 1,
        place: false,
        place_at: null,
      })
      for (const each of jobs) useGenerateStore.getState().upsertJob(each)
      context.change(id, { job: jobs[0]?.id ?? null })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
    }
  }
  return (
    <NodeShell
      id={id}
      icon={Sparkles}
      title={t(`generate.tasks.${data.task}`)}
      inputs={['prompt', 'media']}
    >
      <select
        value={data.task}
        onChange={(event) =>
          context.change(id, { task: event.target.value as Task, model: null, job: null })
        }
        className="nodrag h-7 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs"
        aria-label={t('generate.canvas.task')}
      >
        {TASKS.map((task) => (
          <option key={task} value={task}>
            {t(`generate.tasks.${task}`)}
          </option>
        ))}
      </select>
      <div className="nodrag">
        <ModelPicker
          task={data.task}
          value={data.model ?? undefined}
          keys={keys}
          onChange={(entry) =>
            context.change(id, { model: { provider: entry.provider, id: entry.id } as ModelRef })
          }
        />
      </div>
      {inputs.waiting.length > 0 && (
        <p className="text-[11px] text-[var(--color-muted)]">
          {t('generate.canvas.waiting', { count: inputs.waiting.length })}
        </p>
      )}
      {inputs.left > 0 && (
        <p className="text-[11px] text-[var(--color-warn)]">
          {t('generate.canvas.noRoom', { count: inputs.left })}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-[11px] text-[var(--color-muted)]">
          {t('generate.form.missing', { fields: missing.map((field) => field.label).join(', ') })}
        </p>
      )}
      {output && (
        <div className="space-y-1">
          {output.kind === 'text' ? (
            <p className="nowheel max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-secondary/40 p-2 text-[11px]">
              {output.text}
            </p>
          ) : (
            <div
              className="aspect-video overflow-hidden rounded bg-secondary"
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  OUTPUT_DRAG_TYPE,
                  JSON.stringify({ job: job!.id, index: output.index, mime: output.mime }),
                )
              }
            >
              <MediaThumb reference={{ job: job!.id, index: output.index }} />
            </div>
          )}
          {job!.imported.length > 0 && (
            <button
              type="button"
              onClick={() => job!.imported.forEach((mediaId) => placeMediaAtPlayhead(mediaId))}
              className="nodrag inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              <Film className="size-3" />
              {t('generate.actions.place')}
            </button>
          )}
        </div>
      )}
      {job?.status === 'failed' && (
        <p className="break-words text-[11px] text-destructive">{job.error}</p>
      )}
      {error && <p className="break-words text-[11px] text-destructive">{error}</p>}
      <Button
        size="sm"
        className="bg-brand nodrag h-8 w-full justify-between gap-2 text-xs"
        disabled={
          !form ||
          busy ||
          missing.length > 0 ||
          inputs.waiting.length > 0 ||
          !keys[data.model?.provider ?? 'openrouter']
        }
        onClick={() => void run()}
      >
        <span className="inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {busy
            ? t(`generate.status.${job?.status ?? 'sending'}`)
            : output
              ? t('generate.canvas.runAgain')
              : t('generate.canvas.run')}
        </span>
        <span className="tabular-nums">
          {estimate?.estimate
            ? `${estimate.estimate.exact ? '' : '≈'}${formatUsd(estimate.estimate.usd)}`
            : t('generate.cost.unknown')}
        </span>
      </Button>
    </NodeShell>
  )
})

const NODE_TYPES = { prompt: PromptNode, media: MediaNode, generate: GenerateNode }

function Canvas({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const stored = useGenerateStore((state) => state.canvases[projectId]) ?? EMPTY_GRAPH
  const jobList = useGenerateStore((state) => state.jobs)
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const [graph, setGraph] = useState<CanvasGraph>(stored)
  const flow = useReactFlow()
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jobs = useMemo(() => new Map(jobList.map((job) => [job.id, job])), [jobList])

  const latest = useRef(graph)
  const update = useCallback(
    (change: (current: CanvasGraph) => CanvasGraph) => {
      const next = change(latest.current)
      latest.current = next
      setGraph(next)
      if (saving.current) clearTimeout(saving.current)
      saving.current = setTimeout(() => useGenerateStore.getState().setCanvas(projectId, next), 400)
    },
    [projectId],
  )
  const context = useMemo<NodeContext>(
    () => ({
      graph,
      jobs,
      change: (id, data) =>
        update((current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === id ? ({ ...node, data: { ...node.data, ...data } } as CanvasNode) : node,
          ),
        })),
      remove: (id) =>
        update((current) => ({
          nodes: current.nodes.filter((node) => node.id !== id),
          edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
        })),
    }),
    [graph, jobs, update],
  )

  // a new node goes to the right of the last one, so a chain reads left to right
  const nextPosition = () => {
    const last = latest.current.nodes.at(-1)
    return last
      ? { x: last.position.x + 340, y: last.position.y }
      : flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 })
  }
  const add = (
    type: CanvasNode['type'],
    position = nextPosition(),
    extra?: Partial<CanvasNode['data']>,
  ) => {
    const id = crypto.randomUUID()
    const data =
      type === 'prompt'
        ? { text: '' }
        : type === 'media'
          ? { ref: null, kind: null, name: '' }
          : { task: 'image' as Task, model: null, job: null }
    update((current) => ({
      ...current,
      nodes: [...current.nodes, { id, type, position, data: { ...data, ...extra } } as CanvasNode],
    }))
  }

  // React Flow shows a node once it has measured it; the sizes it reports are kept beside the stored graph
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
    measured: measured[node.id],
  }))
  const edges: Edge[] = graph.edges.map((edge) => ({
    ...edge,
    animated: graph.nodes.find((node) => node.id === edge.source)?.type === 'generate',
  }))

  const onNodesChange = (changes: NodeChange[]) => {
    const sizes = changes.flatMap((change) =>
      change.type === 'dimensions' && change.dimensions
        ? [[change.id, change.dimensions] as const]
        : [],
    )
    if (sizes.length > 0) setMeasured((current) => ({ ...current, ...Object.fromEntries(sizes) }))
    if (changes.every((change) => change.type === 'dimensions' || change.type === 'select')) return
    const next = applyNodeChanges(changes, nodes)
    update((current) => {
      const removed = new Set(
        current.nodes
          .filter((node) => !next.some((each) => each.id === node.id))
          .map((node) => node.id),
      )
      return {
        nodes: current.nodes
          .filter((node) => !removed.has(node.id))
          .map((node) => ({
            ...node,
            position: next.find((each) => each.id === node.id)?.position ?? node.position,
          })),
        edges: current.edges.filter(
          (edge) => !removed.has(edge.source) && !removed.has(edge.target),
        ),
      }
    })
  }
  const onEdgesChange = (changes: EdgeChange[]) => {
    const kept = new Set(applyEdgeChanges(changes, edges).map((edge) => edge.id))
    update((current) => ({ ...current, edges: current.edges.filter((edge) => kept.has(edge.id)) }))
  }
  const valid = (connection: Connection | Edge) => {
    const source = graph.nodes.find((node) => node.id === connection.source)
    const handle = connection.targetHandle as 'prompt' | 'media' | null
    return (
      !!source && !!handle && connection.source !== connection.target && connects(source, handle)
    )
  }
  const onConnect = (connection: Connection) => {
    if (!valid(connection)) return
    const edge: CanvasEdge = {
      id: crypto.randomUUID(),
      source: connection.source,
      target: connection.target,
      targetHandle: connection.targetHandle as 'prompt' | 'media',
    }
    update((current) => ({ ...current, edges: [...current.edges, edge] }))
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const output = event.dataTransfer.getData(OUTPUT_DRAG_TYPE)
    if (output) {
      const parsed = JSON.parse(output) as { job: string; index: number; mime: string }
      const kind = KINDS.find((each) => parsed.mime.startsWith(each)) ?? null
      add('media', position, {
        ref: { job: parsed.job, index: parsed.index },
        kind,
        name: jobs.get(parsed.job)?.title ?? '',
      })
      return
    }
    const raw = event.dataTransfer.getData('application/json')
    const data = raw ? (JSON.parse(raw) as ReturnType<typeof getMediaDragData>) : getMediaDragData()
    if (data?.type !== 'media-item' || !data.mediaId) return
    const kind = KINDS.find((each) => each === data.mediaType) ?? null
    add('media', position, {
      ref: { media: data.mediaId },
      kind,
      name: mediaById[data.mediaId]?.fileName ?? '',
    })
  }

  return (
    <CanvasContext.Provider value={context}>
      <div
        className="relative h-full w-full"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        data-testid="node-canvas"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={valid}
          colorMode="dark"
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { stroke: 'var(--color-accent)', strokeWidth: 2 } }}
        >
          <Background gap={24} size={1} color="var(--color-border)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgb(10 10 11 / 0.7)"
            nodeColor="var(--color-overlay)"
          />
        </ReactFlow>
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/95 p-1.5 shadow-lg">
          {(['prompt', 'media', 'generate'] as const).map((type) => (
            <Button
              key={type}
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => add(type)}
            >
              <Plus className="size-3" />
              {t(`generate.canvas.${type}`)}
            </Button>
          ))}
        </div>
        {graph.nodes.length === 0 && (
          <p className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-md -translate-x-1/2 -translate-y-1/2 text-center text-sm text-[var(--color-muted)]">
            {t('generate.canvas.empty')}
          </p>
        )}
      </div>
    </CanvasContext.Provider>
  )
}

/**
 * The node canvas workspace, as Weave's and Flora's: text, files and model runs as nodes joined by what they
 * pass on, kept with the project on the server; runs go through the same queue, history and prices as the
 * generation panel.
 */
export function NodeCanvas() {
  const { t } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  if (!projectId)
    return (
      <p className="p-6 text-sm text-[var(--color-muted)]">{t('generate.storyboard.noProject')}</p>
    )
  return (
    <ReactFlowProvider>
      <Canvas key={projectId} projectId={projectId} />
    </ReactFlowProvider>
  )
}
