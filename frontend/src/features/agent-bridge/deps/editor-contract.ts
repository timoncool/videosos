/** What the agent bridge reaches of the editor: its stores, the media library and the open project. */

export { useItemsStore } from '@/features/timeline/stores/items-store'
export { updateItem } from '@/features/timeline/stores/actions/item-actions'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { captureSnapshot, restoreSnapshot } from '@/features/timeline/stores/commands/snapshot'
export { keepCheckpoint, restoreCheckpoint } from '@/features/timeline/services/checkpoints'
export { makeMotionClip, motionName } from '@/features/generate/services/motion-clip'
export {
  agentBlocking,
  importPrevisFrame,
  importPrevisVideo,
  withPrevisRenderer,
} from '@/features/generate/services/previs-shot'
export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { mediaLibraryService } from '@/features/media-library/services/media-library-service'
export { useProjectStore } from '@/features/projects/stores/project-store'
export { saveTimeline } from '@/features/timeline/stores/timeline-persistence'
export { buildRenderJob } from '@/features/export/utils/build-render-job'
export { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
export { useMarkersStore } from '@/features/timeline/stores/markers-store'
export {
  createProjectFormSchema,
  DEFAULT_PROJECT_VALUES,
} from '@/features/projects/utils/validation'
export { commitProjectMetadataChange } from '@/features/editor/utils/project-metadata-history'
export { markDirty } from '@/features/timeline/stores/actions/settings-actions'
export { listTrashedProjects } from '@/infrastructure/storage'
export { cutSegment } from '@/features/generate/services/clip-segment'
export { importLastFrame } from '@/features/generate/services/last-frame'
export { useGenerateStore } from '@/features/generate/stores/generate-store'
export {
  besideGraph,
  instantiate,
  readWorkflowFile,
  workflowFile,
  WORKFLOW_TEMPLATES,
  type ModelsFor,
} from '@/features/generate/services/canvas-templates'
export { fcpxmlFile } from '@/features/export/services/fcpxml-export'
export { runMediaTranscriptionJob } from '@/features/media-library/services/media-transcription-runner'
export { mediaTranscriptionService } from '@/features/media-library/services/media-transcription-service'
export { useSettingsStore } from '@/features/settings/stores/settings-store'
export { openSettings, SETTINGS_SECTIONS } from '@/features/studio/services/settings-nav'
export {
  cancelMicRecording,
  refreshMicDevices,
  stopMicRecording,
} from '@/features/timeline/services/mic-recording-controller'
export { insertFreezeFrame } from '@/features/timeline/stores/actions/item-actions'
