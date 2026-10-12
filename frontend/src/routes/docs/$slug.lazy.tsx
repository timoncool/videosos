import { createLazyFileRoute, Link } from '@tanstack/react-router'
import { DocsArticle, DocsShell } from '@/features/docs/docs-shell'
import { getDocPage } from '@/features/docs/docs-content'
import { Button } from '@/components/ui/button'

export const Route = createLazyFileRoute('/docs/$slug')({
  component: DocsSlugPage,
})

function DocsSlugPage() {
  const { slug } = Route.useParams()
  const page = getDocPage(slug)

  if (!page) {
    return (
      <DocsShell>
        <div className="rounded-lg border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold">Docs page not found</h1>
          <p className="mt-3 text-muted-foreground">
            This docs URL does not match a published FreeCut guide.
          </p>
          <Button asChild className="mt-6">
            <Link to="/docs">Back to docs</Link>
          </Button>
        </div>
      </DocsShell>
    )
  }

  return (
    <DocsShell currentSlug={page.slug}>
      <DocsArticle page={page} />
    </DocsShell>
  )
}
