import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, Ban, CircleAlert, Copy, Loader2, RotateCcw, SquarePen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { toast } from 'sonner'
import { formatUsd, generateApi, type Job, type OutputFile } from '../services/generate-api'
import { placeMediaAtPlayhead, placeTextAtPlayhead } from '../services/timeline-actions'
import { OUTPUT_DRAG_TYPE } from './field-control'
import { ProviderBadge } from './model-picker'

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
    return (
      <img
        src={url}
        alt=""
        draggable
        onDragStart={drag}
        className="max-h-40 w-full rounded border border-border bg-black object-contain"
      />
    )
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

interface JobCardProps {
  job: Job
  onReuse: (job: Job) => void
}

export function JobCard({ job, onReuse }: JobCardProps) {
  const { t } = useTranslation()
  const running = job.status === 'queued' || job.status === 'sending' || job.status === 'running'
  const prompt = Object.entries(job.values).find(([key]) => /prompt|^input$|^text$/i.test(key))?.[1]
  const text = job.outputs.find((output) => output.kind === 'text')?.text

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-2" data-testid="generate-job">
      <div className="flex items-center gap-1.5">
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
