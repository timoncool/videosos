import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { DirectLinkableProperty } from '@/types/keyframe'
import {
  EXPRESSION_GUIDE_ITEMS,
  EXPRESSION_GUIDE_SECTIONS,
  getExpressionPresets,
  type ExpressionGuideSectionId,
} from './dopesheet-expression-catalog'

interface DopesheetExpressionGuideProps {
  property: DirectLinkableProperty
  onApplyPreset: (source: string) => void
  onClose: () => void
}

export function DopesheetExpressionGuide({
  property,
  onApplyPreset,
  onClose,
}: DopesheetExpressionGuideProps) {
  const [activeSection, setActiveSection] = useState<ExpressionGuideSectionId>('basics')
  const presets = getExpressionPresets(property)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border/70 bg-background/60"
      role="region"
      aria-label="Expression syntax guide"
    >
      <div className="flex h-6 flex-shrink-0 items-center border-b border-border/60 px-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[9px]"
          onClick={onClose}
          aria-label="Close expression syntax guide"
        >
          <ArrowLeft className="h-2.5 w-2.5" />
          Syntax
        </Button>
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-0.5" role="tablist">
          {EXPRESSION_GUIDE_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              className={cn(
                'h-5 rounded px-1.5 text-[8px] text-muted-foreground hover:bg-accent hover:text-foreground',
                activeSection === section.id && 'bg-accent text-foreground',
              )}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="tabpanel">
        {activeSection === 'recipes' ? (
          <div className="grid grid-cols-2 gap-1">
            {presets.map((preset) => (
              <button
                key={`${preset.group}-${preset.label}`}
                type="button"
                className="min-w-0 rounded border border-border/60 bg-background/70 px-1.5 py-1 text-left hover:border-sky-500/50 hover:bg-sky-500/5"
                title={`${preset.description}\n${preset.source}`}
                onClick={() => onApplyPreset(preset.source)}
              >
                <span className="block truncate text-[9px] text-foreground">{preset.label}</span>
                <span className="block truncate font-mono text-[8px] text-muted-foreground">
                  {preset.source}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {EXPRESSION_GUIDE_ITEMS[activeSection].map((item) => (
              <div
                key={item.title}
                className="min-w-0 rounded border border-border/60 bg-background/70 px-1.5 py-1"
                title={item.description}
              >
                <div className="flex items-baseline gap-1">
                  <span className="shrink-0 text-[8px] font-medium text-foreground">
                    {item.title}
                  </span>
                  <code className="truncate text-[8px] text-sky-300">{item.syntax}</code>
                </div>
                <div className="truncate text-[8px] text-muted-foreground">{item.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
