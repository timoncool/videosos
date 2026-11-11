import { useEffect } from 'react'
import { useSpeechRequestStore } from '@/shared/state/speech-request-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useProjectStore } from '../deps/editor'
import { useGenerateStore } from '../stores/generate-store'

/**
 * A text clip the timeline asks to voice: the playhead goes to the clip, where "Put on the timeline" lands the
 * speech, and "Speech" opens with the clip's text in the prompt.
 */
export function useSpeechRequests(): void {
  const request = useSpeechRequestStore((state) => state.request)
  useEffect(() => {
    if (!request) return
    useSpeechRequestStore.getState().clear()
    const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
    usePlaybackStore.getState().setCurrentFrame(Math.round(request.at * fps))
    useEditorStore.getState().setLeftSidebarOpen(true)
    useEditorStore.getState().setActiveTab('generate')
    useGenerateStore.getState().writeAs({ task: 'speech', text: request.text })
  }, [request])
}
