import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useState } from 'react'
import { BookOpenText, Braces, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { DirectLinkableProperty } from '@/types/keyframe'
import { DopesheetExpressionPresetsMenu } from './dopesheet-expression-menus'
import { DopesheetExpressionGuide } from './dopesheet-expression-guide'
import { PickWhipIcon } from './pick-whip-icon'

export const EXPRESSION_DOCK_HEIGHT = 154

interface DopesheetExpressionDockProps {
  property: DirectLinkableProperty
  propertyLabel: string
  source: string
  enabled: boolean
  preExpressionDisplay: string
  postExpressionDisplay: string
  error?: string
  hasStoredExpression: boolean
  pickingReference: boolean
  rootRef: RefObject<HTMLElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onSourceChange: (source: string, selectionStart: number, selectionEnd: number) => void
  onSelectionChange: (selectionStart: number, selectionEnd: number) => void
  onToggleEnabled: () => void
  onApplyPreset: (source: string) => void
  onReferencePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    selectionStart: number,
    selectionEnd: number,
  ) => void
  onToggleReferencePicking: (selectionStart: number, selectionEnd: number) => void
  onRemove: () => void
  onCancel: () => void
  onApply: () => void
}

export function DopesheetExpressionDock({
  property,
  propertyLabel,
  source,
  enabled,
  preExpressionDisplay,
  postExpressionDisplay,
  error,
  hasStoredExpression,
  pickingReference,
  rootRef,
  textareaRef,
  onSourceChange,
  onSelectionChange,
  onToggleEnabled,
  onApplyPreset,
  onReferencePointerDown,
  onToggleReferencePicking,
  onRemove,
  onCancel,
  onApply,
}: DopesheetExpressionDockProps) {
  const [showSyntaxGuide, setShowSyntaxGuide] = useState(false)
  const getSelection = () => ({
    selectionStart: textareaRef.current?.selectionStart ?? source.length,
    selectionEnd: textareaRef.current?.selectionEnd ?? source.length,
  })

  return (
    <section
      ref={rootRef}
      className="flex flex-shrink-0 flex-col border-t border-border bg-background/95 shadow-[0_-8px_24px_rgba(0,0,0,0.22)]"
      style={{ height: EXPRESSION_DOCK_HEIGHT }}
      role="region"
      aria-label={`${propertyLabel} expression editor`}
      data-testid="dopesheet-expression-dock"
    >
      <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Braces className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-[11px] font-medium text-foreground">{propertyLabel} expression</span>
        <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-sky-300">
          Advanced
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-6 px-2 text-[10px]', enabled ? 'text-sky-300' : 'text-muted-foreground')}
          aria-pressed={enabled}
          onClick={onToggleEnabled}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {hasStoredExpression ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px] text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={Boolean(error)}
            onClick={onApply}
          >
            Apply
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-2 p-2">
        <div className="flex min-w-0 flex-col gap-1">
          {showSyntaxGuide ? (
            <DopesheetExpressionGuide
              property={property}
              onApplyPreset={onApplyPreset}
              onClose={() => setShowSyntaxGuide(false)}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 text-[9px]">
                <div className="min-w-0 rounded border border-border/70 bg-background/70 px-2 py-1">
                  <div className="text-muted-foreground">Pre-expression</div>
                  <div className="truncate font-mono text-foreground">{preExpressionDisplay}</div>
                </div>
                <div className="min-w-0 rounded border border-border/70 bg-background/70 px-2 py-1">
                  <div className="text-muted-foreground">Post-expression</div>
                  <div className="truncate font-mono text-foreground">{postExpressionDisplay}</div>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-1">
                <DopesheetExpressionPresetsMenu property={property} onSelect={onApplyPreset} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-7 cursor-crosshair gap-1 px-2 text-[10px] text-muted-foreground hover:text-sky-300',
                    pickingReference && 'bg-sky-500/10 text-sky-300',
                  )}
                  aria-label={`Pick a reference property for ${propertyLabel}`}
                  aria-pressed={pickingReference}
                  title="Click, then choose a highlighted property; or drag directly"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const selection = getSelection()
                    onReferencePointerDown(event, selection.selectionStart, selection.selectionEnd)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    const selection = getSelection()
                    onToggleReferencePicking(selection.selectionStart, selection.selectionEnd)
                  }}
                >
                  <PickWhipIcon className="h-3 w-3" />
                  {pickingReference ? 'Choose property…' : 'Pick property'}
                </Button>
                {pickingReference ? (
                  <span className="truncate text-[9px] text-sky-300" role="status">
                    Click a highlighted row · Esc to cancel
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-sky-300"
                  onClick={() => setShowSyntaxGuide(true)}
                  aria-label="Open expression syntax guide"
                >
                  <BookOpenText className="h-3 w-3" />
                  Syntax
                </Button>
              </div>

              <div className="truncate rounded bg-background/60 px-2 py-1 font-mono text-[8px] text-muted-foreground">
                value · time · frame · sin/cos/abs · min/max/clamp/lerp · [x, y]
              </div>
            </>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-1">
          <textarea
            ref={textareaRef}
            autoFocus
            autoComplete="off"
            data-bwignore="true"
            spellCheck={false}
            value={source}
            onChange={(event) =>
              onSourceChange(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              )
            }
            onSelect={(event) =>
              onSelectionChange(
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              )
            }
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                if (!error) onApply()
              }
            }}
            className={cn(
              'min-h-0 flex-1 resize-none rounded border bg-background px-2 py-1.5 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-sky-500/70',
              error ? 'border-red-500/60' : 'border-border',
            )}
            aria-label={`${propertyLabel} expression source`}
          />
          {error ? (
            <div className="truncate rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-300">
              {error}
            </div>
          ) : (
            <div className="text-right text-[9px] text-muted-foreground">
              Ctrl/Cmd+Enter to apply
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
