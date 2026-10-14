/** What the agent bridge reaches of the editor: its stores, the media library and the open project. */

export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { captureSnapshot, restoreSnapshot } from '@/features/timeline/stores/commands/snapshot'
export { keepCheckpoint, restoreCheckpoint } from '@/features/timeline/services/checkpoints'
export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { mediaLibraryService } from '@/features/media-library/services/media-library-service'
export { useProjectStore } from '@/features/projects/stores/project-store'
export { saveTimeline } from '@/features/timeline/stores/timeline-persistence'
export { buildRenderJob } from '@/features/export/utils/build-render-job'
export { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
