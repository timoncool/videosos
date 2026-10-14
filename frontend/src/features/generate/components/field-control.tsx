import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/shared/ui/cn'
import { generateApi, type Field, type MediaKind, type MediaRef } from '../services/generate-api'
import { getMediaDragData, mediaLibraryService, useMediaLibraryStore } from '../deps/editor'
import { fieldLabel, overLength, providerWords } from '../services/field-label'
import { useGenerateStore } from '../stores/generate-store'

/** Drag payload of a finished generation's file. */
export const OUTPUT_DRAG_TYPE = 'application/x-videosos-output'

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function kindOfMime(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export function MediaThumb({ reference }: { reference: MediaRef }) {
  const [url, setUrl] = useState<string | null>(null)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  // a generation's file is drawn by what it is: a video by its first frame, not as a picture
  const outputKind = useGenerateStore((state) =>
    typeof reference === 'object' && 'job' in reference
      ? state.jobs
          .find((job) => job.id === reference.job)
          ?.outputs.find((output) => output.index === reference.index)?.kind
      : undefined,
  )
  useEffect(() => {
    let cancelled = false
    if (typeof reference === 'object' && 'media' in reference) {
      void mediaLibraryService.getThumbnailBlobUrl(reference.media).then((found) => {
        if (!cancelled) setUrl(found)
      })
    } else if (typeof reference === 'object' && 'job' in reference) {
      setUrl(generateApi.fileUrl(reference.job, reference.index))
    }
    return () => {
      cancelled = true
    }
  }, [reference])
  const name =
    typeof reference === 'object' && 'media' in reference
      ? (mediaItems.find((item) => item.id === reference.media)?.fileName ?? reference.media)
      : typeof reference === 'object' && 'file' in reference
        ? reference.file
        : typeof reference === 'string'
          ? reference
          : `#${reference.index + 1}`
  if (url && outputKind === 'video') {
    return (
      <video
        src={url}
        muted
        preload="metadata"
        aria-label={name}
        className="h-full w-full object-cover"
        onError={() => setUrl(null)}
      />
    )
  }
  return url && outputKind !== 'audio' ? (
    <img src={url} alt={name} className="h-full w-full object-cover" onError={() => setUrl(null)} />
  ) : (
    <span className="line-clamp-3 break-all p-1 text-[11px] text-muted-foreground">{name}</span>
  )
}

function MediaSlot({
  field,
  value,
  onChange,
}: {
  field: Extract<Field, { type: 'media' }>
  value: MediaRef[]
  onChange: (value: MediaRef[]) => void
}) {
  const { t } = useTranslation()
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const candidates = mediaItems.filter((item) => kindOfMime(item.mimeType) === field.media)
  const full = value.length >= field.max

  const add = (references: MediaRef[]) => {
    setError(null)
    const next = [...value]
    for (const reference of references) {
      if (next.some((existing) => sameValue(existing, reference))) continue
      if (next.length >= field.max) {
        if (field.max === 1) next.splice(0, 1)
        else {
          setError(t('generate.form.tooMany', { max: field.max }))
          break
        }
      }
      next.push(reference)
    }
    onChange(next)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setOver(false)
    const output = event.dataTransfer.getData(OUTPUT_DRAG_TYPE)
    if (output) {
      const parsed = JSON.parse(output) as { job: string; index: number; mime: string }
      if (kindOfMime(parsed.mime) !== field.media) {
        setError(t('generate.form.wrongKind', { kind: t(`generate.media.${field.media}`) }))
        return
      }
      add([{ job: parsed.job, index: parsed.index }])
      return
    }
    const raw = event.dataTransfer.getData('application/json')
    const data = raw ? (JSON.parse(raw) as ReturnType<typeof getMediaDragData>) : getMediaDragData()
    if (!data) return
    const items: Array<{ mediaId?: string; mediaType?: string }> =
      data.type === 'media-item'
        ? [{ mediaId: data.mediaId, mediaType: data.mediaType }]
        : data.type === 'media-items'
          ? (data.items ?? []).map((item) => ({ mediaId: item.mediaId, mediaType: item.mediaType }))
          : []
    const fitting = items.filter(
      (item): item is { mediaId: string; mediaType: string } =>
        !!item.mediaId && item.mediaType === field.media,
    )
    if (fitting.length < items.length) {
      setError(t('generate.form.wrongKind', { kind: t(`generate.media.${field.media}`) }))
    }
    add(fitting.map((item) => ({ media: item.mediaId })))
  }

  return (
    <div className="space-y-1">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid={`generate-media-${field.key}`}
        className={cn(
          'flex min-h-14 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-secondary/20 p-1.5',
          over && 'border-primary bg-primary/10',
        )}
      >
        {value.map((reference, index) => (
          <div
            key={JSON.stringify(reference)}
            className="group relative h-12 w-12 overflow-hidden rounded border border-border bg-background"
          >
            <MediaThumb reference={reference} />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, at) => at !== index))}
              className="absolute right-0 top-0 hidden rounded-bl bg-black/70 p-0.5 group-hover:block"
              aria-label={t('generate.form.remove')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {!full && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary"
                aria-label={t('generate.form.pick')}
              >
                <Plus className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              {candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('generate.form.noMedia', { kind: t(`generate.media.${field.media}`) })}
                </p>
              ) : (
                <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto">
                  {candidates.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      title={item.fileName}
                      onClick={() => add([{ media: item.id }])}
                      className="h-14 overflow-hidden rounded border border-border hover:border-primary"
                    >
                      <MediaThumb reference={{ media: item.id }} />
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
        {value.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t('generate.form.dropHere', { kind: t(`generate.media.${field.media}`) })}
          </span>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

function optionIndex(options: Array<{ value: unknown }>, value: unknown): string {
  const index = options.findIndex((option) => sameValue(option.value, value))
  return index === -1 ? '' : String(index)
}

interface FieldControlProps {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}

/** How much of the model's limit a text uses, shown once it is past four fifths of it. */
function LengthCount({ field, value }: { field: Field; value: unknown }) {
  const { t } = useTranslation()
  if ((field.type !== 'text' && field.type !== 'textarea') || field.max_length === undefined)
    return null
  const count = typeof value === 'string' ? Array.from(value).length : 0
  if (count < field.max_length * 0.8) return null
  const over = count > field.max_length
  return (
    <p
      className={cn(
        'text-right text-[11px] tabular-nums',
        over ? 'text-destructive' : 'text-muted-foreground',
      )}
      aria-live="polite"
    >
      {over
        ? t('generate.form.tooLong', { count, max: field.max_length })
        : t('generate.form.length', { count, max: field.max_length })}
    </p>
  )
}

export function FieldControl({ field, value, onChange }: FieldControlProps) {
  const { t } = useTranslation()
  const effective = value ?? field.default
  const id = useId()
  const label = (
    <Label
      htmlFor={field.type === 'media' ? undefined : id}
      className="flex items-baseline gap-1 text-[11px] text-muted-foreground"
      title={field.description && providerWords(t, field.description)}
    >
      <span>{fieldLabel(t, field)}</span>
      {field.required && <span className="text-destructive">*</span>}
    </Label>
  )

  switch (field.type) {
    case 'textarea':
      return (
        <div className="space-y-1">
          {label}
          <Textarea
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.description ? providerWords(t, field.description) : ''}
            data-testid={`generate-field-${field.key}`}
            aria-invalid={overLength(field, value) !== null}
            className={cn(
              'resize-y bg-secondary/30 text-xs',
              field.role === 'prompt' ? 'min-h-24' : 'min-h-14',
            )}
          />
          <LengthCount field={field} value={value} />
        </div>
      )
    case 'text':
      return (
        <div className="space-y-1">
          {label}
          <Input
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder={typeof field.default === 'string' ? field.default : ''}
            aria-invalid={overLength(field, value) !== null}
            className="h-7 text-xs"
          />
          <LengthCount field={field} value={value} />
        </div>
      )
    case 'integer':
    case 'number':
      return (
        <div className="space-y-1">
          {label}
          <Input
            id={id}
            type="number"
            value={typeof value === 'number' ? value : ''}
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            step={field.type === 'integer' ? 1 : 'any'}
            placeholder={
              field.default !== undefined && field.default !== null ? String(field.default) : ''
            }
            onChange={(event) => {
              const text = event.target.value
              if (text === '') return onChange(undefined)
              const number = field.type === 'integer' ? Math.round(Number(text)) : Number(text)
              if (Number.isFinite(number)) onChange(number)
            }}
            className="h-7 text-xs"
          />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-2 py-0.5">
          {label}
          <Switch
            id={id}
            checked={effective === true}
            onCheckedChange={(checked) => onChange(checked)}
            aria-label={fieldLabel(t, field)}
          />
        </div>
      )
    case 'select':
    case 'size':
      return (
        <div className="space-y-1">
          {label}
          <Select
            value={optionIndex(field.options, effective)}
            onValueChange={(index) => onChange(field.options[Number(index)]?.value)}
          >
            <SelectTrigger
              id={id}
              className="h-7 text-xs"
              data-testid={`generate-field-${field.key}`}
            >
              <SelectValue placeholder={t('generate.form.default')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {field.options.map((option, index) => (
                <SelectItem key={index} value={String(index)} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'media':
      return (
        <div className="space-y-1" role="group" aria-label={fieldLabel(t, field)}>
          {label}
          <MediaSlot
            field={field}
            value={Array.isArray(value) ? (value as MediaRef[]) : value ? [value as MediaRef] : []}
            onChange={(next) => onChange(next.length ? next : undefined)}
          />
        </div>
      )
  }
}
