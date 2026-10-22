/**
 * The rest of the window for an agent, so it runs the whole work from a new project to the finished file as the
 * person does: projects and their trash, the media library and what is in a file, a frame of the timeline as a
 * picture, transcripts and captions, the window's own settings and pages, and what the generation panel keeps
 * (elements, storyboard, canvas, presets, variables, blocking). Each command calls the window's own function for it.
 */

import { i18n } from '@/i18n'
import type { TimelineItem } from '@/types/timeline'
import type { CaptionReveal } from '@/types/text'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useUiSoundStore } from '@/shared/state/ui-sound-store'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { listAudioOutputs, useAudioOutputStore } from '@/shared/state/audio-output-store'
import { CAPTION_STYLE_PRESETS } from '@/shared/typography/caption-style-presets'
import { VOICE_OPTIONS, type VoiceName } from '@/infrastructure/audio/ui-sound'
import { changeAppLanguage } from '@/i18n'
import { SUPPORTED_LANGUAGE_CODES } from '@/i18n/languages'
import { saveToDisk } from '@/infrastructure/desktop'
import {
  besideGraph,
  commitProjectMetadataChange,
  createProjectFormSchema,
  cutSegment,
  DEFAULT_PROJECT_VALUES,
  fcpxmlFile,
  importLastFrame,
  instantiate,
  listTrashedProjects,
  markDirty,
  mediaLibraryService,
  mediaTranscriptionService,
  openSettings,
  readWorkflowFile,
  runMediaTranscriptionJob,
  saveTimeline,
  updateItem,
  useGenerateStore,
  useItemsStore,
  useMediaLibraryStore,
  useProjectStore,
  useSettingsStore,
  workflowFile,
  WORKFLOW_TEMPLATES,
  type ModelsFor,
  cancelMicRecording,
  refreshMicDevices,
  stopMicRecording,
  insertFreezeFrame,
} from '../deps/editor'
import {
  bridgeError,
  failed,
  numberArg,
  registerBridgeCommand,
  takeArgs,
  textArg,
  type BridgeArgs,
} from './bridge'

export type ShowPage = (page: 'projects' | 'new_project' | 'docs' | 'changelog') => Promise<void>
type ShowProject = (projectId: string | null) => Promise<void>

const SETTINGS_SECTIONS = [
  'providers',
  'agents',
  'general',
  'timeline',
  'ai',
  'storage',
  'network',
  'privacy',
  'about',
]

/** The editor's settings an agent may read and change; the person's guards and keys stay in their hands. */
const WINDOW_SETTINGS = [
  'snapEnabled',
  'canvasSnapEnabled',
  'showWaveforms',
  'showFilmstrips',
  'enableFilmstripExtraction',
  'editorDensity',
  'maxUndoHistory',
  'autoSaveInterval',
  'defaultWhisperModel',
  'defaultWhisperLanguage',
  'captioningIntervalUnit',
  'captioningIntervalValue',
  'captionSearchMode',
  'defaultCaptionStylePresetId',
] as const

function openProject() {
  const project = useProjectStore.getState().currentProject
  if (!project || !window.location.pathname.startsWith('/editor/')) throw bridgeError('no_project')
  return project
}

function listArg(command: string, args: BridgeArgs, field: string): string[] {
  const value = args[field]
  if (!Array.isArray(value) || value.some((each) => typeof each !== 'string' || !each)) {
    throw bridgeError('bad_value', { command, field, expected: 'a list of ids' })
  }
  return value as string[]
}

function boolArg(command: string, args: BridgeArgs, field: string): boolean | undefined {
  const value = args[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean')
    throw bridgeError('bad_value', { command, field, expected: 'true or false' })
  return value
}

function required<T>(command: string, field: string, value: T | undefined): T {
  if (value === undefined) throw bridgeError('missing', { command, field })
  return value
}

const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

/** A picture as an agent receives it: JPEG of at most `width` pixels across. */
async function asPicture(
  source: CanvasImageSource & { width: number; height: number },
  width: number,
  text: string,
) {
  const scale = Math.min(1, width / source.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('the window cannot draw the picture')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return {
    image: canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, ''),
    mime: 'image/jpeg',
    text,
  }
}

/** The preview's frame now, as the camera button takes it. */
async function previewCanvas(): Promise<OffscreenCanvas | HTMLCanvasElement> {
  const bridge = usePreviewBridgeStore.getState()
  if (!bridge.captureCanvasSource)
    throw new Error('the preview is not open: open the project in the editor')
  const canvas = await bridge.captureCanvasSource()
  if (!canvas) throw new Error('the preview gave no frame')
  return canvas
}

async function seekTo(seconds: number | undefined, fps: number): Promise<number> {
  const playback = usePlaybackStore.getState()
  if (seconds !== undefined) {
    if (seconds < 0) throw new Error('at_seconds is 0 or more')
    playback.setCurrentFrame(Math.round(seconds * fps))
    await nextPaint()
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return usePlaybackStore.getState().currentFrame
}

async function mediaUrl(mediaId: string): Promise<{ url: string; type: string; name: string }> {
  const metadata = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!metadata)
    throw new Error(`no media ${mediaId} in the open project's library (media_list names them)`)
  const blob = await mediaLibraryService.getMediaFile(mediaId)
  if (!blob) throw new Error(`the file of ${metadata.fileName} is not on this computer`)
  return { url: URL.createObjectURL(blob), type: metadata.mimeType, name: metadata.fileName }
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error('the video does not open'))
    video.src = url
  })
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('the video cannot seek there'))
    video.currentTime = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.05))
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the picture does not open'))
    image.src = url
  })
}

function generationChoices() {
  const state = useGenerateStore.getState()
  if (!state.choicesRead)
    throw new Error('the generation panel has not read its choices yet; try again in a moment')
  return state
}

export function registerStudioCommands(showProject: ShowProject, showPage: ShowPage): void {
  // ------------------------------------------------------------ projects

  registerBridgeCommand('project_create', async (args) => {
    takeArgs('project_create', args, ['name', 'width', 'height', 'fps', 'background'])
    const name = required('project_create', 'name', textArg('project_create', args, 'name'))
    const data = createProjectFormSchema(i18n.t.bind(i18n)).safeParse({
      ...DEFAULT_PROJECT_VALUES,
      name,
      width: numberArg('project_create', args, 'width') ?? DEFAULT_PROJECT_VALUES.width,
      height: numberArg('project_create', args, 'height') ?? DEFAULT_PROJECT_VALUES.height,
      fps: numberArg('project_create', args, 'fps') ?? DEFAULT_PROJECT_VALUES.fps,
      backgroundColor:
        textArg('project_create', args, 'background') ?? DEFAULT_PROJECT_VALUES.backgroundColor,
    })
    if (!data.success)
      throw failed(
        'project_create',
        new Error(
          data.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        ),
      )
    let project
    try {
      project = await useProjectStore.getState().createProject(data.data)
      await showProject(project.id)
    } catch (problem) {
      throw failed('project_create', problem)
    }
    return { project_id: project.id, name: project.name, ...project.metadata }
  })

  registerBridgeCommand('project_update', async (args) => {
    takeArgs('project_update', args, ['name', 'width', 'height', 'fps', 'background'])
    const project = openProject()
    const name = textArg('project_update', args, 'name')
    const updates = {
      ...(numberArg('project_update', args, 'width') !== undefined && {
        width: Math.round(numberArg('project_update', args, 'width')! / 2) * 2,
      }),
      ...(numberArg('project_update', args, 'height') !== undefined && {
        height: Math.round(numberArg('project_update', args, 'height')! / 2) * 2,
      }),
      ...(numberArg('project_update', args, 'fps') !== undefined && {
        fps: numberArg('project_update', args, 'fps')!,
      }),
      ...(textArg('project_update', args, 'background') !== undefined && {
        backgroundColor: textArg('project_update', args, 'background')!,
      }),
    }
    if (name === undefined && Object.keys(updates).length === 0)
      throw bridgeError('missing', {
        command: 'project_update',
        field: 'name, width, height, fps or background',
      })
    const check = createProjectFormSchema(i18n.t.bind(i18n)).safeParse({
      name: name ?? project.name,
      description: project.description,
      width: project.metadata.width,
      height: project.metadata.height,
      fps: project.metadata.fps,
      backgroundColor: project.metadata.backgroundColor ?? DEFAULT_PROJECT_VALUES.backgroundColor,
      ...updates,
    })
    if (!check.success)
      throw failed(
        'project_update',
        new Error(
          check.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        ),
      )
    try {
      const store = useProjectStore.getState()
      if (Object.keys(updates).length > 0) {
        await commitProjectMetadataChange({
          project,
          updates,
          command: { type: 'UPDATE_PROJECT_METADATA', payload: { fields: Object.keys(updates) } },
          updateProject: store.updateProject,
          markDirty,
        })
      }
      if (name !== undefined) await store.updateProject(project.id, { name })
    } catch (problem) {
      throw failed('project_update', problem)
    }
    const now = openProject()
    return { project_id: now.id, name: now.name, ...now.metadata }
  })

  registerBridgeCommand('project_delete', async (args) => {
    takeArgs('project_delete', args, ['project_id'])
    const id = required(
      'project_delete',
      'project_id',
      textArg('project_delete', args, 'project_id'),
    )
    try {
      if (useProjectStore.getState().currentProject?.id === id) await showProject(null)
      const trashed = await useProjectStore.getState().deleteProject(id)
      return { project_id: id, trashed: true, name: trashed.originalName }
    } catch (problem) {
      throw failed('project_delete', problem)
    }
  })

  registerBridgeCommand('projects_trash', async (args) => {
    takeArgs('projects_trash', args, [])
    try {
      return { trashed: await listTrashedProjects() }
    } catch (problem) {
      throw failed('projects_trash', problem)
    }
  })

  registerBridgeCommand('project_restore', async (args) => {
    takeArgs('project_restore', args, ['project_id'])
    const id = required(
      'project_restore',
      'project_id',
      textArg('project_restore', args, 'project_id'),
    )
    try {
      await useProjectStore.getState().restoreProject(id)
    } catch (problem) {
      throw failed('project_restore', problem)
    }
    return { project_id: id, restored: true }
  })

  registerBridgeCommand('project_duplicate', async (args) => {
    takeArgs('project_duplicate', args, ['project_id'])
    const id = required(
      'project_duplicate',
      'project_id',
      textArg('project_duplicate', args, 'project_id'),
    )
    try {
      const copy = await useProjectStore.getState().duplicateProject(id)
      return { project_id: copy.id, name: copy.name }
    } catch (problem) {
      throw failed('project_duplicate', problem)
    }
  })

  // ------------------------------------------------------------ media and what is in it

  registerBridgeCommand('media_delete', async (args) => {
    takeArgs('media_delete', args, ['ids'])
    openProject()
    const ids = listArg('media_delete', args, 'ids')
    const known = useMediaLibraryStore.getState().mediaById
    const unknown = ids.filter((id) => !known[id])
    if (unknown.length > 0)
      throw failed(
        'media_delete',
        new Error(`no media ${unknown.join(', ')} in the open project's library`),
      )
    try {
      await useMediaLibraryStore.getState().deleteMediaBatch(ids)
    } catch (problem) {
      throw failed('media_delete', problem)
    }
    return { deleted: ids }
  })

  registerBridgeCommand('media_frame', async (args) => {
    takeArgs('media_frame', args, ['media_id', 'at_seconds', 'max_width'])
    openProject()
    const id = required('media_frame', 'media_id', textArg('media_frame', args, 'media_id'))
    const at = numberArg('media_frame', args, 'at_seconds') ?? 0
    const width = numberArg('media_frame', args, 'max_width') ?? 1024
    let file
    try {
      file = await mediaUrl(id)
      if (file.type.startsWith('image/'))
        return await asPicture(await loadImage(file.url), width, `${file.name}.`)
      if (!file.type.startsWith('video/'))
        throw new Error(`${file.name} is ${file.type}: it has no picture`)
      const video = await loadVideo(file.url)
      await seekVideo(video, at)
      return await asPicture(
        Object.assign(video, { width: video.videoWidth, height: video.videoHeight }),
        width,
        `${file.name} at ${Math.round(video.currentTime * 100) / 100} s of ${Math.round(video.duration * 100) / 100} s.`,
      )
    } catch (problem) {
      throw failed('media_frame', problem)
    } finally {
      if (file) URL.revokeObjectURL(file.url)
    }
  })

  registerBridgeCommand('frame_get', async (args) => {
    takeArgs('frame_get', args, ['at_seconds', 'max_width'])
    const project = openProject()
    try {
      const frame = await seekTo(numberArg('frame_get', args, 'at_seconds'), project.metadata.fps)
      const canvas = await previewCanvas()
      return await asPicture(
        canvas,
        numberArg('frame_get', args, 'max_width') ?? 1024,
        `The timeline at ${Math.round((frame / project.metadata.fps) * 100) / 100} s (frame ${frame}).`,
      )
    } catch (problem) {
      throw failed('frame_get', problem)
    }
  })

  registerBridgeCommand('frame_save', async (args) => {
    takeArgs('frame_save', args, ['at_seconds', 'name'])
    const project = openProject()
    try {
      const frame = await seekTo(numberArg('frame_save', args, 'at_seconds'), project.metadata.fps)
      const canvas = await previewCanvas()
      const blob =
        canvas instanceof HTMLCanvasElement
          ? await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (made) => (made ? resolve(made) : reject(new Error('the frame was not encoded'))),
                'image/png',
              ),
            )
          : await canvas.convertToBlob({ type: 'image/png' })
      const name = `${textArg('frame_save', args, 'name') ?? `${project.name}, frame ${frame}`}.png`
      const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() })
      const media = await mediaLibraryService.importGeneratedImage(file, project.id, {
        width: canvas.width,
        height: canvas.height,
        tags: ['frame-capture'],
        codec: 'png',
      })
      useMediaLibraryStore.getState().prependMediaItem(media)
      return { media_id: media.id, name: media.fileName }
    } catch (problem) {
      throw failed('frame_save', problem)
    }
  })

  registerBridgeCommand('media_last_frame', async (args) => {
    takeArgs('media_last_frame', args, ['media_id'])
    const project = openProject()
    const id = required(
      'media_last_frame',
      'media_id',
      textArg('media_last_frame', args, 'media_id'),
    )
    let file
    try {
      file = await mediaUrl(id)
      if (!file.type.startsWith('video/')) throw new Error(`${file.name} is not a video`)
      const name = `${file.name.replace(/\.[^.]+$/, '')}, last frame.png`
      const mediaId = await importLastFrame(file.url, name, project.id)
      return { media_id: mediaId, name }
    } catch (problem) {
      throw failed('media_last_frame', problem)
    } finally {
      if (file) URL.revokeObjectURL(file.url)
    }
  })

  registerBridgeCommand('media_cut', async (args) => {
    takeArgs('media_cut', args, ['media_id', 'start_seconds', 'end_seconds'])
    const project = openProject()
    const id = required('media_cut', 'media_id', textArg('media_cut', args, 'media_id'))
    const start = required(
      'media_cut',
      'start_seconds',
      numberArg('media_cut', args, 'start_seconds'),
    )
    const end = required('media_cut', 'end_seconds', numberArg('media_cut', args, 'end_seconds'))
    if (start < 0 || end <= start)
      throw bridgeError('bad_value', {
        command: 'media_cut',
        field: 'end_seconds',
        expected: 'after start_seconds, which is 0 or more',
      })
    try {
      const metadata = useMediaLibraryStore.getState().mediaById[id]
      const source = metadata ? await mediaLibraryService.getMediaFile(id) : null
      if (!metadata || !source) throw new Error(`no file of media ${id} in the open project`)
      const cut = await cutSegment(source, start, end)
      const name = `${metadata.fileName.replace(/\.[^.]+$/, '')}, ${start}-${end} s.mp4`
      const media = await mediaLibraryService.importGeneratedVideo(
        new File([cut], name, { type: 'video/mp4', lastModified: Date.now() }),
        project.id,
        { tags: ['segment'] },
      )
      useMediaLibraryStore.getState().prependMediaItem(media)
      return { media_id: media.id, name: media.fileName }
    } catch (problem) {
      throw failed('media_cut', problem)
    }
  })

  // ------------------------------------------------------------ transcripts and captions

  registerBridgeCommand('transcribe', async (args) => {
    takeArgs('transcribe', args, ['media_id', 'model', 'language'])
    openProject()
    const id = required('transcribe', 'media_id', textArg('transcribe', args, 'media_id'))
    try {
      const result = await runMediaTranscriptionJob(id, {
        ...(textArg('transcribe', args, 'model') && {
          model: textArg('transcribe', args, 'model') as never,
        }),
        ...(textArg('transcribe', args, 'language') && {
          language: textArg('transcribe', args, 'language'),
        }),
      })
      const transcript = await mediaTranscriptionService.getTranscript(id)
      return { media_id: id, result, transcript }
    } catch (problem) {
      throw failed('transcribe', problem)
    }
  })

  registerBridgeCommand('transcript_get', async (args) => {
    takeArgs('transcript_get', args, ['media_id'])
    openProject()
    const id = required('transcript_get', 'media_id', textArg('transcript_get', args, 'media_id'))
    const transcript = await mediaTranscriptionService.getTranscript(id)
    if (!transcript)
      throw failed('transcript_get', new Error(`${id} has no transcript yet: call transcribe`))
    return { media_id: id, transcript }
  })

  registerBridgeCommand('captions_add', async (args) => {
    takeArgs('captions_add', args, ['media_id', 'clip_ids', 'replace', 'reveal', 'highlight'])
    const project = openProject()
    const id = required('captions_add', 'media_id', textArg('captions_add', args, 'media_id'))
    const reveal = textArg('captions_add', args, 'reveal')
    if (reveal !== undefined && !['whole', 'words', 'karaoke'].includes(reveal)) {
      throw bridgeError('bad_value', {
        command: 'captions_add',
        field: 'reveal',
        expected: 'whole, words or karaoke',
      })
    }
    const highlight = textArg('captions_add', args, 'highlight')
    const clipIds =
      args.clip_ids === undefined ? undefined : listArg('captions_add', args, 'clip_ids')
    try {
      if (!(await mediaTranscriptionService.getTranscript(id))) await runMediaTranscriptionJob(id)
      const result = await mediaTranscriptionService.enableTranscriptCaptions(id, {
        ...(clipIds && { clipIds }),
        replaceExisting: boolArg('captions_add', args, 'replace') ?? true,
      })
      if (reveal !== undefined || highlight !== undefined) {
        for (const item of useItemsStore.getState().items) {
          const captions = 'transcriptCaptions' in item ? item.transcriptCaptions : undefined
          if (captions?.mediaId !== id || (clipIds && !clipIds.includes(item.id))) continue
          updateItem(item.id, {
            transcriptCaptions: {
              ...captions,
              style: {
                ...captions.style,
                ...(reveal !== undefined && { captionReveal: reveal as CaptionReveal }),
                ...(highlight !== undefined && { captionHighlight: highlight }),
              },
              updatedAt: Date.now(),
            },
          } as Partial<TimelineItem>)
        }
      }
      await saveTimeline(project.id)
      return { media_id: id, result }
    } catch (problem) {
      throw failed('captions_add', problem)
    }
  })

  // ------------------------------------------------------------ the window itself

  registerBridgeCommand('window_settings_get', async (args) => {
    takeArgs('window_settings_get', args, [])
    const settings = useSettingsStore.getState()
    const sound = useUiSoundStore.getState()
    const output = useAudioOutputStore.getState()
    const outputs = await listAudioOutputs({ names: false }).then(
      (devices) =>
        devices.length
          ? { sound_outputs: devices.map(({ id, label }) => ({ id, label })) }
          : {
              sound_outputs: [],
              sound_outputs_hidden:
                'The browser lists the sound outputs only to a page allowed the microphone, and only the person allows it: ask them to open Settings, General, Sound output once.',
            },
      (problem: unknown) => ({
        sound_outputs_error: problem instanceof Error ? problem.message : String(problem),
      }),
    )
    return {
      language: i18n.language,
      languages: SUPPORTED_LANGUAGE_CODES,
      sounds: { enabled: sound.enabled, volume: sound.volume, voice: sound.voice },
      sounds_voices: VOICE_OPTIONS.map((option) => option.value),
      sound_output: { id: output.deviceId, label: output.label },
      ...outputs,
      caption_presets: CAPTION_STYLE_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
      })),
      ...Object.fromEntries(WINDOW_SETTINGS.map((key) => [key, settings[key]])),
    }
  })

  registerBridgeCommand('window_settings_set', async (args) => {
    const known = [
      ...WINDOW_SETTINGS,
      'language',
      'sounds_enabled',
      'sounds_volume',
      'sounds_voice',
      'sound_output',
    ]
    takeArgs('window_settings_set', args, known)
    const settings = useSettingsStore.getState()
    for (const key of WINDOW_SETTINGS) {
      if (args[key] === undefined) continue
      if (typeof args[key] !== typeof settings[key])
        throw bridgeError('bad_value', {
          command: 'window_settings_set',
          field: key,
          expected: `a ${typeof settings[key]}`,
        })
      if (
        key === 'defaultCaptionStylePresetId' &&
        !CAPTION_STYLE_PRESETS.some((preset) => preset.id === args[key])
      )
        throw bridgeError('bad_value', {
          command: 'window_settings_set',
          field: key,
          expected: 'an id of caption_presets from window_settings_get',
        })
      settings.setSetting(key, args[key] as never)
    }
    const language = textArg('window_settings_set', args, 'language')
    if (language !== undefined) {
      if (!SUPPORTED_LANGUAGE_CODES.includes(language))
        throw bridgeError('bad_value', {
          command: 'window_settings_set',
          field: 'language',
          expected: SUPPORTED_LANGUAGE_CODES.join(', '),
        })
      await changeAppLanguage(language)
    }
    const enabled = boolArg('window_settings_set', args, 'sounds_enabled')
    if (enabled !== undefined) useUiSoundStore.getState().setEnabled(enabled)
    const volume = numberArg('window_settings_set', args, 'sounds_volume')
    if (volume !== undefined) {
      if (volume < 0 || volume > 1)
        throw bridgeError('bad_value', {
          command: 'window_settings_set',
          field: 'sounds_volume',
          expected: 'from 0 to 1',
        })
      useUiSoundStore.getState().setVolume(volume)
    }
    const voice = textArg('window_settings_set', args, 'sounds_voice')
    if (voice !== undefined) {
      if (!VOICE_OPTIONS.some((option) => option.value === voice))
        throw bridgeError('bad_value', {
          command: 'window_settings_set',
          field: 'sounds_voice',
          expected: VOICE_OPTIONS.map((option) => option.value).join(', '),
        })
      useUiSoundStore.getState().setVoice(voice as VoiceName)
    }
    const outputId = textArg('window_settings_set', args, 'sound_output')
    if (outputId !== undefined) {
      if (outputId === '') useAudioOutputStore.getState().choose('', '')
      else {
        const device = (await listAudioOutputs({ names: false })).find(
          (each) => each.id === outputId,
        )
        if (!device)
          throw bridgeError('bad_value', {
            command: 'window_settings_set',
            field: 'sound_output',
            expected:
              'an id of sound_outputs from window_settings_get, or empty for the system default',
          })
        useAudioOutputStore.getState().choose(device.id, device.label)
      }
    }
    return { changed: Object.keys(args) }
  })

  registerBridgeCommand('ui_open_settings', async (args) => {
    takeArgs('ui_open_settings', args, ['section'])
    const section = textArg('ui_open_settings', args, 'section') ?? 'general'
    if (!SETTINGS_SECTIONS.includes(section))
      throw bridgeError('bad_value', {
        command: 'ui_open_settings',
        field: 'section',
        expected: SETTINGS_SECTIONS.join(', '),
      })
    openSettings(section)
    return { opened: section }
  })

  registerBridgeCommand('freeze_frame', async (args) => {
    takeArgs('freeze_frame', args, ['clip_id', 'seconds'])
    const project = openProject()
    const id = required('freeze_frame', 'clip_id', textArg('freeze_frame', args, 'clip_id'))
    const seconds = required('freeze_frame', 'seconds', numberArg('freeze_frame', args, 'seconds'))
    const clip = useItemsStore.getState().items.find((item) => item.id === id)
    if (!clip || clip.type !== 'video')
      throw bridgeError('bad_value', {
        command: 'freeze_frame',
        field: 'clip_id',
        expected: 'a video clip on the timeline',
      })
    const frame = Math.round(seconds * (project.metadata?.fps ?? 30))
    if (frame <= clip.from || frame >= clip.from + clip.durationInFrames)
      throw bridgeError('bad_value', {
        command: 'freeze_frame',
        field: 'seconds',
        expected: 'a moment inside the clip, not at its edges',
      })
    const before = new Set(useItemsStore.getState().items.map((item) => item.id))
    if (!(await insertFreezeFrame(id, frame)))
      throw failed('freeze_frame', new Error('the frame could not be held'))
    await saveTimeline(project.id)
    const added = useItemsStore.getState().items.filter((item) => !before.has(item.id))
    return {
      created: added.map((item) => ({
        id: item.id,
        type: item.type,
        from: item.from,
        duration: item.durationInFrames,
      })),
    }
  })

  // ------------------------------------------------------------ recording a voice-over from the microphone

  const micState = () => {
    const mic = useMicRecordingStore.getState()
    return {
      status: mic.status,
      elapsed_seconds: Math.round(mic.elapsedMs / 100) / 10,
      level: Math.round(mic.level * 100) / 100,
      device_id: mic.selectedDeviceId,
      devices: mic.devices.map((device) => ({ id: device.deviceId, label: device.label })),
    }
  }

  registerBridgeCommand('mic_record_status', async (args) => {
    takeArgs('mic_record_status', args, [])
    await refreshMicDevices()
    return micState()
  })

  registerBridgeCommand('mic_record_stop', async (args) => {
    takeArgs('mic_record_stop', args, [])
    const before = new Set(useItemsStore.getState().items.map((item) => item.id))
    await stopMicRecording()
    const { error } = useMicRecordingStore.getState()
    if (error) throw failed('mic_record_stop', new Error(error))
    const added = useItemsStore.getState().items.filter((item) => !before.has(item.id))
    return {
      placed: added.map((item) => ({
        id: item.id,
        from: item.from,
        duration: item.durationInFrames,
      })),
    }
  })

  registerBridgeCommand('mic_record_cancel', async (args) => {
    takeArgs('mic_record_cancel', args, [])
    cancelMicRecording()
    return micState()
  })

  registerBridgeCommand('ui_navigate', async (args) => {
    takeArgs('ui_navigate', args, ['page'])
    const page = textArg('ui_navigate', args, 'page')
    if (page !== 'projects' && page !== 'new_project' && page !== 'docs' && page !== 'changelog') {
      throw bridgeError('bad_value', {
        command: 'ui_navigate',
        field: 'page',
        expected: 'projects, new_project, docs or changelog (project_open opens a project)',
      })
    }
    await showPage(page)
    return { page }
  })

  // ------------------------------------------------------------ what the generation panel keeps

  registerBridgeCommand('elements_list', async (args) => {
    takeArgs('elements_list', args, [])
    return { elements: generationChoices().elements }
  })

  registerBridgeCommand('element_save', async (args) => {
    takeArgs('element_save', args, ['name', 'media_ids'])
    const name = required('element_save', 'name', textArg('element_save', args, 'name'))
    if (!/^[\p{L}\p{N}_-]+$/u.test(name))
      throw bridgeError('bad_value', {
        command: 'element_save',
        field: 'name',
        expected: 'one word of letters, digits, - or _ (it is named as @name)',
      })
    const ids = listArg('element_save', args, 'media_ids')
    generationChoices().saveElement({ name, refs: ids.map((media) => ({ media })) })
    return { element: name, pictures: ids.length }
  })

  registerBridgeCommand('element_delete', async (args) => {
    takeArgs('element_delete', args, ['name'])
    const name = required('element_delete', 'name', textArg('element_delete', args, 'name'))
    if (!generationChoices().elements.some((each) => each.name === name))
      throw failed('element_delete', new Error(`no element ${name}`))
    generationChoices().removeElement(name)
    return { deleted: name }
  })

  registerBridgeCommand('presets_list', async (args) => {
    takeArgs('presets_list', args, [])
    const state = generationChoices()
    return { presets: state.presets, variables: state.variables }
  })

  registerBridgeCommand('preset_save', async (args) => {
    takeArgs('preset_save', args, ['name', 'text'])
    const name = required('preset_save', 'name', textArg('preset_save', args, 'name'))
    const text = required('preset_save', 'text', textArg('preset_save', args, 'text'))
    generationChoices().savePreset(name, text)
    return { preset: name }
  })

  registerBridgeCommand('preset_delete', async (args) => {
    takeArgs('preset_delete', args, ['name'])
    const name = required('preset_delete', 'name', textArg('preset_delete', args, 'name'))
    if (!generationChoices().presets.some((each) => each.name === name))
      throw failed('preset_delete', new Error(`no preset ${name}`))
    generationChoices().removePreset(name)
    return { deleted: name }
  })

  registerBridgeCommand('variables_set', async (args) => {
    takeArgs('variables_set', args, ['values'])
    const values = args.values
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.values(values).some((each) => typeof each !== 'string')
    ) {
      throw bridgeError('bad_value', {
        command: 'variables_set',
        field: 'values',
        expected: 'an object of name: text',
      })
    }
    for (const [name, value] of Object.entries(values as Record<string, string>))
      generationChoices().setVariable(name, value)
    return { variables: generationChoices().variables }
  })

  registerBridgeCommand('storyboard_get', async (args) => {
    takeArgs('storyboard_get', args, [])
    const project = openProject()
    return {
      storyboard: generationChoices().storyboards[project.id] ?? { script: '', shots: [] },
      models: generationChoices().storyboardModels,
    }
  })

  registerBridgeCommand('storyboard_set', async (args) => {
    takeArgs('storyboard_set', args, ['script', 'shots'])
    const project = openProject()
    const current = generationChoices().storyboards[project.id] ?? { script: '', shots: [] }
    const script = textArg('storyboard_set', args, 'script') ?? current.script
    let shots = current.shots
    if (args.shots !== undefined) {
      if (!Array.isArray(args.shots))
        throw bridgeError('bad_value', {
          command: 'storyboard_set',
          field: 'shots',
          expected: 'a list of {prompt, seconds, image_job?, video_job?}',
        })
      shots = (args.shots as Array<Record<string, unknown>>).map((shot, index) => {
        if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim())
          throw bridgeError('bad_value', {
            command: 'storyboard_set',
            field: `shots[${index}].prompt`,
            expected: 'text',
          })
        const seconds = typeof shot.seconds === 'number' && shot.seconds > 0 ? shot.seconds : 5
        return {
          id: crypto.randomUUID(),
          prompt: shot.prompt.trim(),
          seconds,
          imageJob: typeof shot.image_job === 'string' ? shot.image_job : null,
          videoJob: typeof shot.video_job === 'string' ? shot.video_job : null,
        }
      })
    }
    generationChoices().setStoryboard(project.id, { script, shots })
    return { storyboard: generationChoices().storyboards[project.id] }
  })

  registerBridgeCommand('canvas_get', async (args) => {
    takeArgs('canvas_get', args, [])
    const project = openProject()
    return {
      graph: generationChoices().canvases[project.id] ?? { nodes: [], edges: [] },
      templates: WORKFLOW_TEMPLATES.map((template) => ({
        id: template.id,
        name: i18n.t(`generate.canvas.workflow.template.${template.id}.name`),
        about: i18n.t(`generate.canvas.workflow.template.${template.id}.about`),
      })),
    }
  })

  registerBridgeCommand('canvas_set', async (args) => {
    takeArgs('canvas_set', args, ['graph', 'add'])
    const project = openProject()
    let piece
    try {
      piece = readWorkflowFile(
        JSON.stringify({
          kind: 'videosos-workflow',
          version: 1,
          name: project.name,
          graph: args.graph,
        }),
        () => crypto.randomUUID(),
      ).graph
    } catch (problem) {
      throw failed('canvas_set', problem)
    }
    const current = generationChoices().canvases[project.id] ?? { nodes: [], edges: [] }
    const graph = boolArg('canvas_set', args, 'add')
      ? { nodes: [...current.nodes, ...piece.nodes], edges: [...current.edges, ...piece.edges] }
      : piece
    generationChoices().setCanvas(project.id, graph)
    return { graph }
  })

  registerBridgeCommand('canvas_template', async (args) => {
    takeArgs('canvas_template', args, ['template'])
    const project = openProject()
    const id = required('canvas_template', 'template', textArg('canvas_template', args, 'template'))
    const template = WORKFLOW_TEMPLATES.find((each) => each.id === id)
    if (!template)
      throw bridgeError('bad_value', {
        command: 'canvas_template',
        field: 'template',
        expected: WORKFLOW_TEMPLATES.map((each) => each.id).join(', '),
      })
    const state = generationChoices()
    const current = state.canvases[project.id] ?? { nodes: [], edges: [] }
    const models: ModelsFor = (task) =>
      [state.modelByTask[task], ...(state.extraModelsByTask[task] ?? [])].filter(
        (model): model is NonNullable<typeof model> => !!model,
      )
    const piece = instantiate(
      template,
      besideGraph(current),
      models,
      (templateId, key) => i18n.t(`generate.canvas.workflow.template.${templateId}.prompts.${key}`),
      () => crypto.randomUUID(),
    )
    state.setCanvas(project.id, {
      nodes: [...current.nodes, ...piece.nodes],
      edges: [...current.edges, ...piece.edges],
    })
    return { added: piece, workflow: JSON.parse(workflowFile(piece, template.id)) }
  })

  registerBridgeCommand('blocking_get', async (args) => {
    takeArgs('blocking_get', args, [])
    const project = openProject()
    return { blocking: generationChoices().blockings[project.id] ?? null }
  })

  // ------------------------------------------------------------ handing the edit over

  registerBridgeCommand('export_fcpxml', async (args) => {
    takeArgs('export_fcpxml', args, [])
    openProject()
    try {
      const { blob, name, left } = await fcpxmlFile()
      const saved = await saveToDisk(blob, name, { dialog: false })
      if (!saved.path) throw new Error('the file was not saved')
      return { path: saved.path, left }
    } catch (problem) {
      throw failed('export_fcpxml', problem)
    }
  })
}
