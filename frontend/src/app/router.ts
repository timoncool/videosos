import { createRouter } from '@tanstack/react-router'
import { RouteErrorScreen } from '@/app/route-error'
import { routeTree } from '../routeTree.gen'

// Route errors (thrown from beforeLoad/loader) never reach the React
// ErrorBoundary below — TanStack catches them first. Without this, they render
// its untranslated built-in fallback with the message hidden in production.
export const router = createRouter({ routeTree, defaultErrorComponent: RouteErrorScreen })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
