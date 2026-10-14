import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Bug,
  ChevronDown,
  Download,
  FileCode,
  FolderArchive,
  Keyboard,
  ListVideo,
  Save,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { LocalInferenceStatusPill } from './local-inference-status-pill'
import { ProjectDebugPanel } from './project-debug-panel'
import { ShortcutsDialog } from './shortcuts-dialog'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'
import { WorkspaceSwitcher } from './workspace-switcher'
import { cn } from '@/shared/ui/cn'
import { useDebugStore } from '@/features/editor/stores/debug-store'
import { useItemsStore, useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'

const SAVE_ANIMATION_MIN_MS = 1800

const SaveDirtyIndicator = memo(function SaveDirtyIndicator() {
  const isDirty = useTimelineSettingsStore((state) => state.isDirty)
  return isDirty ? (
    <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-orange-500" />
  ) : null
})

function formatProjectDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

interface ToolbarProps {
  projectId: string
  project: {
    id: string
    name: string
    width: number
    height: number
    fps: number
  }
  onSave?: () => Promise<void>
  onExport?: () => void
  onExportBundle?: () => void
  onExportFcpxml?: () => void
  onOpenRenderQueue?: () => void
  /** Number of queued + rendering jobs, shown as a badge on the queue button. */
  renderQueueCount?: number
}

export const Toolbar = memo(function Toolbar({
  projectId,
  project,
  onSave,
  onExport,
  onExportBundle,
  onExportFcpxml,
  onOpenRenderQueue,
  renderQueueCount = 0,
}: ToolbarProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [isSaveAnimating, setIsSaveAnimating] = useState(false)
  const [saveAnimationKey, setSaveAnimationKey] = useState(0)
  const saveAnimationTimeoutRef = useRef<number | undefined>(undefined)
  const itemCount = useItemsStore((state) => state.items.length)
  const maxItemEndFrame = useItemsStore((state) => state.maxItemEndFrame)
  const mediaDependencyIds = useItemsStore((state) => state.mediaDependencyIds)
  const brokenMediaIds = useMediaLibraryStore((state) => state.brokenMediaIds)
  const projectSummary = useMemo(
    () => {
      const projectMediaIds = new Set(mediaDependencyIds)
      return {
        durationSeconds: project.fps > 0 ? maxItemEndFrame / project.fps : 0,
        clipCount: itemCount,
        mediaCount: mediaDependencyIds.length,
        brokenMediaCount: brokenMediaIds.filter((mediaId) => projectMediaIds.has(mediaId)).length,
      }
    },
    [brokenMediaIds, itemCount, maxItemEndFrame, mediaDependencyIds, project.fps],
  )

  useEffect(() => {
    return () => {
      if (saveAnimationTimeoutRef.current !== undefined) {
        window.clearTimeout(saveAnimationTimeoutRef.current)
      }
    }
  }, [])

  const handleBackClick = () => {
    if (useTimelineSettingsStore.getState().isDirty) {
      setShowUnsavedDialog(true)
    } else {
      navigate({ to: '/projects' })
    }
  }

  const handleSave = async () => {
    const startedAt = performance.now()
    const finishSaveAnimation = () => {
      const remainingMs = Math.max(0, SAVE_ANIMATION_MIN_MS - (performance.now() - startedAt))

      saveAnimationTimeoutRef.current = window.setTimeout(() => {
        setIsSaveAnimating(false)
        saveAnimationTimeoutRef.current = undefined
      }, remainingMs)
    }

    if (saveAnimationTimeoutRef.current !== undefined) {
      window.clearTimeout(saveAnimationTimeoutRef.current)
    }

    setSaveAnimationKey((key) => key + 1)
    setIsSaveAnimating(true)

    if (onSave) {
      try {
        await onSave()
      } finally {
        finishSaveAnimation()
      }
    } else {
      finishSaveAnimation()
    }
  }

  // the editor's part of the studios' top bar: its modes beside the name, its buttons beside New
  const [slots, setSlots] = useState<{ modes: HTMLElement; actions: HTMLElement } | null>(null)
  useEffect(() => {
    const modes = document.getElementById('editor-modes-slot')
    const actions = document.getElementById('editor-actions-slot')
    if (modes && actions) setSlots({ modes, actions })
  }, [])

  return (
    <>
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        onSave={handleSave}
        projectName={project?.name}
      />
      <ShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} />
      {slots &&
        createPortal(
          <div className="flex items-center gap-2.5" role="toolbar" aria-label={t('toolbar.ariaLabel')}>
            <Separator orientation="vertical" className="h-5" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBackClick}
          data-tooltip={t('toolbar.backToProjects')}
          data-tooltip-side="right"
          aria-label={t('toolbar.backToProjectsAria')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

            <h1
              className="max-w-[140px] truncate text-[13px] font-medium min-[1440px]:max-w-[220px]"
              title={`${project?.name || t('common.untitledProject')}\n${t('toolbar.specsDetailed', {
                width: project?.width,
                height: project?.height,
                fps: project?.fps,
                duration: formatProjectDuration(projectSummary.durationSeconds),
                clips: projectSummary.clipCount,
                media: projectSummary.mediaCount,
                missing: projectSummary.brokenMediaCount,
              })}`}
            >
              {project?.name || t('common.untitledProject')}
            </h1>
            <WorkspaceSwitcher />
          </div>,
          slots.modes,
        )}
      {slots &&
        createPortal(
          <div className="flex items-center gap-1.5">
            <LocalInferenceStatusPill />
            {import.meta.env.DEV && import.meta.env.VITE_SHOW_DEBUG_PANEL !== 'false' && <DebugPopover projectId={projectId} />}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          onClick={() => setShowShortcutsDialog(true)}
          data-tooltip={t('toolbar.keyboardShortcuts')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.keyboardShortcutsAria')}
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleSave}
          aria-label={t('toolbar.saveAria')}
          title={t('toolbar.save')}
        >
          <div className="relative">
            {isSaveAnimating ? (
              <SaveAnimationIcon key={saveAnimationKey} className="h-5 w-5" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <SaveDirtyIndicator />
          </div>
          <span className="hidden min-[1440px]:inline">{t('toolbar.save')}</span>
        </Button>

        {onOpenRenderQueue && (
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8 text-[var(--color-muted)] hover:text-[var(--color-text)]"
            onClick={onOpenRenderQueue}
            data-tooltip={t('toolbar.renderQueue')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.renderQueueAria')}
          >
            <ListVideo className="h-4 w-4" />
            {renderQueueCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium leading-none text-primary-foreground">
                {renderQueueCount}
              </span>
            )}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="bg-brand gap-1.5 glow-primary-sm">
              <Download className="h-4 w-4" />
              {t('toolbar.export')}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} className="gap-2">
              <Video className="h-4 w-4" />
              {t('toolbar.exportVideo')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportBundle} className="gap-2">
              <FolderArchive className="h-4 w-4" />
              {t('toolbar.downloadProjectZip')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportFcpxml} className="gap-2">
              <FileCode className="h-4 w-4" />
              {t('toolbar.exportFcpxml')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
          </div>,
          slots.actions,
        )}
    </>
  )
})

function SaveAnimationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      version="1.1"
      id="L6"
      xmlns="http://www.w3.org/2000/svg"
      x="0px"
      y="0px"
      viewBox="12 12 76 76"
      enableBackground="new 12 12 76 76"
      xmlSpace="preserve"
      aria-hidden="true"
    >
      <rect fill="none" stroke="currentColor" strokeWidth="4" x="25" y="25" width="50" height="50">
        <animateTransform
          attributeName="transform"
          dur="0.5s"
          from="0 50 50"
          to="180 50 50"
          type="rotate"
          id="strokeBox"
          attributeType="XML"
          begin="rectBox.end"
        />
      </rect>
      <rect x="27" y="27" fill="currentColor" width="46" height="50">
        <animate
          attributeName="height"
          dur="1.3s"
          attributeType="XML"
          from="50"
          to="0"
          id="rectBox"
          fill="freeze"
          begin="0s;strokeBox.end"
        />
      </rect>
    </svg>
  )
}

function DebugPopover({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const debugPanelOpen = useDebugStore((s) => s.debugPanelOpen)
  const setDebugPanelOpen = useDebugStore((s) => s.setDebugPanelOpen)

  return (
    <Popover open={debugPanelOpen} onOpenChange={setDebugPanelOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-8 w-8 text-[var(--color-muted)] hover:text-[var(--color-text)]',
            debugPanelOpen && 'bg-amber-500/20 border-amber-500/50 text-amber-400',
          )}
          data-tooltip={debugPanelOpen ? undefined : t('toolbar.debugPanel')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.debugPanelAria')}
        >
          <Bug className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 p-0 bg-zinc-900 border-zinc-700 text-zinc-100"
      >
        <ProjectDebugPanel projectId={projectId} />
      </PopoverContent>
    </Popover>
  )
}
