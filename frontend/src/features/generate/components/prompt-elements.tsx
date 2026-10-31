import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, UsersRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Field, MediaRef } from '../services/generate-api'
import { useGenerateStore } from '../stores/generate-store'
import { MediaThumb } from './field-control'

const NAME = /^[\p{L}\p{N}_-]+$/u

/** Every picture the form holds, in its picture slots' order: what a new element is made of. */
function picturesOf(fields: Field[], values: Record<string, unknown>): MediaRef[] {
  return fields.flatMap((field) => {
    if (field.type !== 'media' || field.media !== 'image') return []
    const value = values[field.key]
    return (Array.isArray(value) ? value : value ? [value] : []) as MediaRef[]
  })
}

/**
 * The elements, as Kling's: characters, objects and places kept under a name with their pictures. One is put
 * into the prompt as "@name"; the pictures in the form are kept as a new one. They live with the panel's choices
 * on the server, so every window and every model has them.
 */
export function PromptElements({
  fields,
  values,
  onMention,
}: {
  fields: Field[]
  values: Record<string, unknown>
  onMention: (name: string) => void
}) {
  const { t } = useTranslation()
  const elements = useGenerateStore((state) => state.elements)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const pictures = picturesOf(fields, values)
  const valid = NAME.test(name.trim())
  const keep = () => {
    if (!valid || pictures.length === 0) return
    useGenerateStore.getState().saveElement({ name: name.trim(), refs: pictures })
    setName('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground"
          title={t('generate.elements.hint')}
        >
          <UsersRound className="h-3 w-3" />
          {t('generate.elements.button')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        {elements.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">
            {t('generate.elements.empty')}
          </p>
        ) : (
          <ul
            className="max-h-64 space-y-0.5 overflow-y-auto"
            aria-label={t('generate.elements.button')}
          >
            {elements.map((element) => (
              <li
                key={element.name}
                className="group flex items-center gap-1 rounded hover:bg-secondary/60"
              >
                <button
                  type="button"
                  onClick={() => {
                    onMention(element.name)
                    setOpen(false)
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                  title={t('generate.elements.use', { name: element.name })}
                >
                  <span className="flex shrink-0 gap-0.5">
                    {element.refs.slice(0, 3).map((ref, index) => (
                      <span key={index} className="h-7 w-7 overflow-hidden rounded-sm bg-secondary">
                        <MediaThumb reference={ref} />
                      </span>
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">@{element.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t('generate.elements.pictures', { count: element.refs.length })}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => useGenerateStore.getState().removeElement(element.name)}
                  aria-label={t('generate.elements.remove', { name: element.name })}
                  title={t('generate.elements.remove', { name: element.name })}
                  className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            keep()
          }}
          className="space-y-1 border-t border-border pt-2"
        >
          <div className="flex items-center gap-1.5">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('generate.elements.name')}
              aria-label={t('generate.elements.name')}
              aria-invalid={name.trim() !== '' && !valid}
              className="h-7 flex-1 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!valid || pictures.length === 0}
            >
              <Plus className="h-3 w-3" />
              {t('generate.elements.keep')}
            </Button>
          </div>
          <p
            className={
              name.trim() !== '' && !valid
                ? 'text-[11px] text-destructive'
                : 'text-[11px] text-muted-foreground'
            }
          >
            {name.trim() !== '' && !valid
              ? t('generate.elements.badName')
              : pictures.length === 0
                ? t('generate.elements.noPictures')
                : t('generate.elements.keepHint', { count: pictures.length })}
          </p>
        </form>
      </PopoverContent>
    </Popover>
  )
}
