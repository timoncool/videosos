interface RecoverDevVitePreloadOptions {
  save: () => Promise<boolean>
  reload: () => void
  onSaveFailure: () => void | Promise<void>
}

/** Save before navigating so stale-module recovery never discards editor changes. */
export async function recoverDevVitePreload({
  save,
  reload,
  onSaveFailure,
}: RecoverDevVitePreloadOptions): Promise<boolean> {
  if (!(await save())) {
    await onSaveFailure()
    return false
  }

  reload()
  return true
}
