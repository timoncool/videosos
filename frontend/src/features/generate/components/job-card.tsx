import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, Ban, CircleAlert, Copy, Forward, Loader2, RotateCcw, SquarePen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/shared/ui/cn'
import { toast } from 'sonner'
import { formatUsd, generateApi, type Job, type MediaKind, type OutputFile, type Role, type Task } from '../services/generate-api'
import { useGenerateStore } from '../stores/generate-store'
import { importLastFrame } from '../services/last-frame'
import { useProjectStore } from '../deps/editor'
import { placeMediaAtPlayhead, placeTextAtPlayhead } from '../services/timeline-actions'
import { OUTPUT_DRAG_TYPE } from './field-control'
import { ProviderBadge } from './model-picker'
import { ImageLightbox } from './image-lightbox'
import { exactMoment, relativeMoment } from '../deps/studio'

/** A result picture: dragged into a slot or the timeline, opened at full size by a click. */
function ImagePreview({ url, name, onDragStart }: { url: string; name: string; onDragStart: (event: React.DragEvent) => void }) {
  const { t } = useTranslation()
  const [zoomed, setZoomed] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setZoomed(true)} aria-label={t('generate.zoom.open')} title={t('generate.zoom.open')} className="block w-full cursor-zoom-in">
        <img src={url} alt="" draggable onDragStart={onDragStart} className="max-h-40 w-full rounded border border-border bg-black object-contain" />
      </button>
      {zoomed && <ImageLightbox src={url} alt={name} onClose={() => setZoomed(false)} />}
    </>
  )
}

function Preview({ job, output }: { job: Job; output: OutputFile }) {
  const url = generateApi.fileUrl(job.id, output.index)
  const drag = (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(
      OUTPUT_DRAG_TYPE,
      JSON.stringify({ job: job.id, index: output.index, mime: output.mime }),
    )
  }
  if (output.kind === 'image') {
    return <ImagePreview url={url} name={job.model_name} onDragStart={drag} />
  }
  if (output.kind === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        draggable
        onDragStart={drag}
        className="max-h-40 w-full rounded border border-border bg-black"
      />
    )
  }
  if (output.kind === 'audio') {
    return <audio src={url} controls preload="metadata" className="h-8 w-full" />
  }
  if (output.kind === 'text') {
    return (
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-secondary/30 p-2 text-[11px]">
        {output.text}
      </p>
    )
  }
  return <a href={url} className="text-[11px] underline">{output.file}</a>
}

function attempt(work: () => unknown): void {
  try {
    const result = work()
    if (result instanceof Promise) {
      result.catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

/** Where a result can go next ("use as..."), by what it is: the task and the slots it fits there. */
const NEXT: Record<MediaKind, Array<{ task: Task; roles: Role[]; label: string; lastFrame?: boolean }>> = {
  image: [
    { task: 'video', roles: ['first_frame'], label: 'generate.use.videoFromFrame' },
    { task: 'image_edit', roles: ['source', 'reference'], label: 'generate.use.edit' },
    { task: 'upscale', roles: ['source'], label: 'generate.use.upscale' },
    { task: 'remove_background', roles: ['source'], label: 'generate.use.removeBackground' },
    { task: 'lip_sync', roles: ['first_frame', 'source'], label: 'generate.use.lipSync' },
  ],
  video: [
    { task: 'video', roles: ['first_frame'], label: 'generate.use.continue', lastFrame: true },
    { task: 'video_edit', roles: ['source'], label: 'generate.use.editVideo' },
    { task: 'upscale', roles: ['source'], label: 'generate.use.upscale' },
    { task: 'lip_sync', roles: ['source'], label: 'generate.use.lipSync' },
    { task: 'sound', roles: ['source'], label: 'generate.use.sound' },
  ],
  audio: [
    { task: 'lip_sync', roles: ['audio'], label: 'generate.use.lipSyncVoice' },
    { task: 'transcribe', roles: ['audio'], label: 'generate.use.transcribe' },
  ],
}

function UseAs({ job, output }: { job: Job; output: OutputFile }) {
  const { t } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  if (output.kind !== 'image' && output.kind !== 'video' && output.kind !== 'audio') return null
  const kind = output.kind
  const choose = async (next: (typeof NEXT)[MediaKind][number]) => {
    if (next.lastFrame) {
      if (!projectId) throw new Error(t('generate.use.needsProject'))
      const media = await importLastFrame(generateApi.fileUrl(job.id, output.index), `${job.model_name}-last-frame.png`, projectId)
      useGenerateStore.getState().useAs({ task: next.task, roles: next.roles, kind: 'image', ref: { media } })
      return
    }
    useGenerateStore.getState().useAs({ task: next.task, roles: next.roles, kind, ref: { job: job.id, index: output.index } })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" data-testid="generate-use-as">
          <Forward className="mr-1 h-3 w-3" />
          {t('generate.use.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {NEXT[kind].map((next) => (
          <DropdownMenuItem key={next.label} className="text-xs" onClick={() => attempt(() => choose(next))}>
            {t(next.label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface JobCardProps {
  job: Job
  onReuse: (job: Job) => void
  /** Ticked for side-by-side comparison; absent when the card cannot be compared. */
  selected?: boolean
  onSelect?: (selected: boolean) => void
}

export function JobCard({ job, onReuse, selected, onSelect }: JobCardProps) {
  const { t, i18n } = useTranslation()
  const running = job.status === 'queued' || job.status === 'sending' || job.status === 'running'
  const prompt = Object.entries(job.values).find(([key]) => /prompt|^input$|^text$/i.test(key))?.[1]
  const text = job.outputs.find((output) => output.kind === 'text')?.text

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-2" data-testid="generate-job">
      <div className="flex items-center gap-1.5">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected === true}
            onChange={(event) => onSelect(event.target.checked)}
            aria-label={t('generate.compare.pick')}
            title={t('generate.compare.pick')}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
        )}
        <ProviderBadge provider={job.provider} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={job.model}>
          {job.model_name}
        </span>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            job.status === 'done' && 'text-emerald-400',
            job.status === 'failed' && 'text-destructive',
            running && 'text-amber-300',
            job.status === 'cancelled' && 'text-muted-foreground',
          )}
        >
          {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {t(`generate.status.${job.status}`)}
          {running && job.progress !== null && ` ${Math.round(job.progress * 100)}%`}
        </span>
      </div>
      {typeof prompt === 'string' && <p className="line-clamp-2 text-[10px] text-muted-foreground">{prompt}</p>}
      <time dateTime={new Date(job.created).toISOString()} title={exactMoment(new Date(job.created), i18n.language)} className="block text-[10px] text-muted-foreground">
        {relativeMoment(new Date(job.created), i18n.language)}
      </time>
      {job.outputs.map((output) => (
        <Preview key={output.index} job={job} output={output} />
      ))}
      {job.error && (
        <p className="flex gap-1 text-[10px] text-destructive">
          <CircleAlert className="mt-px h-3 w-3 shrink-0" />
          <span className="break-words">{job.error}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-auto text-[10px] text-muted-foreground" title={job.cost_source === 'estimate' ? t('generate.cost.estimated') : t('generate.cost.billed')}>
          {job.cost !== null
            ? `${job.cost_source === 'estimate' ? '≈' : ''}${formatUsd(job.cost)}`
            : job.estimate !== null
              ? `≈${formatUsd(job.estimate)}`
              : ''}
        </span>
        {running && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => attempt(() => generateApi.cancel(job.id))}>
            <Ban className="mr-1 h-3 w-3" />
            {t('generate.actions.cancel')}
          </Button>
        )}
        {job.status === 'done' && job.imported.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            title={t('generate.actions.placeHint')}
            onClick={() => attempt(() => job.imported.forEach((mediaId) => placeMediaAtPlayhead(mediaId)))}
          >
            <ArrowDownToLine className="mr-1 h-3 w-3" />
            {t('generate.actions.place')}
          </Button>
        )}
        {text && (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => attempt(() => navigator.clipboard.writeText(text))}>
              <Copy className="mr-1 h-3 w-3" />
              {t('generate.actions.copy')}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => attempt(() => placeTextAtPlayhead(text))}>
              <ArrowDownToLine className="mr-1 h-3 w-3" />
              {t('generate.actions.placeText')}
            </Button>
          </>
        )}
        {job.status === 'done' && job.outputs[0] && <UseAs job={job} output={job.outputs[0]} />}
        {!running && (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" title={t('generate.actions.reuseHint')} onClick={() => onReuse(job)}>
              <SquarePen className="mr-1 h-3 w-3" />
              {t('generate.actions.reuse')}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => attempt(() => generateApi.retry(job.id))}>
              <RotateCcw className="mr-1 h-3 w-3" />
              {t('generate.actions.again')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px] text-muted-foreground"
              title={t('generate.actions.forgetHint')}
              onClick={() => attempt(() => generateApi.remove(job.id))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
