import { createFileRoute } from '@tanstack/react-router'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { clearPendingMediaRequests } from '@/features/media-library/utils/media-resolver-requests'

export const Route = createFileRoute('/projects/')({
  // Route stays eager (beforeLoad cannot live in a lazy file), but everything
  // heavy — the projects UI, form stack and media-library graph — lives in
  // projects/index.lazy.tsx so the landing page doesn't download it.
  beforeLoad: async () => {
    // Clean up any media blob URLs when returning to projects page
    blobUrlManager.releaseAll()
    clearPendingMediaRequests()
    // Always reload projects from storage to get fresh data (thumbnails may have changed)
    const { useProjectStore } = await import('@/features/projects/stores/project-store')
    await useProjectStore.getState().loadProjects()
  },
})
