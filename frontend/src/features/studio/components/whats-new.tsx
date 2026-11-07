import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X, ExternalLink } from 'lucide-react'
import newsData from '../data/news.json'
import { OPEN_NEWS_EVENT } from '../services/settings-nav'
import { reportNotice, useHubState, type HubState } from '../services/studio-hub'
import changelogRaw from '../../../../../CHANGELOG.md?raw'

type Localized = Record<string, string>
interface NewsItem {
  id: string
  date: string
  release?: string
  releaseButton?: string
  title: Localized
  body: Localized
}
interface ChangelogSection {
  key: string
  title: string
  items: string[]
}
interface ChangelogRelease {
  heading: string
  unreleased: boolean
  version: string
  date: string
  sections: ChangelogSection[]
}

const BUNDLED = newsData as NewsItem[]

// The hub's news on top: a new item reaches the program without a release; a shipped item with the same id is not repeated.
function useNews(lang: string): NewsItem[] {
  const hub: HubState | null = useHubState(lang)
  const fromHub: NewsItem[] = (hub?.items ?? [])
    .filter((item) => item.kind === 'news')
    .map((item) => {
      const local = item.content[lang] ?? item.content.en ?? Object.values(item.content)[0]
      const index = local?.buttons.findIndex((b) => b.action === 'url' && b.url) ?? -1
      return {
        id: `hub:${item.id}`,
        date: item.date ?? '',
        release: index >= 0 ? local?.buttons[index]?.url : undefined,
        releaseButton: index >= 0 ? `b${index}` : undefined,
        title: Object.fromEntries(Object.entries(item.content).map(([l, c]) => [l, c.title])),
        body: Object.fromEntries(Object.entries(item.content).map(([l, c]) => [l, c.body])),
      }
    })
    .filter((n) => !BUNDLED.some((b) => b.id === n.id.slice(4)))
    .sort((a, b) => b.date.localeCompare(a.date))
  return [...fromHub, ...BUNDLED]
}

const pick = (text: Localized, lang: string): string =>
  text[lang] ?? text.en ?? Object.values(text)[0] ?? ''
const SEEN_KEY = 'videosos-seen-news'

function readSeen(): string | null {
  return localStorage.getItem(SEEN_KEY)
}

function writeSeen(id: string): void {
  localStorage.setItem(SEEN_KEY, id)
}

function parseChangelog(raw: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  let release: ChangelogRelease | null = null
  let section: ChangelogSection | null = null
  for (const line of raw.split(/\r?\n/)) {
    const head = line.match(/^## (Unreleased|\d{4}-\d{2}-\d{2}) — (\S+)/)
    if (head?.[1] && head[2]) {
      release = {
        heading: line.slice(3),
        unreleased: head[1] === 'Unreleased',
        version: head[2],
        date: head[1],
        sections: [],
      }
      releases.push(release)
      section = null
      continue
    }
    const sec = line.match(/^### (.+)/)
    if (sec?.[1] && release) {
      section = { key: sec[1].trim().toLowerCase(), title: sec[1].trim(), items: [] }
      release.sections.push(section)
      continue
    }
    if (!section) continue
    const item = line.match(/^- (.+)/)
    if (item?.[1]) section.items.push(item[1])
    else if (/^\s{2,}\S/.test(line) && section.items.length)
      section.items[section.items.length - 1] += ' ' + line.trim()
  }
  return releases.filter((r) => r.sections.some((s) => s.items.length))
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)]+)/g

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((piece, i) => {
    const k = `${key}-${i}`
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4)
      return (
        <strong key={k} className="font-semibold text-[var(--color-text)]">
          {piece.slice(2, -2)}
        </strong>
      )
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2)
      return (
        <code key={k} className="mono text-[12px]">
          {piece.slice(1, -1)}
        </code>
      )
    const md = piece.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (md)
      return (
        <a
          key={k}
          href={md[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {md[1]}
        </a>
      )
    if (/^https?:\/\//.test(piece))
      return (
        <a
          key={k}
          href={piece}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline break-all"
        >
          {piece}
        </a>
      )
    return piece
  })
}

function NewsBody({ text }: { text: string }) {
  return (
    <div className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-[var(--color-muted)]">
      {text.split(/\n\s*\n/).map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        if (lines.length && lines.every((l) => l.trimStart().startsWith('- '))) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-[var(--color-muted)]">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.trimStart().slice(2), `${i}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{inline(block, String(i))}</p>
      })}
    </div>
  )
}

function NewsTab({ lang, news: NEWS }: { lang: string; news: NewsItem[] }) {
  const { t } = useTranslation()
  // the hub's news count as its notices do: seen once a launch, clicks by button or link
  const hubIds = NEWS.filter((n) => n.id.startsWith('hub:'))
    .map((n) => n.id.slice(4))
    .join(',')
  useEffect(() => {
    for (const id of hubIds ? hubIds.split(',') : [])
      reportNotice(id, 'shown').catch((e: Error) =>
        console.warn('[hub] news shown not recorded:', e.message),
      )
  }, [hubIds])
  if (NEWS.length === 0)
    return (
      <p className="text-[13px] text-[var(--color-muted)] py-6 text-center">{t('news.empty')}</p>
    )
  return (
    <div className="space-y-3">
      {NEWS.map((n) => (
        <article
          key={n.id}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5"
          onClickCapture={(e) => {
            const anchor = (e.target as HTMLElement).closest('a')
            if (!anchor || !n.id.startsWith('hub:')) return
            const button =
              anchor.getAttribute('href') === n.release && n.releaseButton
                ? n.releaseButton
                : 'link'
            reportNotice(n.id.slice(4), 'clicked', button).catch((err: Error) =>
              console.warn('[hub] news click not recorded:', err.message),
            )
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold">{pick(n.title, lang)}</h3>
            {n.date && (
              <time
                className="text-[11px] text-[var(--color-muted)] shrink-0 tabnum"
                dateTime={n.date}
              >
                {new Date(n.date).toLocaleDateString(lang)}
              </time>
            )}
          </div>
          <NewsBody text={pick(n.body, lang)} />
          {n.release && (
            <a
              href={n.release}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--color-accent)] hover:underline"
            >
              {t('news.releaseNotes')}
              <ExternalLink size={11} />
            </a>
          )}
        </article>
      ))}
    </div>
  )
}

function ChangelogTab() {
  const { t } = useTranslation()
  const releases = useMemo(() => parseChangelog(changelogRaw), [])
  const sectionTitle = (s: ChangelogSection): string => {
    switch (s.key) {
      case 'added':
        return t('news.sections.added')
      case 'changed':
        return t('news.sections.changed')
      case 'fixed':
        return t('news.sections.fixed')
      default:
        return s.title
    }
  }
  return (
    <div>
      <p className="text-[11px] text-[var(--color-muted)] mb-3">{t('news.changelogNote')}</p>
      <div className="space-y-5">
        {releases.map((r) => (
          <section key={r.heading}>
            <h3 className="text-[14px] font-semibold flex items-baseline gap-2">
              <span>
                {r.unreleased ? `${t('news.unreleased')} · ${r.version}` : `v${r.version}`}
              </span>
              {!r.unreleased && (
                <time
                  className="text-[11px] font-normal text-[var(--color-muted)] tabnum"
                  dateTime={r.date}
                >
                  {r.date}
                </time>
              )}
            </h3>
            {r.sections
              .filter((s) => s.items.length)
              .map((s) => (
                <div key={s.key} className="mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--color-accent)] mb-1">
                    {sectionTitle(s)}
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-[var(--color-muted)] marker:text-[var(--color-muted)]">
                    {s.items.map((it, i) => (
                      <li key={i}>{inline(it, `${r.heading}-${s.key}-${i}`)}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}

type Tab = 'news' | 'changelog'

function WhatsNewModal({ onClose, news }: { onClose: () => void; news: NewsItem[] }) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState<Tab>('news')
  const tabCls = (on: boolean) =>
    `px-3 py-1.5 rounded-md text-[13px] transition-colors ${on ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] border border-transparent'}`
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center glass-scrim anim-fade"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('news.title')}
        className="w-[min(92vw,680px)] max-h-[86vh] overflow-y-auto rounded-xl glass-panel anim-pop p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-2 font-semibold">
            <Sparkles size={17} className="text-[var(--color-accent)]" />
            {t('news.title')}
          </span>
          <button
            onClick={onClose}
            aria-label={t('news.close')}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-1.5 mb-4">
          <button onClick={() => setTab('news')} className={tabCls(tab === 'news')}>
            {t('news.tabNews')}
          </button>
          <button onClick={() => setTab('changelog')} className={tabCls(tab === 'changelog')}>
            {t('news.tabChangelog')}
          </button>
        </div>
        {tab === 'news' ? <NewsTab lang={i18n.language} news={news} /> : <ChangelogTab />}
      </div>
    </div>
  )
}

export default function WhatsNew() {
  const { t, i18n } = useTranslation()
  const NEWS = useNews(i18n.language)
  const latest = NEWS[0]?.id ?? null
  const [seen, setSeen] = useState<string | null>(readSeen)
  const [open, setOpen] = useState(false)
  const unseen = latest !== null && seen !== latest
  const show = () => {
    setOpen(true)
    if (latest) {
      writeSeen(latest)
      setSeen(latest)
    }
  }
  useEffect(() => {
    const open = () => {
      setOpen(true)
      if (latest) {
        writeSeen(latest)
        setSeen(latest)
      }
    }
    window.addEventListener(OPEN_NEWS_EVENT, open)
    return () => window.removeEventListener(OPEN_NEWS_EVENT, open)
  }, [latest])
  return (
    <>
      <button
        onClick={show}
        title={t('news.title')}
        aria-label={t('news.title')}
        className="relative p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <Sparkles size={16} />
        {unseen && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        )}
      </button>
      {open && <WhatsNewModal onClose={() => setOpen(false)} news={NEWS} />}
    </>
  )
}
