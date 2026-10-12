import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  extractValidMediaFileEntriesFromDataTransfer,
  formatMediaDropRejectionMessage,
} from '../utils/file-drop'
import type { MediaLibraryNotification } from '../types'

interface UseMediaLibraryDragDropParams {
  showNotification: (notification: MediaLibraryNotification) => void
  importHandles: (handles: FileSystemFileHandle[]) => Promise<void>
}

/**
 * Panel-level drag/drop handling for importing media files. Uses an enter/leave
 * counter so the drop overlay doesn't flicker when dragging over child elements,
 * ignores in-app media/composition drags, and routes valid file handles to the
 * import path. Extracted verbatim from `MediaLibrary`.
 */
export function useMediaLibraryDragDrop({
  showNotification,
  importHandles,
}: UseMediaLibraryDragDropParams) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1 && !e.dataTransfer.types.includes('application/json')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)

      // Ignore media items being dragged from the grid itself
      try {
        const jsonData = e.dataTransfer.getData('application/json')
        if (jsonData) {
          const data = JSON.parse(jsonData)
          if (
            data.type === 'media-item' ||
            data.type === 'media-items' ||
            data.type === 'composition'
          ) {
            return
          }
        }
      } catch {
        // Not JSON data, continue with file handling
      }

      const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(
        e.dataTransfer,
      )
      if (!supported) {
        showNotification({
          type: 'warning',
          message: t('media.library.dragDropUnsupported'),
        })
        return
      }

      if (errors.length > 0) {
        showNotification({
          type: 'error',
          message: formatMediaDropRejectionMessage(errors),
        })
      }
      if (entries.length > 0) {
        await importHandles(entries.map((entry) => entry.handle))
      }
    },
    [showNotification, importHandles, t],
  )

  return { isDragging, handleDragEnter, handleDragOver, handleDragLeave, handleDrop }
}
