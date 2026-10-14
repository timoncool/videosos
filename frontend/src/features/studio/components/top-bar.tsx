import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, HelpCircle, Plus, Settings } from 'lucide-react'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'
import WhatsNew from './whats-new'
import { JournalPanel } from './journal-panel'
import { journalSentence, useJournal } from '../services/journal'
import { openSettings } from '../services/settings-nav'

/** The places the bar leads to; the app owns the router. */
export type TopBarPlace = '/projects' | '/projects/new' | '/docs'

/** The last thing VideoSOS or an agent did, in the middle of the bar; a click opens the whole journal (Dub Studio's status bar). */
function StatusBar() {
  const { t } = useTranslation()
  const { lines } = useJournal()
  const [open, setOpen] = useState(false)
  const last = lines[0]
  const text = last ? journalSentence(t, last) : t('status.idle')
  const errored = last?.tone === 'error'
  return (
    <div className="relative flex min-w-0 flex-1 justify-center px-1 sm:px-3">
      <span className="sr-only" role="status" aria-live="polite">
        {text}
      </span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t('journal.title')}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-2 rounded-md px-3 py-1 text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${errored ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)]'}`}
        />
        <span className="truncate">{text}</span>
        {lines.length > 0 && (
          <ChevronDown
            size={13}
            className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {open && <JournalPanel onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The bar over every screen, as Dub Studio has it: the name and version, the editor's modes (portalled into
 * `editor-modes-slot`), the status in the middle, the docked monitors (`dock-slot`), the editor's own buttons
 * (`editor-actions-slot`), then New, What's new, Help, Settings and the language; an agent's action is
 * captioned just under it (`agent-caption-slot`).
 */
export function TopBar({ go }: { go: (place: TopBarPlace) => void }) {
  const { t } = useTranslation()
  return (
    <header className="relative flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:px-4 lg:h-14 lg:flex-nowrap min-[1440px]:px-5">
      <button
        type="button"
        onClick={() => go('/projects')}
        title={t('topbar.projects')}
        className="order-1 flex h-14 shrink-0 items-center gap-2 font-bold tracking-tight"
      >
        <img
          src="/videosos-icon.svg"
          alt=""
          width={20}
          height={20}
          className="rounded-[5px] shadow-[0_0_10px_rgba(124,58,237,0.35)]"
        />
        <span className="hidden sm:inline">{t('app.name')}</span>
        <span className="hidden text-[11px] font-normal tracking-normal text-[var(--color-muted)] min-[1440px]:inline">
          v{__APP_VERSION__}
        </span>
      </button>
      {/* Below lg the editor's modes and buttons move to a second row, under the app's own. */}
      <div
        id="editor-modes-slot"
        className="order-5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1.5 empty:hidden lg:order-2 lg:ml-1 lg:flex-none lg:overflow-visible lg:py-0"
      />
      <div className="order-2 flex min-w-0 flex-1 lg:order-3">
        <StatusBar />
      </div>
      <div
        id="editor-actions-slot"
        className="order-6 flex shrink-0 items-center gap-2 py-1.5 empty:hidden lg:order-5 lg:py-0"
      />
      <div id="dock-slot" className="order-3 flex shrink-0 items-center gap-2 empty:hidden lg:order-4" />
      <div className="order-3 flex shrink-0 items-center gap-1 sm:gap-2 lg:order-6">
        <button
          type="button"
          onClick={() => go('/projects/new')}
          title={t('topbar.newTitle')}
          aria-label={t('topbar.newTitle')}
          className="inline-flex flex-col items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-text)] shadow-sm transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] sm:px-3"
        >
          <span className="flex items-center gap-1 whitespace-nowrap text-[12px] font-bold">
            <Plus size={13} /> <span className="hidden sm:inline">{t('topbar.new')}</span>
          </span>
          <span className="mt-0.5 hidden text-[11px] font-normal leading-none text-[var(--color-muted)] min-[1440px]:block">
            {t('topbar.newSub')}
          </span>
        </button>
        <WhatsNew />
        <button
          type="button"
          onClick={() => go('/docs')}
          title={t('topbar.help')}
          aria-label={t('topbar.help')}
          className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <HelpCircle size={18} />
        </button>
        <button
          type="button"
          onClick={() => openSettings('providers')}
          title={t('settings.title')}
          aria-label={t('settings.title')}
          className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <Settings size={18} />
        </button>
        <LanguageSwitcher size="sm" align="end" side="bottom" />
      </div>
      <div className="order-4 h-0 basis-full lg:hidden" />
      <div
        id="agent-caption-slot"
        className="pointer-events-none absolute left-1/2 top-full z-[80] mt-2 -translate-x-1/2"
      />
    </header>
  )
}
