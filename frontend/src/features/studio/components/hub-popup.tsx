import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import {
  HUB_GRADIENTS,
  HUB_TEXT,
  hubMediaUrl,
  hubText,
  reportNotice,
  stackTheme,
  type HubButton,
  type HubItem,
} from '../services/studio-hub'
import { HubMarkdown } from './hub-markdown'

interface Props {
  item: HubItem
  /** Closed by the cross, Esc or a click outside: recorded as closed. */
  onClose: () => void
  onOpen: (target: NonNullable<HubButton['target']>) => void
}

/** A hub popup in the program's own dialog style: shown once, closed by Esc, the cross or a button. */
export function HubPopup({ item, onClose, onOpen }: Props) {
  const { t, i18n } = useTranslation()
  const content = hubText(item, i18n.language.split('-')[0] ?? 'en')
  const theme = stackTheme(item.theme, 0)

  useEffect(() => {
    reportNotice(item.id, 'shown').catch((error: Error) =>
      console.warn('[hub] popup shown not recorded:', error.message),
    )
  }, [item.id])

  const dismiss = useCallback(() => {
    reportNotice(item.id, 'dismissed').catch((error: Error) =>
      console.warn('[hub] popup close not recorded:', error.message),
    )
    onClose()
  }, [item.id, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && item.dismissible) dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item.dismissible, dismiss])

  if (!content) return null

  const press = (button: HubButton, index: number) => {
    reportNotice(
      item.id,
      button.action === 'dismiss' ? 'dismissed' : 'clicked',
      button.action === 'dismiss' ? undefined : `b${index}`,
    ).catch(() => undefined)
    if (button.action === 'url' && button.url)
      window.open(button.url, '_blank', 'noopener,noreferrer')
    if (button.action === 'open' && button.target) onOpen(button.target)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && item.dismissible) dismiss()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`hub-${item.id}`}
        className="anim-pop w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ background: HUB_GRADIENTS[theme], color: HUB_TEXT[theme] }}
        >
          <h2 id={`hub-${item.id}`} className="text-lg font-semibold leading-snug">
            {content.title}
          </h2>
          {item.dismissible && (
            <button
              type="button"
              onClick={dismiss}
              aria-label={t('hub.close')}
              title={t('hub.close')}
              className="rounded-md p-1 opacity-85 hover:opacity-100"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {item.image && (
          <img src={hubMediaUrl(item.image)} alt="" className="max-h-56 w-full object-cover" />
        )}
        <HubMarkdown
          text={content.body}
          className="space-y-2 px-5 py-4 text-sm leading-relaxed text-[var(--color-text)] [&_a]:text-[var(--color-accent)]"
        />
        {item.ad?.label && (
          <p className="px-5 pb-2 text-xs text-[var(--color-muted)]">
            {t('hub.ad')}
            {item.ad.erid ? ` · erid ${item.ad.erid}` : ''}
          </p>
        )}
        {content.buttons.length > 0 && (
          <div className="flex justify-end gap-2 px-5 pb-5">
            {content.buttons.map((button, index) => (
              <button
                key={index}
                type="button"
                onClick={() => press(button, index)}
                className={
                  button.style === 'primary'
                    ? 'rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90'
                    : 'rounded-xl bg-[var(--color-surface-2)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-overlay)]'
                }
                style={
                  button.style === 'primary'
                    ? { background: HUB_GRADIENTS[theme], color: HUB_TEXT[theme] }
                    : undefined
                }
              >
                {button.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
