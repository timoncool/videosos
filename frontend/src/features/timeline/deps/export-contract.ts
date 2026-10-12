/**
 * Adapter exports for export dependencies.
 * Timeline modules should import export rendering utilities from here.
 */

export { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
export type { ClientExportSettings, RenderProgress } from '@/runtime/renderer/client-renderer'

export const importCanvasRenderOrchestrator = () =>
  import('@/runtime/renderer/canvas-render-orchestrator')
