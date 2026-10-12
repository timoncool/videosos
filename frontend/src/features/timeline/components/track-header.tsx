import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Power, PowerOff, Lock, GripVertical, Radio, FoldHorizontal, Link2 } from 'lucide-react'
import type { TimelineTrack } from '@/types/timeline'
import { useTrackDrag } from '../hooks/use-track-drag'
import { TIMELINE_SIDEBAR_WIDTH } from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useItemsStore } from '../stores/items-store'
import { isTrackDisabled } from '@/features/timeline/utils/classic-tracks'
import { isTrackSyncLockActive } from '../utils/track-sync-lock'

interface TrackHeaderProps {
  track: TimelineTrack
  isActive: boolean
  isSelected: boolean
  canDeleteTrack: boolean
  canDeleteEmptyTracks: boolean
  onToggleLock: () => void
  onToggleSyncLock: () => void
  onToggleDisabled: () => void
  onToggleSolo: () => void
  onSelect: (e: React.MouseEvent) => void
  onCloseGaps?: () => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onDeleteTrack: () => void
  onDeleteEmptyTracks: () => void
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.canDeleteTrack === next.canDeleteTrack &&
    prev.canDeleteEmptyTracks === next.canDeleteEmptyTracks
  )
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for track actions.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  canDeleteTrack,
  canDeleteEmptyTracks,
  onToggleLock,
  onToggleSyncLock,
  onToggleDisabled,
  onToggleSolo,
  onSelect,
  onCloseGaps,
  onAddVideoTrack,
  onAddAudioTrack,
  onDeleteTrack,
  onDeleteEmptyTracks,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const itemCount = useItemsStore((s) => s.itemsByTrackId[track.id]?.length ?? 0)
  const syncLockEnabled = isTrackSyncLockActive(track)
  const trackDisabled = isTrackDisabled(track)

  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track)
  const itemCountLabel = t('timeline.trackHeader.clipCount', { count: itemCount })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative overflow-hidden"
          style={{
            height: `${track.height}px`,
            contentVisibility: 'auto',
            containIntrinsicSize: `${TIMELINE_SIDEBAR_WIDTH}px ${track.height}px`,
          }}
          data-track-id={track.id}
          data-track-disabled={trackDisabled ? 'true' : undefined}
        >
          <div
            className={`
              flex flex-col overflow-hidden px-1
              cursor-grab active:cursor-grabbing relative
              ${isSelected ? 'bg-primary/10' : trackDisabled ? 'bg-muted/30 hover:bg-muted/40' : 'hover:bg-secondary/50'}
              ${isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'}
              ${trackDisabled ? 'text-muted-foreground' : ''}
              transition-colors duration-150
            `}
            style={{ height: `${track.height}px` }}
            onClick={onSelect}
            onMouseDown={handleDragStart}
          >
            <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border/60">
              <div className="flex h-5 w-4 shrink-0 items-center justify-center">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              </div>
              {/* Disable Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDisabled()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  trackDisabled
                    ? t('timeline.trackHeader.enableTrack')
                    : t('timeline.trackHeader.disableTrack')
                }
                data-tooltip={
                  trackDisabled
                    ? t('timeline.trackHeader.enableTrack')
                    : t('timeline.trackHeader.disableTrack')
                }
              >
                {trackDisabled ? (
                  <PowerOff className="w-3 h-3 text-primary" />
                ) : (
                  <Power className="w-3 h-3 opacity-70" />
                )}
              </Button>

              {/* Solo Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSolo()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  track.solo
                    ? t('timeline.trackHeader.unsoloTrack')
                    : t('timeline.trackHeader.soloTrack')
                }
                data-tooltip={
                  track.solo
                    ? t('timeline.trackHeader.unsoloTrack')
                    : t('timeline.trackHeader.soloTrack')
                }
              >
                <Radio className={`w-3 h-3 ${track.solo ? 'text-primary' : ''}`} />
              </Button>

              {/* Lock Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLock()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  track.locked
                    ? t('timeline.trackHeader.unlockTrack')
                    : t('timeline.trackHeader.lockTrack')
                }
                data-tooltip={
                  track.locked
                    ? t('timeline.trackHeader.unlockTrack')
                    : t('timeline.trackHeader.lockTrack')
                }
              >
                <Lock className={`w-3 h-3 ${track.locked ? 'text-primary' : 'opacity-70'}`} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSyncLock()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  syncLockEnabled
                    ? t('timeline.trackHeader.disableSyncLock')
                    : t('timeline.trackHeader.enableSyncLock')
                }
                data-tooltip={
                  syncLockEnabled
                    ? t('timeline.trackHeader.disableSyncLock')
                    : t('timeline.trackHeader.enableSyncLock')
                }
              >
                <Link2 className={`w-3 h-3 ${syncLockEnabled ? 'text-primary' : 'opacity-70'}`} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseGaps?.()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={t('timeline.trackHeader.closeAllGaps')}
                data-tooltip={t('timeline.trackHeader.closeAllGaps')}
              >
                <FoldHorizontal className="w-3 h-3" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 items-center gap-1.5 overflow-hidden px-1.5">
              <span className="min-w-0 truncate text-xs font-semibold leading-none font-mono">
                {track.name}
              </span>
              <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
                {itemCountLabel}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onCloseGaps}>
          {t('timeline.trackHeader.closeAllGaps')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddVideoTrack}>
          {t('timeline.trackHeader.addVideoTrack')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddAudioTrack}>
          {t('timeline.trackHeader.addAudioTrack')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canDeleteTrack} onClick={onDeleteTrack}>
          {t('timeline.trackHeader.deleteTrack')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDeleteEmptyTracks} onClick={onDeleteEmptyTracks}>
          {t('timeline.trackHeader.deleteEmptyTracks')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}, areTrackHeaderPropsEqual)
