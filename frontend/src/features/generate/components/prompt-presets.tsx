import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookMarked, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGenerateStore } from '../stores/generate-store'

/**
 * Prompts kept under a name, as the competitors' prompt presets: one puts a kept prompt into the field, the
 * field's own text is kept under a new name, a kept one is removed. They live with the panel's choices on the
 * server, so every window has them.
 */
export function PromptPresets({ text, onUse }: { text: string; onUse: (text: string) => void }) {
  const { t } = useTranslation()
  const presets = useGenerateStore((state) => state.presets)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const keep = () => {
    if (!name.trim() || !text.trim()) return
    useGenerateStore.getState().savePreset(name.trim(), text)
    setName('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground"
          title={t('generate.presets.hint')}
        >
          <BookMarked className="h-3 w-3" />
          {t('generate.presets.button')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-2">
        {presets.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">
            {t('generate.presets.empty')}
          </p>
        ) : (
          <ul
            className="max-h-56 space-y-0.5 overflow-y-auto"
            aria-label={t('generate.presets.button')}
          >
            {presets.map((preset) => (
              <li
                key={preset.name}
                className="group flex items-center gap-1 rounded hover:bg-secondary/60"
              >
                <button
                  type="button"
                  onClick={() => {
                    onUse(preset.text)
                    setOpen(false)
                  }}
                  className="min-w-0 flex-1 px-2 py-1 text-left"
                  title={preset.text}
                >
                  <span className="block truncate text-xs font-medium">{preset.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {preset.text}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => useGenerateStore.getState().removePreset(preset.name)}
                  aria-label={t('generate.presets.remove', { name: preset.name })}
                  title={t('generate.presets.remove', { name: preset.name })}
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
          className="flex items-center gap-1.5 border-t border-border pt-2"
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('generate.presets.name')}
            aria-label={t('generate.presets.name')}
            className="h-7 flex-1 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!name.trim() || !text.trim()}
            title={t('generate.presets.keepHint')}
          >
            <Plus className="h-3 w-3" />
            {t('generate.presets.keep')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
