import { createLazyFileRoute } from '@tanstack/react-router'
import { DocsHome, DocsShell } from '@/features/docs/docs-shell'

export const Route = createLazyFileRoute('/docs/')({
  component: DocsIndexPage,
})

function DocsIndexPage() {
  return (
    <DocsShell>
      <DocsHome />
    </DocsShell>
  )
}
