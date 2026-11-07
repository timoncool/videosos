/** A workflow file saved where the person chooses in the program, or downloaded in a browser. */

import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { isDesktop, revealOnDisk, saveToDisk } from '@/infrastructure/desktop'

export async function saveWorkflow(text: string, name: string): Promise<void> {
  const blob = new Blob([text], { type: 'application/json' })
  const file = `${name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'workflow'}.videosos-workflow.json`
  if (await isDesktop()) {
    const saved = await saveToDisk(blob, file, { dialog: true })
    if (saved.cancelled || !saved.path) return
    const path = saved.path
    toast.success(i18n.t('desktop.saved', { path }), {
      action: { label: i18n.t('desktop.reveal'), onClick: () => void revealOnDisk(path) },
    })
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
