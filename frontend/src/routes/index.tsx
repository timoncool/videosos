import { createFileRoute, redirect } from '@tanstack/react-router'

// The program opens on its projects; there is no landing page in the desktop window.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})
