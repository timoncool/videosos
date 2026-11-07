import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Forward,
  Heart,
  KeyRound,
  Loader2,
  RotateCcw,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/shared/ui/cn'
import { toast } from 'sonner'
import {
  PROVIDER_LABELS,
  formatUsd,
  generateApi,
  type Job,
  type MediaKind,
  type OutputFile,
  type Role,
  type Task,
} from '../services/generate-api'
import { useGenerateStore } from '../stores/generate-store'
import { importLastFrame } from '../services/last-frame'
import { useProjectStore } from '../deps/editor'
import { placeMediaAtPlayhead, placeTextAtPlayhead } from '../services/timeline-actions'
import { OUTPUT_DRAG_TYPE } from './field-control'
import { ProviderBadge } from './model-picker'
import { ImageLightbox } from './image-lightbox'
import { exactMoment, openSettings, relativeMoment, ShareMenu } from '../deps/studio'
import { fieldLabel } from '../services/field-label'
import { promptOf, resultFileName } from '../services/result-title'

/** A result picture: dragged into a slot or the timeline, opened at full size by a click. */
function ImagePreview({
  url,
  name,
  onDragStart,
}: {
  url: string
  name: string
  onDragStart: (event: React.DragEvent) => void
}) {
  const { t } = useTranslation()
  const [zoomed, setZoomed] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={t('generate.zoom.open')}
        title={t('generate.zoom.open')}
        className="block w-full cursor-zoom-in"
      >
        <img
          src={url}
          alt=""
          draggable
          onDragStart={onDragStart}
          className="max-h-40 w-full rounded border border-border bg-black object-contain"
        />
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
  return (
    <a href={url} className="text-[11px] underline">
      {output.file}
    </a>
  )
}

/** What the run was asked for, as VidRush shows a result's prompt, model and settings: enough to repeat it by hand. */
function JobDetails({ job }: { job: Job }) {
  const { t } = useTranslation()
  const took =
    job.status === 'done' && job.updated > job.created
      ? Math.round((job.updated - job.created) / 1000)
      : null
  const shown = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(shown).join(', ')
    if (value && typeof value === 'object') {
      const ref = value as { media?: string; job?: string; file?: string }
      return ref.media
        ? t('generate.details.media')
        : ref.job
          ? t('generate.details.result')
          : ref.file
            ? (ref.file.split(/[\\/]/).pop() ?? ref.file)
            : JSON.stringify(value)
    }
    return String(value)
  }
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-[var(--color-text)]">
        {t('generate.details.title')}
      </summary>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <dt className="text-muted-foreground">{t('generate.details.model')}</dt>
        <dd className="break-all">{job.model}</dd>
        {Object.entries(job.values).map(([key, value]) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{fieldLabel(t, { key, label: key })}</dt>
            <dd className="line-clamp-4 break-words">{shown(value)}</dd>
          </Fragment>
        ))}
        {took !== null && (
          <>
            <dt className="text-muted-foreground">{t('generate.details.took')}</dt>
            <dd className="tabnum">{t('generate.details.seconds', { count: took })}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('generate.details.job')}</dt>
        <dd className="mono break-all">{job.id}</dd>
      </dl>
    </details>
  )
}

function attempt(work: () => unknown): void {
  try {
    const result = work()
    if (result instanceof Promise) {
      result.catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      )
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

/** Where a result can go next ("use as..."), by what it is: the task and the slots it fits there. */
const NEXT: Record<
  MediaKind,
  Array<{ task: Task; roles: Role[]; label: string; lastFrame?: boolean }>
> = {
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
      const name = resultFileName(
        { title: t('generate.use.lastFrameName', { title: job.title }) },
        0,
        1,
        'png',
      )
      const media = await importLastFrame(
        generateApi.fileUrl(job.id, output.index),
        name,
        projectId,
      )
      useGenerateStore
        .getState()
        .useAs({ task: next.task, roles: next.roles, kind: 'image', ref: { media } })
      return
    }
    useGenerateStore.getState().useAs({
      task: next.task,
      roles: next.roles,
      kind,
      ref: { job: job.id, index: output.index },
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          data-testid="generate-use-as"
        >
          <Forward className="mr-1 h-3 w-3" />
          {t('generate.use.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {NEXT[kind].map((next) => (
          <DropdownMenuItem
            key={next.label}
            className="text-xs"
            onClick={() => attempt(() => choose(next))}
          >
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

/**
 * Why a job stopped, as Dub Studio's job failure reads: what happened in the window's words, the provider's own
 * words under Details, and the way to fix it when there is one. A cancelled job's note is not a failure.
 */
function JobProblem({ job }: { job: Job }) {
  const { t } = useTranslation()
  const [details, setDetails] = useState(false)
  if (!job.error) return null
  if (job.status !== 'failed')
    return <p className="break-words text-[11px] text-muted-foreground">{job.error}</p>
  const title = job.error_code
    ? t(`generate.jobError.${job.error_code}`, {
        provider: PROVIDER_LABELS[job.provider],
        defaultValue: job.error,
      })
    : job.error
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5"
    >
      <p className="flex gap-1 text-[11px] font-medium text-destructive">
        <CircleAlert className="mt-px h-3 w-3 shrink-0" />
        <span className="break-words">{title}</span>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {title !== job.error && (
          <button
            type="button"
            onClick={() => setDetails((open) => !open)}
            aria-expanded={details}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', details && 'rotate-180')} />
            {t('generate.jobError.details')}
          </button>
        )}
        {job.error_code === 'no_key' && (
          <button
            type="button"
            onClick={() => openSettings('providers')}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:underline"
          >
            <KeyRound className="h-3 w-3" />
            {t('generate.jobError.openKeys')}
          </button>
        )}
      </div>
      {details && (
        <p className="mt-1 break-words font-mono text-[11px] text-foreground">{job.error}</p>
      )}
    </div>
  )
}

/** A job's first picture, video or sound as a file named by its title, for sharing. */
async function resultFile(job: Job): Promise<File> {
  const media = job.outputs.filter((output) => output.kind !== 'text')
  const output = media[0]
  if (!output) throw new Error(job.title)
  const response = await fetch(generateApi.fileUrl(job.id, output.index), { cache: 'no-store' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const extension = output.file.split('.').pop() ?? 'bin'
  return new File([await response.blob()], resultFileName(job, 0, 1, extension), {
    type: output.mime,
  })
}

export function JobCard({ job, onReuse, selected, onSelect }: JobCardProps) {
  const { t, i18n } = useTranslation()
  const running = job.status === 'queued' || job.status === 'sending' || job.status === 'running'
  const prompt = promptOf(job.values)
  const text = job.outputs.find((output) => output.kind === 'text')?.text

  return (
    <div
      className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-2"
      data-testid="generate-job"
    >
      <div className="flex items-center gap-1.5">
        {onSelect && (
          <label className="relative grid h-3.5 w-3.5 shrink-0 cursor-pointer place-items-center">
            <input
              type="checkbox"
              checked={selected === true}
              onChange={(event) => onSelect(event.target.checked)}
              aria-label={t('generate.compare.pick')}
              title={t('generate.compare.pick')}
              className="peer h-3.5 w-3.5 cursor-pointer appearance-none rounded-[3px] border border-[var(--color-border)] bg-[var(--color-surface)] checked:border-[var(--color-accent)] checked:bg-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
            />
            <Check
              className="pointer-events-none absolute h-2.5 w-2.5 text-[var(--color-on-accent)] opacity-0 peer-checked:opacity-100"
              strokeWidth={3}
            />
          </label>
        )}
        <ProviderBadge provider={job.provider} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={job.model}>
          {job.model_name}
        </span>
        <span
          className={cn(
            'shrink-0 text-[11px]',
            job.status === 'done' && 'text-[var(--color-accent)]',
            job.status === 'failed' && 'text-destructive',
            running && 'text-[var(--color-warn)]',
            job.status === 'cancelled' && 'text-muted-foreground',
          )}
        >
          {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {t(`generate.status.${job.status}`)}
          {running && job.progress !== null && ` ${Math.round(job.progress * 100)}%`}
        </span>
      </div>
      {prompt && <p className="line-clamp-2 text-[11px] text-muted-foreground">{prompt}</p>}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <time
          dateTime={new Date(job.created).toISOString()}
          title={exactMoment(new Date(job.created), i18n.language)}
        >
          {relativeMoment(new Date(job.created), i18n.language)}
        </time>
      </div>
      <JobDetails job={job} />
      {job.outputs.map((output) => (
        <Preview key={output.index} job={job} output={output} />
      ))}
      <JobProblem job={job} />
      <div className="flex flex-wrap items-center gap-1">
        <span
          className="mr-auto text-[11px] text-muted-foreground"
          title={
            job.cost_source === 'estimate'
              ? t('generate.cost.estimated')
              : t('generate.cost.billed')
          }
        >
          {job.cost !== null
            ? `${job.cost_source === 'estimate' ? '≈' : ''}${formatUsd(job.cost)}`
            : job.estimate !== null
              ? `≈${formatUsd(job.estimate)}`
              : ''}
        </span>
        {running && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => attempt(() => generateApi.cancel(job.id))}
          >
            <Ban className="mr-1 h-3 w-3" />
            {t('generate.actions.cancel')}
          </Button>
        )}
        {job.status === 'done' && job.imported.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
            title={t('generate.actions.placeHint')}
            onClick={() =>
              attempt(() => job.imported.forEach((mediaId) => placeMediaAtPlayhead(mediaId)))
            }
          >
            <ArrowDownToLine className="mr-1 h-3 w-3" />
            {t('generate.actions.place')}
          </Button>
        )}
        {text && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => attempt(() => navigator.clipboard.writeText(text))}
            >
              <Copy className="mr-1 h-3 w-3" />
              {t('generate.actions.copy')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => attempt(() => placeTextAtPlayhead(text))}
            >
              <ArrowDownToLine className="mr-1 h-3 w-3" />
              {t('generate.actions.placeText')}
            </Button>
          </>
        )}
        {job.status === 'done' && job.outputs[0] && <UseAs job={job} output={job.outputs[0]} />}
        {job.status === 'done' && job.outputs.some((output) => output.kind !== 'text') && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-6 px-1.5', job.liked ? 'text-[var(--color-accent)]' : 'text-muted-foreground')}
              title={job.liked ? t('generate.actions.unlike') : t('generate.actions.like')}
              aria-label={job.liked ? t('generate.actions.unlike') : t('generate.actions.like')}
              aria-pressed={job.liked}
              onClick={() =>
                attempt(async () =>
                  useGenerateStore.getState().upsertJob(await generateApi.like(job.id, !job.liked)),
                )
              }
            >
              <Heart className={cn('h-3 w-3', job.liked && 'fill-current')} />
            </Button>
            <ShareMenu compact title={job.title} file={() => resultFile(job)} />
          </>
        )}
        {!running && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              title={t('generate.actions.reuseHint')}
              onClick={() => onReuse(job)}
            >
              <SquarePen className="mr-1 h-3 w-3" />
              {t('generate.actions.reuse')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => attempt(() => generateApi.retry(job.id))}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              {t('generate.actions.again')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px] text-muted-foreground"
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
