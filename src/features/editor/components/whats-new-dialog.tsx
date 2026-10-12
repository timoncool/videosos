import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Sparkles, Bug, Zap, ArrowRight } from 'lucide-react'
import { i18n } from '@/i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/shared/ui/cn'
import changelogData from '@/data/changelog.json'
import type { ChangelogEntry, ChangelogFile, ChangelogGroup } from '@/data/changelog-types'
import { markChangelogSeen } from './whats-new-seen'

const data = changelogData as ChangelogFile
const GROUP_CONFIG: Record<
  ChangelogGroup,
  { labelKey: string; icon: ComponentType<{ className?: string }> }
> = {
  added: { labelKey: 'editor.whatsNew.groupAdded', icon: Sparkles },
  fixed: { labelKey: 'editor.whatsNew.groupFixed', icon: Bug },
  improved: { labelKey: 'editor.whatsNew.groupImproved', icon: Zap },
}

const GROUP_ORDER: ChangelogGroup[] = ['added', 'fixed', 'improved']

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function formatEntryLabel(entry: ChangelogEntry): string {
  return entry.version === 'current' ? i18n.t('editor.whatsNew.thisWeek') : entry.version
}

function formatWeekRange(mondayIso: string): string {
  const monday = new Date(`${mondayIso}T00:00:00Z`)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  })
  return `${fmt.format(monday)} — ${fmt.format(sunday)}`
}

function formatEntrySubtitle(entry: ChangelogEntry): string {
  if (entry.subtitleKey) return i18n.t(`changelog.${entry.subtitleKey}`)
  if (entry.version === 'current')
    return i18n.t('editor.whatsNew.asOf', { date: formatSingleDate(entry.date) })
  return i18n.t('editor.whatsNew.weekOf', { range: formatWeekRange(entry.date) })
}

function formatSingleDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

interface WhatsNewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const { t } = useTranslation()
  const entries = useMemo<ChangelogEntry[]>(
    () => (data.current ? [data.current, ...data.releases] : data.releases),
    [],
  )

  const [selectedVersion, setSelectedVersion] = useState<string>(() => entries[0]?.version ?? '')

  useEffect(() => {
    if (open) markChangelogSeen()
  }, [open])

  const selected = entries.find((e) => e.version === selectedVersion) ?? entries[0]
  const latestReleaseVersion = data.releases[0]?.version

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[72vh] p-0 flex flex-col overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t('editor.whatsNew.title')}
          </DialogTitle>
        </DialogHeader>
        <Separator />
        <div className="flex flex-1 overflow-hidden min-h-0">
          <nav className="w-56 border-r shrink-0 bg-muted/20">
            <ScrollArea className="h-full">
              <ul className="p-2 space-y-0.5">
                {entries.map((entry) => {
                  const isCurrent = entry.version === 'current'
                  const isSelected = selectedVersion === entry.version
                  return (
                    <li key={entry.version}>
                      <button
                        type="button"
                        onClick={() => setSelectedVersion(entry.version)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{formatEntryLabel(entry)}</span>
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                              {t('editor.whatsNew.newBadge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {formatEntrySubtitle(entry)}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          </nav>
          <ScrollArea className="flex-1 min-w-0">
            {selected && <ChangelogEntryView entry={selected} />}
          </ScrollArea>
        </div>
        <Separator />
        <div className="px-6 py-3 flex justify-between items-center text-xs text-muted-foreground">
          <span>
            {latestReleaseVersion
              ? t('editor.whatsNew.released', { version: latestReleaseVersion })
              : t('editor.whatsNew.preRelease')}
          </span>
          <Link
            to="/changelog"
            className="flex items-center gap-1 hover:text-foreground hover:underline"
          >
            {t('editor.whatsNew.fullChangelog')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChangelogEntryView({ entry }: { entry: ChangelogEntry }) {
  return (
    <div className="px-6 py-5 space-y-6">
      {GROUP_ORDER.map((groupKey) => {
        const items = entry.groups[groupKey]
        if (!items || items.length === 0) return null
        const { labelKey, icon: Icon } = GROUP_CONFIG[groupKey]
        return (
          <section key={groupKey} className="space-y-2.5">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              {i18n.t(labelKey)}
            </h3>
            <ul className="space-y-1.5 list-disc pl-5 marker:text-muted-foreground/60">
              {items.map((item, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  {capitalize(item.title)}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
