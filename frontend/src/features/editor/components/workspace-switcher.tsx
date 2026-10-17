import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Palette, Scissors, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import type { EditorWorkspaceId } from '@/config/editor-workspaces'

const WORKSPACE_ITEMS: readonly {
  id: EditorWorkspaceId
  icon: LucideIcon
  labelKey: string
}[] = [
  { id: 'edit', icon: Scissors, labelKey: 'toolbar.workspaces.edit' },
  { id: 'color', icon: Palette, labelKey: 'toolbar.workspaces.color' },
  { id: 'motion', icon: Layers, labelKey: 'toolbar.workspaces.motion' },
  { id: 'canvas', icon: Workflow, labelKey: 'toolbar.workspaces.canvas' },
]

/**
 * DaVinci-style workspace tabs. Switching applies a panel layout preset
 * (scopes, inspector tab, sidebar tab, timeline split) without touching
 * selection, playhead, or project state.
 */
export const WorkspaceSwitcher = memo(function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const workspace = useEditorStore((s) => s.workspace)
  const setWorkspace = useEditorStore((s) => s.setWorkspace)

  return (
    <div
      role="tablist"
      aria-label={t('toolbar.workspaces.label')}
      className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {WORKSPACE_ITEMS.map(({ id, icon: Icon, labelKey }) => {
        const isActive = workspace === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setWorkspace(id)}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors min-[1280px]:px-3',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden min-[1280px]:inline">{t(labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
})
