import { memo, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import type { LottieBrowseCategory } from '../services/lottiefiles-api'
import { LOTTIE_PAGE_SIZE, useLottieBrowserStore } from '../stores/lottie-browser-store'
import { LottieCard } from './lottie-card'

const CATEGORIES: LottieBrowseCategory[] = ['featured', 'popular', 'recent']

function LottieBrowserPanelComponent() {
  const { t } = useTranslation()

  const category = useLottieBrowserStore((s) => s.category)
  const query = useLottieBrowserStore((s) => s.query)
  const items = useLottieBrowserStore((s) => s.items)
  const status = useLottieBrowserStore((s) => s.status)
  const error = useLottieBrowserStore((s) => s.error)
  const page = useLottieBrowserStore((s) => s.page)
  const totalCount = useLottieBrowserStore((s) => s.totalCount)
  const hasFetched = useLottieBrowserStore((s) => s.hasFetched)
  const importingIds = useLottieBrowserStore((s) => s.importingIds)
  const importedIds = useLottieBrowserStore((s) => s.importedIds)
  const failedIds = useLottieBrowserStore((s) => s.failedIds)

  const setCategory = useLottieBrowserStore((s) => s.setCategory)
  const setQuery = useLottieBrowserStore((s) => s.setQuery)
  const refresh = useLottieBrowserStore((s) => s.refresh)
  const goToPage = useLottieBrowserStore((s) => s.goToPage)
  const importAnimation = useLottieBrowserStore((s) => s.importAnimation)

  const [inputValue, setInputValue] = useState(query)
  const isSearching = inputValue.trim().length > 0

  // Editable page number. Mirrors the store's page; typing + Enter/blur jumps.
  const [pageInput, setPageInput] = useState('1')

  // Debounce the search box into the committed query.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(inputValue.trim()), 300)
    return () => window.clearTimeout(id)
  }, [inputValue, setQuery])

  // (Re)load from page 1 whenever the feed or committed query changes — also
  // runs on mount.
  useEffect(() => {
    void refresh()
  }, [category, query, refresh])

  // Jump the scroll position back to the top on every page change.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page])

  const totalPages = Math.max(1, Math.ceil(totalCount / LOTTIE_PAGE_SIZE))

  // Keep the editable field in sync when the page changes elsewhere (arrows,
  // new search, etc).
  useEffect(() => {
    setPageInput(String(page + 1))
  }, [page])

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isFinite(parsed)) {
      const targetIndex = Math.min(Math.max(parsed, 1), totalPages) - 1
      if (targetIndex !== page) {
        void goToPage(targetIndex)
        return
      }
    }
    // Invalid or unchanged — restore the current page number.
    setPageInput(String(page + 1))
  }
  const isLoading = status === 'loading'
  // Treat the render before the first fetch resolves as loading so the empty
  // state never flashes on mount (store starts idle with no items).
  const isInitialLoading = (isLoading || !hasFetched) && items.length === 0
  const showEmpty = hasFetched && status === 'idle' && totalCount === 0
  const showGrid = items.length > 0 && status !== 'error'
  // Driven by totalPages, not the current page's item count: a page that maps
  // to no importable items still needs the pager so the user can move on.
  const showPager = status !== 'error' && totalPages > 1
  const canPrev = page > 0 && !isLoading
  const canNext = page < totalPages - 1 && !isLoading

  return (
    <div className="flex h-full flex-col">
      {/* Search + feed controls */}
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder={t('lottieBrowser.searchPlaceholder')}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {inputValue.length > 0 && (
            <button
              type="button"
              onClick={() => setInputValue('')}
              aria-label={t('lottieBrowser.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {!isSearching && (
          <div className="flex gap-1">
            {CATEGORIES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                  category === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {t(`lottieBrowser.categories.${id}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {isInitialLoading && (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">{error ?? t('lottieBrowser.error')}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md bg-secondary px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary/80"
            >
              {t('lottieBrowser.retry')}
            </button>
          </div>
        )}

        {showEmpty && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {t('lottieBrowser.empty')}
          </p>
        )}

        {showGrid && (
          <div
            className={cn('grid grid-cols-2 gap-3 transition-opacity', isLoading && 'opacity-60')}
          >
            {items.map((animation) => (
              <LottieCard
                key={animation.id}
                animation={animation}
                isImporting={importingIds.has(animation.id)}
                isImported={importedIds.has(animation.id)}
                isFailed={failedIds.has(animation.id)}
                onImport={importAnimation}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pager */}
      {showPager && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => void goToPage(page - 1)}
            disabled={!canPrev}
            aria-label={t('lottieBrowser.previous')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              onBlur={commitPageInput}
              aria-label={t('lottieBrowser.goToPage')}
              className="h-6 w-11 rounded border border-input bg-transparent text-center text-[11px] tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {t('lottieBrowser.ofTotal', { total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => void goToPage(page + 1)}
            disabled={!canNext}
            aria-label={t('lottieBrowser.next')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Attribution / licensing note */}
      <div className="border-t border-border px-3 py-2">
        <p className="text-[10px] leading-tight text-muted-foreground">
          <Trans
            i18nKey="lottieBrowser.attributionNote"
            components={{
              license: (
                <a
                  href="https://lottiefiles.com/page/license"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                />
              ),
            }}
          />
        </p>
      </div>
    </div>
  )
}

export const LottieBrowserPanel = memo(LottieBrowserPanelComponent)
