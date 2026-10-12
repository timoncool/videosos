import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import {
  clearMixerLiveGain,
  getMixerLiveGain,
  setMixerLiveGains,
} from '@/shared/state/mixer-live-gain'
import {
  getAudioFadeRatio,
  getAudioFadeSecondsFromOffset,
  type AudioFadeHandle,
} from '../../utils/audio-fade'
import { getAudioFadeCurveFromOffset } from '../../utils/audio-fade-curve'
import {
  getAudioVisualizationScale,
  getAudioVolumeDbFromDragDelta,
  getAudioVolumeLineY,
} from '../../utils/audio-volume'
import { supportsVisualFadeControls } from './visual-fade-items'

const VIDEO_FADE_EPSILON = 0.0001
const AUDIO_FADE_EPSILON = 0.0001
const AUDIO_VOLUME_EPSILON = 0.05
const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100
const AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS = 120
const AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX = 4

export interface VideoFadeEditState {
  handle: AudioFadeHandle
  previewFadeIn: number
  previewFadeOut: number
  originalFadeIn: number
  originalFadeOut: number
  isCommitting: boolean
}

export interface AudioFadeEditState {
  handle: AudioFadeHandle
  previewFadeIn: number
  previewFadeOut: number
  originalFadeIn: number
  originalFadeOut: number
  isCommitting: boolean
}

export interface AudioFadeCurveEditState {
  handle: AudioFadeHandle
  previewFadeInCurve: number
  previewFadeOutCurve: number
  previewFadeInCurveX: number
  previewFadeOutCurveX: number
  originalFadeInCurve: number
  originalFadeOutCurve: number
  originalFadeInCurveX: number
  originalFadeOutCurveX: number
  isCommitting: boolean
}

export interface AudioVolumeEditState {
  originalVolume: number
  isCommitting: boolean
}

interface UseFadeEditorsParams {
  item: TimelineItemType
  fps: number
  activeTool: string
  trackLocked: boolean
  isAnyDragActiveRef: MutableRefObject<boolean>
  transformRef: RefObject<HTMLDivElement | null>
  updateTimelineItem: (id: string, patch: Partial<TimelineItemType>) => void
}

export interface FadeEditorsHandle {
  videoControlsRef: RefObject<HTMLDivElement | null>
  audioControlsRef: RefObject<HTMLDivElement | null>
  volumeLineRef: RefObject<HTMLDivElement | null>
  audioVolumeEditLabelRef: RefObject<HTMLElement | null>

  isVisualFadeItem: boolean
  videoFadeEdit: VideoFadeEditState | null
  audioFadeEdit: AudioFadeEditState | null
  audioFadeCurveEdit: AudioFadeCurveEditState | null
  audioVolumeEdit: AudioVolumeEditState | null

  displayedVideoFadeIn: number
  displayedVideoFadeOut: number
  displayedAudioFadeIn: number
  displayedAudioFadeOut: number
  displayedAudioFadeInCurve: number
  displayedAudioFadeOutCurve: number
  displayedAudioFadeInCurveX: number
  displayedAudioFadeOutCurveX: number
  displayedAudioVolumeDb: number

  audioVolumePreviewRef: MutableRefObject<number>

  handleVideoFadeHandleMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  handleVideoFadeHandleDoubleClick: (handle: AudioFadeHandle) => void
  handleAudioFadeHandleMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  handleAudioFadeHandleDoubleClick: (handle: AudioFadeHandle) => void
  handleAudioFadeCurveDotMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  handleAudioFadeCurveDotDoubleClick: (handle: AudioFadeHandle) => void
  handleAudioVolumeMouseDown: (e: React.MouseEvent) => void
  handleAudioVolumeDoubleClick: () => void
}

export function useFadeEditors({
  item,
  fps,
  activeTool,
  trackLocked,
  isAnyDragActiveRef,
  transformRef,
  updateTimelineItem,
}: UseFadeEditorsParams): FadeEditorsHandle {
  const isVisualFadeItem = supportsVisualFadeControls(item)

  const [videoFadeEdit, setVideoFadeEdit] = useState<VideoFadeEditState | null>(null)
  const videoFadeEditRef = useRef(videoFadeEdit)
  videoFadeEditRef.current = videoFadeEdit
  const videoFadeCleanupRef = useRef<(() => void) | null>(null)

  const [audioFadeEdit, setAudioFadeEdit] = useState<AudioFadeEditState | null>(null)
  const audioFadeEditRef = useRef(audioFadeEdit)
  audioFadeEditRef.current = audioFadeEdit
  const audioFadeCleanupRef = useRef<(() => void) | null>(null)

  const [audioFadeCurveEdit, setAudioFadeCurveEdit] = useState<AudioFadeCurveEditState | null>(null)
  const audioFadeCurveEditRef = useRef(audioFadeCurveEdit)
  audioFadeCurveEditRef.current = audioFadeCurveEdit
  const audioFadeCurveCleanupRef = useRef<(() => void) | null>(null)

  const [audioVolumeEdit, setAudioVolumeEdit] = useState<AudioVolumeEditState | null>(null)
  const audioVolumeCleanupRef = useRef<(() => void) | null>(null)
  const audioVolumePreviewRef = useRef(item.type === 'audio' ? (item.volume ?? 0) : 0)
  const audioVolumeEditLabelRef = useRef<HTMLElement | null>(null)

  const videoControlsRef = useRef<HTMLDivElement | null>(null)
  const audioControlsRef = useRef<HTMLDivElement | null>(null)
  const volumeLineRef = useRef<HTMLDivElement | null>(null)

  useEffect(
    () => () => {
      videoFadeCleanupRef.current?.()
      audioFadeCleanupRef.current?.()
      audioFadeCurveCleanupRef.current?.()
      audioVolumeCleanupRef.current?.()
    },
    [],
  )

  const displayedVideoFadeIn = isVisualFadeItem
    ? (videoFadeEdit?.previewFadeIn ?? item.fadeIn ?? 0)
    : 0
  const displayedVideoFadeOut = isVisualFadeItem
    ? (videoFadeEdit?.previewFadeOut ?? item.fadeOut ?? 0)
    : 0
  const displayedAudioFadeIn =
    item.type === 'audio' ? (audioFadeEdit?.previewFadeIn ?? item.audioFadeIn ?? 0) : 0
  const displayedAudioFadeOut =
    item.type === 'audio' ? (audioFadeEdit?.previewFadeOut ?? item.audioFadeOut ?? 0) : 0
  const displayedAudioFadeInCurve =
    item.type === 'audio'
      ? (audioFadeCurveEdit?.previewFadeInCurve ?? item.audioFadeInCurve ?? 0)
      : 0
  const displayedAudioFadeOutCurve =
    item.type === 'audio'
      ? (audioFadeCurveEdit?.previewFadeOutCurve ?? item.audioFadeOutCurve ?? 0)
      : 0
  const displayedAudioFadeInCurveX =
    item.type === 'audio'
      ? (audioFadeCurveEdit?.previewFadeInCurveX ?? item.audioFadeInCurveX ?? 0.52)
      : 0.52
  const displayedAudioFadeOutCurveX =
    item.type === 'audio'
      ? (audioFadeCurveEdit?.previewFadeOutCurveX ?? item.audioFadeOutCurveX ?? 0.52)
      : 0.52
  const displayedAudioVolumeDb = item.type === 'audio' ? (item.volume ?? 0) : 0

  const audioVolumeLineY = useMemo(
    () =>
      item.type === 'audio'
        ? getAudioVolumeLineY(displayedAudioVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT)
        : AUDIO_ENVELOPE_VIEWBOX_HEIGHT / 2,
    [displayedAudioVolumeDb, item.type],
  )

  const snapVolumeLineTop = useCallback((ratio: number) => {
    const line = volumeLineRef.current
    const container = audioControlsRef.current
    if (!line || !container) return
    const rect = container.getBoundingClientRect()
    if (rect.height <= 0) return
    const docY = rect.top + rect.height * ratio
    line.style.top = `${Math.round(docY) - rect.top}px`
  }, [])

  const applyAudioVolumeVisualPreview = useCallback(
    (previewVolumeDb: number) => {
      audioVolumePreviewRef.current = previewVolumeDb

      if (transformRef.current) {
        transformRef.current.style.setProperty(
          '--timeline-audio-volume-line-y',
          `${(getAudioVolumeLineY(previewVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100}%`,
        )
        transformRef.current.style.setProperty(
          '--timeline-audio-waveform-scale',
          String(getAudioVisualizationScale(previewVolumeDb)),
        )
      }

      snapVolumeLineTop(
        getAudioVolumeLineY(previewVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) /
          AUDIO_ENVELOPE_VIEWBOX_HEIGHT,
      )

      if (audioVolumeEditLabelRef.current) {
        audioVolumeEditLabelRef.current.textContent = `Volume ${previewVolumeDb >= 0 ? '+' : ''}${previewVolumeDb.toFixed(1)} dB`
      }
    },
    [snapVolumeLineTop, transformRef],
  )

  const itemType = item.type
  const itemVolume = item.volume
  useEffect(() => {
    if (itemType !== 'audio' || audioVolumeEdit !== null) {
      return
    }
    applyAudioVolumeVisualPreview(itemVolume ?? 0)
  }, [applyAudioVolumeVisualPreview, audioVolumeEdit, itemType, itemVolume])

  // Runs post-paint (not useLayoutEffect): the line is already correctly placed
  // by its `top: var(--timeline-audio-volume-line-y)` CSS, so this only refines
  // it to a crisp whole pixel. Keeping the getBoundingClientRect read out of the
  // commit phase avoids a forced reflow per audio clip when many mount at once
  // (e.g. zooming out brings a batch into view).
  useEffect(() => {
    if (itemType !== 'audio') return
    const container = audioControlsRef.current
    if (!container) return
    const ratio = audioVolumeLineY / AUDIO_ENVELOPE_VIEWBOX_HEIGHT
    snapVolumeLineTop(ratio)
    const ro = new ResizeObserver(() => snapVolumeLineTop(ratio))
    ro.observe(container)
    return () => ro.disconnect()
  }, [itemType, audioVolumeLineY, snapVolumeLineTop])

  const finalizeAudioVolumeChange = useCallback(
    (
      nextVolume: number,
      options?: {
        preserveLiveGainOnCommit?: boolean
        commitFromActiveEdit?: boolean
      },
    ) => {
      if (item.type !== 'audio') {
        return
      }

      const currentVolume = item.volume ?? 0
      const didChange = Math.abs(currentVolume - nextVolume) > AUDIO_VOLUME_EPSILON

      applyAudioVolumeVisualPreview(nextVolume)

      if (!didChange || !options?.preserveLiveGainOnCommit) {
        clearMixerLiveGain(item.id)
      }

      if (!didChange) {
        setAudioVolumeEdit(null)
        return
      }

      if (options?.commitFromActiveEdit) {
        setAudioVolumeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
      } else {
        setAudioVolumeEdit(null)
      }

      updateTimelineItem(item.id, { volume: nextVolume })
    },
    [applyAudioVolumeVisualPreview, item, updateTimelineItem],
  )

  // Auto-clear isCommitting once the persisted value matches the preview.
  useEffect(() => {
    if (!videoFadeEdit?.isCommitting || !isVisualFadeItem) {
      return
    }
    const committedFade = videoFadeEdit.handle === 'in' ? (item.fadeIn ?? 0) : (item.fadeOut ?? 0)
    const previewFade =
      videoFadeEdit.handle === 'in' ? videoFadeEdit.previewFadeIn : videoFadeEdit.previewFadeOut
    if (Math.abs(committedFade - previewFade) <= VIDEO_FADE_EPSILON) {
      setVideoFadeEdit(null)
    }
  }, [isVisualFadeItem, item, videoFadeEdit])

  useEffect(() => {
    if (!audioFadeEdit?.isCommitting || item.type !== 'audio') {
      return
    }
    const committedFade =
      audioFadeEdit.handle === 'in' ? (item.audioFadeIn ?? 0) : (item.audioFadeOut ?? 0)
    const previewFade =
      audioFadeEdit.handle === 'in' ? audioFadeEdit.previewFadeIn : audioFadeEdit.previewFadeOut
    if (Math.abs(committedFade - previewFade) <= AUDIO_FADE_EPSILON) {
      setAudioFadeEdit(null)
    }
  }, [audioFadeEdit, item])

  useEffect(() => {
    if (!audioVolumeEdit?.isCommitting || item.type !== 'audio') {
      return
    }
    if (Math.abs((item.volume ?? 0) - audioVolumePreviewRef.current) <= AUDIO_VOLUME_EPSILON) {
      setAudioVolumeEdit(null)
    }
  }, [audioVolumeEdit, item])

  useEffect(() => {
    if (!audioFadeCurveEdit?.isCommitting || item.type !== 'audio') {
      return
    }
    const committedCurve =
      audioFadeCurveEdit.handle === 'in'
        ? (item.audioFadeInCurve ?? 0)
        : (item.audioFadeOutCurve ?? 0)
    const previewCurve =
      audioFadeCurveEdit.handle === 'in'
        ? audioFadeCurveEdit.previewFadeInCurve
        : audioFadeCurveEdit.previewFadeOutCurve
    const committedCurveX =
      audioFadeCurveEdit.handle === 'in'
        ? (item.audioFadeInCurveX ?? 0.52)
        : (item.audioFadeOutCurveX ?? 0.52)
    const previewCurveX =
      audioFadeCurveEdit.handle === 'in'
        ? audioFadeCurveEdit.previewFadeInCurveX
        : audioFadeCurveEdit.previewFadeOutCurveX
    if (
      Math.abs(committedCurve - previewCurve) <= AUDIO_FADE_EPSILON &&
      Math.abs(committedCurveX - previewCurveX) <= AUDIO_FADE_EPSILON
    ) {
      setAudioFadeCurveEdit(null)
    }
  }, [audioFadeCurveEdit, item])

  const handleVideoFadeHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: AudioFadeHandle) => {
      if (e.button !== 0) return
      if (
        !isVisualFadeItem ||
        trackLocked ||
        activeTool !== 'select' ||
        isAnyDragActiveRef.current
      ) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const originalFadeIn = displayedVideoFadeIn
      const originalFadeOut = displayedVideoFadeOut
      const persistedFadeIn = item.fadeIn ?? 0
      const persistedFadeOut = item.fadeOut ?? 0
      const computeFadeSeconds = (clientX: number) => {
        const rect =
          videoControlsRef.current?.getBoundingClientRect() ??
          transformRef.current?.getBoundingClientRect()
        if (!rect) {
          return handle === 'in' ? originalFadeIn : originalFadeOut
        }
        return getAudioFadeSecondsFromOffset({
          handle,
          clipWidthPixels: rect.width,
          pointerOffsetPixels: clientX - rect.left,
          fps,
          maxDurationFrames: item.durationInFrames,
        })
      }

      const applyPreview = (nextFadeSeconds: number) => {
        setVideoFadeEdit({
          handle,
          previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
          previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
          originalFadeIn,
          originalFadeOut,
          isCommitting: false,
        })
      }

      const finishEdit = () => {
        const latestState = videoFadeEditRef.current
        const committedFade =
          handle === 'in'
            ? (latestState?.previewFadeIn ?? originalFadeIn)
            : (latestState?.previewFadeOut ?? originalFadeOut)
        videoFadeCleanupRef.current?.()
        videoFadeCleanupRef.current = null

        if (handle === 'in') {
          if (Math.abs(committedFade - persistedFadeIn) > VIDEO_FADE_EPSILON) {
            setVideoFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, { fadeIn: committedFade })
          } else {
            setVideoFadeEdit(null)
          }
        } else if (Math.abs(committedFade - persistedFadeOut) > VIDEO_FADE_EPSILON) {
          setVideoFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
          updateTimelineItem(item.id, { fadeOut: committedFade })
        } else {
          setVideoFadeEdit(null)
        }
      }

      applyPreview(computeFadeSeconds(e.clientX))

      const handleWindowMouseMove = (event: MouseEvent) => {
        applyPreview(computeFadeSeconds(event.clientX))
      }
      const handleWindowMouseUp = () => {
        finishEdit()
      }

      window.addEventListener('mousemove', handleWindowMouseMove)
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
      videoFadeCleanupRef.current = () => {
        window.removeEventListener('mousemove', handleWindowMouseMove)
        window.removeEventListener('mouseup', handleWindowMouseUp)
      }
    },
    [
      activeTool,
      displayedVideoFadeIn,
      displayedVideoFadeOut,
      fps,
      isAnyDragActiveRef,
      isVisualFadeItem,
      item,
      trackLocked,
      transformRef,
      updateTimelineItem,
    ],
  )

  const handleAudioFadeHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: AudioFadeHandle) => {
      if (
        item.type !== 'audio' ||
        trackLocked ||
        activeTool !== 'select' ||
        isAnyDragActiveRef.current
      ) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const originalFadeIn = displayedAudioFadeIn
      const originalFadeOut = displayedAudioFadeOut
      const persistedFadeIn = item.audioFadeIn ?? 0
      const persistedFadeOut = item.audioFadeOut ?? 0
      const computeFadeSeconds = (clientX: number) => {
        const rect =
          audioControlsRef.current?.getBoundingClientRect() ??
          transformRef.current?.getBoundingClientRect()
        if (!rect) {
          return handle === 'in' ? originalFadeIn : originalFadeOut
        }
        return getAudioFadeSecondsFromOffset({
          handle,
          clipWidthPixels: rect.width,
          pointerOffsetPixels: clientX - rect.left,
          fps,
          maxDurationFrames: item.durationInFrames,
        })
      }

      const applyPreview = (nextFadeSeconds: number) => {
        setAudioFadeEdit({
          handle,
          previewFadeIn: handle === 'in' ? nextFadeSeconds : originalFadeIn,
          previewFadeOut: handle === 'out' ? nextFadeSeconds : originalFadeOut,
          originalFadeIn,
          originalFadeOut,
          isCommitting: false,
        })
      }

      const finishEdit = () => {
        const latestState = audioFadeEditRef.current
        const committedFade =
          handle === 'in'
            ? (latestState?.previewFadeIn ?? originalFadeIn)
            : (latestState?.previewFadeOut ?? originalFadeOut)
        audioFadeCleanupRef.current?.()
        audioFadeCleanupRef.current = null

        if (handle === 'in') {
          if (Math.abs(committedFade - persistedFadeIn) > AUDIO_FADE_EPSILON) {
            setAudioFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, { audioFadeIn: committedFade })
          } else {
            setAudioFadeEdit(null)
          }
        } else if (Math.abs(committedFade - persistedFadeOut) > AUDIO_FADE_EPSILON) {
          setAudioFadeEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
          updateTimelineItem(item.id, { audioFadeOut: committedFade })
        } else {
          setAudioFadeEdit(null)
        }
      }

      applyPreview(computeFadeSeconds(e.clientX))

      const handleWindowMouseMove = (event: MouseEvent) => {
        applyPreview(computeFadeSeconds(event.clientX))
      }
      const handleWindowMouseUp = () => {
        finishEdit()
      }

      window.addEventListener('mousemove', handleWindowMouseMove)
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
      audioFadeCleanupRef.current = () => {
        window.removeEventListener('mousemove', handleWindowMouseMove)
        window.removeEventListener('mouseup', handleWindowMouseUp)
      }
    },
    [
      activeTool,
      displayedAudioFadeIn,
      displayedAudioFadeOut,
      fps,
      isAnyDragActiveRef,
      item,
      trackLocked,
      transformRef,
      updateTimelineItem,
    ],
  )

  const handleAudioFadeCurveDotMouseDown = useCallback(
    (e: React.MouseEvent, handle: AudioFadeHandle) => {
      if (
        item.type !== 'audio' ||
        trackLocked ||
        activeTool !== 'select' ||
        isAnyDragActiveRef.current
      ) {
        return
      }

      // Locally compute the fade ratio for this gesture's bounds check.
      // We use item.durationInFrames here (no trim/stretch preview in progress
      // at mouseDown), which avoids a circular dep on visualWidthFrames.
      const clipFadeDurationFrames = Math.max(1, Math.round(item.durationInFrames))
      const fadeRatio =
        handle === 'in'
          ? getAudioFadeRatio(displayedAudioFadeIn, fps, clipFadeDurationFrames)
          : getAudioFadeRatio(displayedAudioFadeOut, fps, clipFadeDurationFrames)
      if (fadeRatio <= 0) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const originalFadeInCurve = displayedAudioFadeInCurve
      const originalFadeOutCurve = displayedAudioFadeOutCurve
      const originalFadeInCurveX = displayedAudioFadeInCurveX
      const originalFadeOutCurveX = displayedAudioFadeOutCurveX
      const persistedFadeInCurve = item.audioFadeInCurve ?? 0
      const persistedFadeOutCurve = item.audioFadeOutCurve ?? 0
      const persistedFadeInCurveX = item.audioFadeInCurveX ?? 0.52
      const persistedFadeOutCurveX = item.audioFadeOutCurveX ?? 0.52

      const computeCurve = (clientX: number, clientY: number) => {
        const rect = audioControlsRef.current?.getBoundingClientRect()
        if (!rect) {
          return {
            curve: handle === 'in' ? originalFadeInCurve : originalFadeOutCurve,
            curveX: handle === 'in' ? originalFadeInCurveX : originalFadeOutCurveX,
          }
        }
        return getAudioFadeCurveFromOffset({
          handle,
          pointerOffsetX: clientX - rect.left,
          pointerOffsetY: clientY - rect.top,
          fadePixels: fadeRatio * rect.width,
          clipWidthPixels: rect.width,
          rowHeight: rect.height,
        })
      }

      const applyPreview = (next: { curve: number; curveX: number }) => {
        setAudioFadeCurveEdit({
          handle,
          previewFadeInCurve: handle === 'in' ? next.curve : originalFadeInCurve,
          previewFadeOutCurve: handle === 'out' ? next.curve : originalFadeOutCurve,
          previewFadeInCurveX: handle === 'in' ? next.curveX : originalFadeInCurveX,
          previewFadeOutCurveX: handle === 'out' ? next.curveX : originalFadeOutCurveX,
          originalFadeInCurve,
          originalFadeOutCurve,
          originalFadeInCurveX,
          originalFadeOutCurveX,
          isCommitting: false,
        })
      }

      const finishEdit = () => {
        const latestState = audioFadeCurveEditRef.current
        const committedCurve =
          handle === 'in'
            ? (latestState?.previewFadeInCurve ?? originalFadeInCurve)
            : (latestState?.previewFadeOutCurve ?? originalFadeOutCurve)
        const committedCurveX =
          handle === 'in'
            ? (latestState?.previewFadeInCurveX ?? originalFadeInCurveX)
            : (latestState?.previewFadeOutCurveX ?? originalFadeOutCurveX)
        audioFadeCurveCleanupRef.current?.()
        audioFadeCurveCleanupRef.current = null

        if (handle === 'in') {
          if (
            Math.abs(committedCurve - persistedFadeInCurve) > AUDIO_FADE_EPSILON ||
            Math.abs(committedCurveX - persistedFadeInCurveX) > AUDIO_FADE_EPSILON
          ) {
            setAudioFadeCurveEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
            updateTimelineItem(item.id, {
              audioFadeInCurve: committedCurve,
              audioFadeInCurveX: committedCurveX,
            })
          } else {
            setAudioFadeCurveEdit(null)
          }
        } else if (
          Math.abs(committedCurve - persistedFadeOutCurve) > AUDIO_FADE_EPSILON ||
          Math.abs(committedCurveX - persistedFadeOutCurveX) > AUDIO_FADE_EPSILON
        ) {
          setAudioFadeCurveEdit((prev) => (prev ? { ...prev, isCommitting: true } : prev))
          updateTimelineItem(item.id, {
            audioFadeOutCurve: committedCurve,
            audioFadeOutCurveX: committedCurveX,
          })
        } else {
          setAudioFadeCurveEdit(null)
        }
      }

      applyPreview(computeCurve(e.clientX, e.clientY))

      const handleWindowMouseMove = (event: MouseEvent) => {
        applyPreview(computeCurve(event.clientX, event.clientY))
      }
      const handleWindowMouseUp = () => {
        finishEdit()
      }

      window.addEventListener('mousemove', handleWindowMouseMove)
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
      audioFadeCurveCleanupRef.current = () => {
        window.removeEventListener('mousemove', handleWindowMouseMove)
        window.removeEventListener('mouseup', handleWindowMouseUp)
      }
    },
    [
      activeTool,
      displayedAudioFadeIn,
      displayedAudioFadeInCurve,
      displayedAudioFadeInCurveX,
      displayedAudioFadeOut,
      displayedAudioFadeOutCurve,
      displayedAudioFadeOutCurveX,
      fps,
      isAnyDragActiveRef,
      item,
      trackLocked,
      updateTimelineItem,
    ],
  )

  const handleAudioVolumeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (
        item.type !== 'audio' ||
        trackLocked ||
        activeTool !== 'select' ||
        isAnyDragActiveRef.current
      ) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const originalVolume = item.volume ?? 0
      const dragStartLiveGain = getMixerLiveGain(item.id)
      const startClientY = e.clientY
      let latestClientY = startClientY
      let latestPreviewVolume = originalVolume
      let isDragActive = false
      let activationTimeoutId: number | null = null
      const dragAnchorY = startClientY
      const dragAnchorVolume = originalVolume

      const applyPreview = (nextVolume: number) => {
        latestPreviewVolume = nextVolume
        applyAudioVolumeVisualPreview(nextVolume)
        const gainRatio = Math.pow(10, (nextVolume - originalVolume) / 20)
        setMixerLiveGains([{ itemId: item.id, gain: dragStartLiveGain * gainRatio }])
      }

      const clearActivationTimeout = () => {
        if (activationTimeoutId !== null) {
          window.clearTimeout(activationTimeoutId)
          activationTimeoutId = null
        }
      }

      const computeVolumeDb = (clientY: number) => {
        const rect = audioControlsRef.current?.getBoundingClientRect()
        if (!rect) {
          return originalVolume
        }
        return getAudioVolumeDbFromDragDelta({
          startVolumeDb: dragAnchorVolume,
          pointerDeltaY: clientY - dragAnchorY,
          height: rect.height,
        })
      }

      const activateDrag = () => {
        if (isDragActive) {
          return
        }
        isDragActive = true
        setAudioVolumeEdit({
          originalVolume,
          isCommitting: false,
        })
        applyPreview(computeVolumeDb(latestClientY))
      }

      const finishEdit = () => {
        const committedVolume = audioVolumePreviewRef.current ?? latestPreviewVolume
        audioVolumeCleanupRef.current?.()
        audioVolumeCleanupRef.current = null
        finalizeAudioVolumeChange(committedVolume, {
          preserveLiveGainOnCommit: true,
          commitFromActiveEdit: true,
        })
      }

      const handleWindowMouseMove = (event: MouseEvent) => {
        latestClientY = event.clientY
        if (!isDragActive) {
          if (Math.abs(event.clientY - startClientY) < AUDIO_VOLUME_DRAG_ACTIVATION_DISTANCE_PX) {
            return
          }
          clearActivationTimeout()
          activateDrag()
          return
        }
        applyPreview(computeVolumeDb(event.clientY))
      }
      const handleWindowMouseUp = () => {
        if (!isDragActive) {
          audioVolumeCleanupRef.current?.()
          audioVolumeCleanupRef.current = null
          finalizeAudioVolumeChange(originalVolume)
          return
        }
        finishEdit()
      }

      window.addEventListener('mousemove', handleWindowMouseMove)
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
      activationTimeoutId = window.setTimeout(() => {
        clearActivationTimeout()
        activateDrag()
      }, AUDIO_VOLUME_DRAG_ACTIVATION_DELAY_MS)
      audioVolumeCleanupRef.current = () => {
        clearActivationTimeout()
        window.removeEventListener('mousemove', handleWindowMouseMove)
        window.removeEventListener('mouseup', handleWindowMouseUp)
      }
    },
    [
      activeTool,
      applyAudioVolumeVisualPreview,
      finalizeAudioVolumeChange,
      isAnyDragActiveRef,
      item,
      trackLocked,
    ],
  )

  const handleAudioVolumeDoubleClick = useCallback(() => {
    if (item.type !== 'audio' || trackLocked) {
      return
    }
    audioVolumeCleanupRef.current?.()
    audioVolumeCleanupRef.current = null
    finalizeAudioVolumeChange(0)
  }, [finalizeAudioVolumeChange, item, trackLocked])

  const handleVideoFadeHandleDoubleClick = useCallback(
    (handle: AudioFadeHandle) => {
      if (!isVisualFadeItem || trackLocked) {
        return
      }
      videoFadeCleanupRef.current?.()
      videoFadeCleanupRef.current = null
      setVideoFadeEdit(null)
      if (handle === 'in') {
        if ((item.fadeIn ?? 0) > VIDEO_FADE_EPSILON) {
          updateTimelineItem(item.id, { fadeIn: 0 })
        }
        return
      }
      if ((item.fadeOut ?? 0) > VIDEO_FADE_EPSILON) {
        updateTimelineItem(item.id, { fadeOut: 0 })
      }
    },
    [isVisualFadeItem, item, trackLocked, updateTimelineItem],
  )

  const handleAudioFadeHandleDoubleClick = useCallback(
    (handle: AudioFadeHandle) => {
      if (item.type !== 'audio' || trackLocked) {
        return
      }
      audioFadeCleanupRef.current?.()
      audioFadeCleanupRef.current = null
      setAudioFadeEdit(null)
      if (handle === 'in') {
        if ((item.audioFadeIn ?? 0) > AUDIO_FADE_EPSILON) {
          updateTimelineItem(item.id, { audioFadeIn: 0 })
        }
        return
      }
      if ((item.audioFadeOut ?? 0) > AUDIO_FADE_EPSILON) {
        updateTimelineItem(item.id, { audioFadeOut: 0 })
      }
    },
    [item, trackLocked, updateTimelineItem],
  )

  const handleAudioFadeCurveDotDoubleClick = useCallback(
    (handle: AudioFadeHandle) => {
      if (item.type !== 'audio' || trackLocked) {
        return
      }
      audioFadeCurveCleanupRef.current?.()
      audioFadeCurveCleanupRef.current = null
      setAudioFadeCurveEdit(null)
      if (handle === 'in') {
        if (
          Math.abs(item.audioFadeInCurve ?? 0) > AUDIO_FADE_EPSILON ||
          Math.abs((item.audioFadeInCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON
        ) {
          updateTimelineItem(item.id, { audioFadeInCurve: 0, audioFadeInCurveX: 0.52 })
        }
        return
      }
      if (
        Math.abs(item.audioFadeOutCurve ?? 0) > AUDIO_FADE_EPSILON ||
        Math.abs((item.audioFadeOutCurveX ?? 0.52) - 0.52) > AUDIO_FADE_EPSILON
      ) {
        updateTimelineItem(item.id, { audioFadeOutCurve: 0, audioFadeOutCurveX: 0.52 })
      }
    },
    [item, trackLocked, updateTimelineItem],
  )

  return {
    videoControlsRef,
    audioControlsRef,
    volumeLineRef,
    audioVolumeEditLabelRef,
    isVisualFadeItem,
    videoFadeEdit,
    audioFadeEdit,
    audioFadeCurveEdit,
    audioVolumeEdit,
    displayedVideoFadeIn,
    displayedVideoFadeOut,
    displayedAudioFadeIn,
    displayedAudioFadeOut,
    displayedAudioFadeInCurve,
    displayedAudioFadeOutCurve,
    displayedAudioFadeInCurveX,
    displayedAudioFadeOutCurveX,
    displayedAudioVolumeDb,
    audioVolumePreviewRef,
    handleVideoFadeHandleMouseDown,
    handleVideoFadeHandleDoubleClick,
    handleAudioFadeHandleMouseDown,
    handleAudioFadeHandleDoubleClick,
    handleAudioFadeCurveDotMouseDown,
    handleAudioFadeCurveDotDoubleClick,
    handleAudioVolumeMouseDown,
    handleAudioVolumeDoubleClick,
  }
}
