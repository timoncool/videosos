export function observeParentElementHeight(
  container: HTMLElement | null,
  setHeight: (height: number) => void,
): (() => void) | undefined {
  if (!container) return undefined

  const parent = container.parentElement
  if (!parent) return undefined

  let lastHeight = parent.clientHeight
  setHeight(lastHeight)

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries.find(({ target }) => target === parent)
    if (!entry) return

    const nextHeight = entry.contentRect.height
    if (!Number.isFinite(nextHeight) || Math.abs(nextHeight - lastHeight) < 0.5) return

    lastHeight = nextHeight
    setHeight(nextHeight)
  })
  resizeObserver.observe(parent)

  return () => resizeObserver.disconnect()
}
