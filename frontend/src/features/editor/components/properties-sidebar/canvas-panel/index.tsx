import { useCallback, useState, useRef, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ArrowLeftRight, RotateCcw, LayoutDashboard, Clock } from 'lucide-react'
import { useProjectStore } from '@/features/editor/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  markDirty,
  setCompositionCanvasSettings,
  setCompositionDuration,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useMarkersStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { HexColorPicker } from 'react-colorful'
import { toast } from 'sonner'
import { PropertySection, PropertyRow, LinkedDimensions, NumberInput } from '../components'
import { MarkerList } from '../marker-panel/marker-list'
import { formatTimecodeDotFrames } from '@/shared/utils/time-utils'
import { commitProjectMetadataChange } from '@/features/editor/utils/project-metadata-history'
import { CompositionControlsAuthoringSection } from './composition-controls-authoring-section'

/**
 * Isolated color picker using react-colorful.
 * Local state for instant preview, commits on mouse release.
 * Uses gizmo store for live canvas preview during drag.
 * Click outside to close.
 */
const ColorPicker = memo(function ColorPicker({
  initialColor,
  onColorChange,
}: {
  initialColor: string
  onColorChange: (color: string) => void
}) {
  const [color, setColor] = useState(initialColor)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const setCanvasBackgroundPreview = useGizmoStore((s) => s.setCanvasBackgroundPreview)
  const clearCanvasBackgroundPreview = useGizmoStore((s) => s.clearCanvasBackgroundPreview)

  // Sync local state when initialColor changes from outside (e.g., reset button)
  useEffect(() => {
    setColor(initialColor)
  }, [initialColor])

  const handleColorChange = useCallback(
    (newColor: string) => {
      setColor(newColor)
      // Live preview on canvas
      setCanvasBackgroundPreview(newColor)
    },
    [setCanvasBackgroundPreview],
  )

  const handleCommit = useCallback(() => {
    // Clear preview and commit to store
    clearCanvasBackgroundPreview()
    onColorChange(color)
  }, [color, onColorChange, clearCanvasBackgroundPreview])

  const handleClose = useCallback(() => {
    handleCommit()
    setIsOpen(false)
  }, [handleCommit])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, handleClose])

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full"
      >
        <div
          className="w-6 h-6 rounded border border-border flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-mono text-muted-foreground uppercase">{color}</span>
      </button>

      {isOpen && (
        <div className="absolute top-8 left-0 z-50 p-2 bg-popover border border-border rounded-lg shadow-lg">
          <HexColorPicker color={color} onChange={handleColorChange} />
        </div>
      )}
    </div>
  )
})

/**
 * No-selection canvas inspector. In a layer composition it authors that
 * composition's independent canvas; at the root it authors project metadata.
 */
export const CanvasPanel = memo(function CanvasPanel() {
  const { t } = useTranslation()
  // Granular selectors
  const currentProject = useProjectStore((s) => s.currentProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const fps = useTimelineSettingsStore((s) => s.fps)
  // Inside a composition (Motion, or a drilled compound clip) the duration on
  // show is the comp's authored canvas length, and it is editable here.
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId)
  const activeComposition = useCompositionsStore((s) =>
    activeCompositionId ? s.compositionById[activeCompositionId] : undefined,
  )
  const isLayerComposition = activeComposition?.editorKind === 'composite-2d'
  const markerCount = useMarkersStore((s) => s.markers.length)

  // Derived selector: only returns the computed duration, not the full items array
  // This prevents re-renders when items change but duration stays the same
  const timelineDuration = useItemsStore((s) =>
    s.items.length === 0
      ? 0
      : Math.max(...s.items.map((item) => item.from + item.durationInFrames)),
  )

  // All handlers must be defined before any early returns (Rules of Hooks)
  const projectWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const projectHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
  const projectBackgroundColor = currentProject?.metadata.backgroundColor ?? '#000000'
  const width = isLayerComposition ? activeComposition.width : projectWidth
  const height = isLayerComposition ? activeComposition.height : projectHeight
  const storedBackgroundColor = isLayerComposition
    ? (activeComposition.backgroundColor ?? '#000000')
    : projectBackgroundColor

  const applyProjectMetadataChange = useCallback(
    async (
      updates: Parameters<typeof commitProjectMetadataChange>[0]['updates'],
      command: Parameters<typeof commitProjectMetadataChange>[0]['command'],
    ) => {
      if (!currentProject) {
        return
      }

      try {
        await commitProjectMetadataChange({
          project: currentProject,
          updates,
          command,
          updateProject,
          markDirty,
        })
      } catch (error) {
        toast.error(t('editor.canvasPanel.updateFailed'), {
          description: error instanceof Error ? error.message : t('editor.canvasPanel.tryAgain'),
        })
      }
    },
    [currentProject, updateProject, t],
  )

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const normalizedWidth = Math.round(newWidth / 2) * 2
      if (isLayerComposition && activeCompositionId) {
        setCompositionCanvasSettings(activeCompositionId, { width: normalizedWidth })
        return
      }
      void applyProjectMetadataChange(
        { width: normalizedWidth },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width'] } },
      )
    },
    [activeCompositionId, applyProjectMetadataChange, isLayerComposition],
  )

  const handleHeightChange = useCallback(
    (newHeight: number) => {
      const normalizedHeight = Math.round(newHeight / 2) * 2
      if (isLayerComposition && activeCompositionId) {
        setCompositionCanvasSettings(activeCompositionId, { height: normalizedHeight })
        return
      }
      void applyProjectMetadataChange(
        { height: normalizedHeight },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['height'] } },
      )
    },
    [activeCompositionId, applyProjectMetadataChange, isLayerComposition],
  )

  const handleSwapDimensions = useCallback(() => {
    if (isLayerComposition && activeCompositionId) {
      setCompositionCanvasSettings(activeCompositionId, { width: height, height: width })
      return
    }
    void applyProjectMetadataChange(
      { width: height, height: width },
      {
        type: 'UPDATE_PROJECT_METADATA',
        payload: { fields: ['width', 'height'], operation: 'swap' },
      },
    )
  }, [activeCompositionId, applyProjectMetadataChange, height, isLayerComposition, width])

  const handleResetDimensions = useCallback(() => {
    if (isLayerComposition && activeCompositionId) {
      setCompositionCanvasSettings(activeCompositionId, {
        width: projectWidth,
        height: projectHeight,
      })
      return
    }
    void applyProjectMetadataChange(
      { width: 1920, height: 1080 },
      {
        type: 'UPDATE_PROJECT_METADATA',
        payload: { fields: ['width', 'height'], operation: 'reset' },
      },
    )
  }, [
    activeCompositionId,
    applyProjectMetadataChange,
    isLayerComposition,
    projectHeight,
    projectWidth,
  ])

  // Commit background color to store on release
  const handleBackgroundColorChange = useCallback(
    (color: string) => {
      if (isLayerComposition && activeCompositionId) {
        setCompositionCanvasSettings(activeCompositionId, { backgroundColor: color })
        return
      }
      void applyProjectMetadataChange(
        { backgroundColor: color },
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['backgroundColor'] } },
      )
    },
    [activeCompositionId, applyProjectMetadataChange, isLayerComposition],
  )

  // The duration field accepts either unit; the stored value is always frames.
  const [durationUnit, setDurationUnit] = useState<'frames' | 'seconds'>('frames')
  const toggleDurationUnit = useCallback(() => {
    setDurationUnit((current) => (current === 'frames' ? 'seconds' : 'frames'))
  }, [])

  const compositionFps = activeComposition?.fps ?? fps
  const handleCompositionDurationChange = useCallback(
    (value: number) => {
      if (!activeCompositionId) return
      setCompositionDuration(
        activeCompositionId,
        durationUnit === 'seconds' ? value * compositionFps : value,
      )
    },
    [activeCompositionId, compositionFps, durationUnit],
  )

  // Reset background color to black
  const handleResetBackgroundColor = useCallback(() => {
    const resetColor = isLayerComposition ? projectBackgroundColor : '#000000'
    if (storedBackgroundColor === resetColor) return
    if (isLayerComposition && activeCompositionId) {
      setCompositionCanvasSettings(activeCompositionId, { backgroundColor: resetColor })
      return
    }
    void applyProjectMetadataChange(
      { backgroundColor: '#000000' },
      {
        type: 'UPDATE_PROJECT_METADATA',
        payload: { fields: ['backgroundColor'], operation: 'reset' },
      },
    )
  }, [
    activeCompositionId,
    applyProjectMetadataChange,
    isLayerComposition,
    projectBackgroundColor,
    storedBackgroundColor,
  ])

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-xs text-muted-foreground">{t('editor.canvasPanel.noProjectLoaded')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Project canvas in Edit; authored composition canvas in Motion. */}
      <PropertySection
        title={
          isLayerComposition
            ? t('editor.canvasPanel.composition', { defaultValue: 'Composition' })
            : t('editor.canvasPanel.canvas')
        }
        icon={LayoutDashboard}
        defaultOpen={true}
      >
        <LinkedDimensions
          width={width}
          height={height}
          aspectLocked={false}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
          onAspectLockToggle={() => {}}
          minWidth={320}
          minHeight={240}
          maxWidth={7680}
          maxHeight={4320}
          step={2}
        />

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={handleSwapDimensions}
          >
            <ArrowLeftRight className="w-3 h-3 mr-1.5" />
            {t('editor.canvasPanel.swap')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={handleResetDimensions}
          >
            <RotateCcw className="w-3 h-3 mr-1.5" />
            {isLayerComposition
              ? t('editor.canvasPanel.matchProject', { defaultValue: 'Match Project' })
              : t('common.reset')}
          </Button>
        </div>

        {/* Background Color */}
        <PropertyRow label={t('editor.canvasPanel.background')}>
          <div className="flex items-center gap-1 w-full">
            <ColorPicker
              initialColor={storedBackgroundColor}
              onColorChange={handleBackgroundColorChange}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetBackgroundColor}
              title={
                isLayerComposition
                  ? t('editor.canvasPanel.matchProjectBackground', {
                      defaultValue: 'Match project background',
                    })
                  : t('editor.canvasPanel.resetToBlack')
              }
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>

      <CompositionControlsAuthoringSection defaultOpen={false} />

      <Separator />

      {/* Duration Section — authored (editable) inside a composition, derived
          from the content on the project timeline. */}
      <PropertySection title={t('editor.canvasPanel.duration')} icon={Clock} defaultOpen={true}>
        {activeComposition ? (
          <>
            <PropertyRow label={t('editor.canvasPanel.compositionDuration')}>
              {/* Only a layer composition has an authored canvas length. A drilled
                  compound clip's duration is derived from its content and gets
                  recomputed when you leave it, so editing it here would not hold. */}
              {activeComposition.editorKind !== 'composite-2d' ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {activeComposition.durationInFrames} fr
                </span>
              ) : (
                <NumberInput
                  // Free to set shorter than the layers: whatever hangs past the end
                  // of the comp is simply not rendered.
                  {...(durationUnit === 'seconds'
                    ? {
                        value: activeComposition.durationInFrames / activeComposition.fps,
                        min: 1 / activeComposition.fps,
                        step: 0.1,
                        unit: 's',
                      }
                    : {
                        value: activeComposition.durationInFrames,
                        min: 1,
                        step: 1,
                        unit: 'fr',
                      })}
                  onChange={handleCompositionDurationChange}
                  onUnitClick={toggleDurationUnit}
                  unitTitle={t(
                    durationUnit === 'seconds'
                      ? 'editor.canvasPanel.switchToFrames'
                      : 'editor.canvasPanel.switchToSeconds',
                  )}
                />
              )}
            </PropertyRow>

            <PropertyRow label={t('editor.canvasPanel.timecode')}>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatTimecodeDotFrames(activeComposition.durationInFrames, activeComposition.fps)}
              </span>
            </PropertyRow>

            <PropertyRow label={t('editor.canvasPanel.frameRate')}>
              <span className="text-xs text-muted-foreground tabular-nums">
                {activeComposition.fps} fps
              </span>
            </PropertyRow>
          </>
        ) : (
          <>
            <PropertyRow label={t('editor.canvasPanel.duration')}>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatTimecodeDotFrames(timelineDuration, fps)}
              </span>
            </PropertyRow>

            <PropertyRow label={t('editor.canvasPanel.frameRate')}>
              <span className="text-xs text-muted-foreground tabular-nums">
                {currentProject.metadata.fps} fps
              </span>
            </PropertyRow>

            <PropertyRow label={t('editor.canvasPanel.totalFrames')}>
              <span className="text-xs text-muted-foreground tabular-nums">
                {timelineDuration} fr
              </span>
            </PropertyRow>
          </>
        )}
      </PropertySection>

      {(!isLayerComposition || markerCount > 0) && (
        <>
          <Separator />
          <MarkerList defaultOpen={!isLayerComposition} />
        </>
      )}
    </div>
  )
})
