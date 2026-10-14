/**
 * The editor's commands for an agent: what is open, the live timeline and its edits (each an undoable step of
 * the editor), the media library of the open project, the playhead and the sidebar. Registered once at
 * start; a command that needs an open project says so when none is.
 */

import { applyEditOpsLive } from '@/headless/edit'
import type { EditOp } from '@/headless/edit-op-support'
import { setEditCanvas } from '@/headless/edit-op-support'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import type { EditorSidebarTab } from '@/config/editor-workspaces'
import type { ExtendedExportSettings, VideoContainer } from '@/types/export'
import {
  agentBlocking,
  buildRenderJob,
  captureSnapshot,
  importPrevisFrame,
  importPrevisVideo,
  keepCheckpoint,
  makeMotionClip,
  motionName,
  mediaLibraryService,
  restoreCheckpoint,
  restoreSnapshot,
  saveTimeline,
  useRenderQueueStore,
  useItemsStore,
  useMediaLibraryStore,
  useProjectStore,
  useTimelineCommandStore,
  useTransitionsStore,
  withPrevisRenderer,
} from '../deps/editor'
import { bridgeError, failed, numberArg, registerBridgeCommand, takeArgs, textArg } from './bridge'
import { describeOps, useProposalStore } from './proposals'

const TABS: EditorSidebarTab[] = [
  'generate',
  'media',
  'text',
  'shapes',
  'effects',
  'transitions',
  'lottie',
  'transcript',
  'ai',
  'chat',
  'storyboard',
  'graphics',
  'blocking',
]

function openProject() {
  const project = useProjectStore.getState().currentProject
  if (!project || !window.location.pathname.startsWith('/editor/')) throw bridgeError('no_project')
  return project
}

function fpsOf(project: { metadata?: { fps?: number } }): number {
  return project.metadata?.fps || 30
}

const round = (value: number) => Math.round(value * 100) / 100

/** An agent's edit is saved at once: the person may close the window right after it. */
async function save(projectId: string): Promise<void> {
  try {
    await saveTimeline(projectId)
  } catch (problem) {
    throw failed('save', problem)
  }
}

/** Runs the ops on the live stores and puts everything, history included, back in the same tick. */
function rehearse(ops: EditOp[]) {
  const before = captureSnapshot()
  const { undoStack, redoStack } = useTimelineCommandStore.getState()
  try {
    const outcome = applyEditOpsLive(ops)
    return {
      wouldApply: outcome.results.filter((result) => result.ok).length,
      error: outcome.error ?? null,
      results: outcome.results,
      timeline: timeline(),
    }
  } finally {
    restoreSnapshot(before)
    useTimelineCommandStore.setState({
      undoStack,
      redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    })
  }
}

/** Whether the person asked to accept agents' edits, read anew each time so the switch takes effect at once. */
async function confirmsEdits(): Promise<boolean> {
  const response = await fetch('/api/settings', { cache: 'no-store' })
  if (!response.ok) throw failed('timeline_edit', `the settings did not come: ${response.status}`)
  return ((await response.json()) as { agent_confirm_edits?: boolean }).agent_confirm_edits === true
}

function timeline() {
  const project = openProject()
  const fps = fpsOf(project)
  const { items, tracks } = useItemsStore.getState()
  const media = useMediaLibraryStore.getState().mediaById
  return {
    project: { id: project.id, name: project.name, ...project.metadata },
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      order: track.order,
      muted: track.muted,
      visible: track.visible,
      locked: track.locked,
    })),
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      start_s: round(item.from / fps),
      length_s: round(item.durationInFrames / fps),
      mediaId: 'mediaId' in item ? item.mediaId : undefined,
      media: 'mediaId' in item && item.mediaId ? media[item.mediaId]?.fileName : undefined,
      text: 'text' in item ? item.text : undefined,
      label: item.label,
    })),
    transitions: useTransitionsStore.getState().transitions,
  }
}

/** Opens a project in the editor, or the projects list for `null`; the app owns the router. */
export type ShowProject = (projectId: string | null) => Promise<void>

export function registerEditorCommands(showProject: ShowProject): void {
  registerBridgeCommand('editor_state', async (args) => {
    takeArgs('editor_state', args, [])
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    const project = useProjectStore.getState().currentProject
    const playback = usePlaybackStore.getState()
    const open = !!project && window.location.pathname.startsWith('/editor/')
    return {
      screen: window.location.pathname,
      project: open ? { id: project.id, name: project.name, ...project.metadata } : null,
      playhead: open
        ? { frame: playback.currentFrame, seconds: round(playback.currentFrame / fpsOf(project)) }
        : null,
      playing: playback.isPlaying,
      sidebar_tab: useEditorStore.getState().activeTab,
      clips: open ? useItemsStore.getState().items.length : null,
      media: open ? useMediaLibraryStore.getState().mediaItems.length : null,
      engine: {
        cross_origin_isolated: window.crossOriginIsolated,
        webgpu: adapter !== null,
        webcodecs: typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
        user_agent: navigator.userAgent,
      },
    }
  })

  registerBridgeCommand('timeline_get', (args) => {
    takeArgs('timeline_get', args, [])
    return timeline()
  })

  registerBridgeCommand('timeline_edit', async (args) => {
    takeArgs('timeline_edit', args, ['ops', 'dry_run'])
    if (!Array.isArray(args.ops) || args.ops.length === 0)
      throw bridgeError('missing', { command: 'timeline_edit', field: 'ops' })
    const project = openProject()
    setEditCanvas({
      width: project.metadata?.width ?? 1920,
      height: project.metadata?.height ?? 1080,
      fps: fpsOf(project),
    })
    if (args.dry_run === true) {
      const rehearsal = rehearse(args.ops as EditOp[])
      return {
        dry_run: true,
        would_apply: rehearsal.wouldApply,
        error: rehearsal.error,
        results: rehearsal.results,
        timeline: rehearsal.timeline,
      }
    }
    if (await confirmsEdits()) {
      const rehearsal = rehearse(args.ops as EditOp[])
      const accepted = await useProposalStore.getState().ask({
        lines: describeOps(args.ops as EditOp[], fpsOf(project)),
        wouldApply: rehearsal.wouldApply,
        problem: rehearsal.error,
      })
      if (!accepted) throw bridgeError('declined')
    }
    await keepCheckpoint(project.id, 'agent', { edits: args.ops.length })
    let outcome
    try {
      outcome = applyEditOpsLive(args.ops as EditOp[])
    } catch (problem) {
      throw failed('timeline_edit', problem)
    }
    const applied = outcome.results.filter((result) => result.ok)
    if (applied.length > 0) await save(project.id)
    if (outcome.error) {
      throw failed(
        'timeline_edit',
        `${outcome.error}. The ${applied.length} op(s) before it were applied and saved: ${JSON.stringify(applied)}`,
      )
    }
    return { applied: applied.length, results: outcome.results, timeline: timeline() }
  })

  registerBridgeCommand('motion_render', async (args) => {
    takeArgs('motion_render', args, ['html', 'seconds', 'name'])
    openProject()
    const html = textArg('motion_render', args, 'html')
    if (!html) throw bridgeError('missing', { command: 'motion_render', field: 'html' })
    const seconds = numberArg('motion_render', args, 'seconds') ?? 4
    if (seconds < 0.5 || seconds > 30)
      throw bridgeError('bad_value', {
        command: 'motion_render',
        field: 'seconds',
        expected: 'from 0.5 to 30',
      })
    const name = textArg('motion_render', args, 'name') ?? motionName(html, 'HTML graphics')
    let mediaId
    try {
      mediaId = await makeMotionClip(html, seconds, name)
    } catch (problem) {
      throw failed('motion_render', problem)
    }
    await save(openProject().id)
    return { media_id: mediaId, name, timeline: timeline() }
  })

  registerBridgeCommand('previs_render', async (args) => {
    takeArgs('previs_render', args, [
      'scene',
      'description',
      'fresh',
      'output',
      'time_seconds',
      'name',
    ])
    openProject()
    const description = textArg('previs_render', args, 'description')
    const given = args.scene
    if (given === undefined && !description?.trim())
      throw bridgeError('missing', { command: 'previs_render', field: 'scene or description' })
    if (given !== undefined && description !== undefined)
      throw bridgeError('bad_value', {
        command: 'previs_render',
        field: 'scene',
        expected: 'either scene or description, not both',
      })
    const output = textArg('previs_render', args, 'output') ?? 'frame'
    if (output !== 'frame' && output !== 'video' && output !== 'scene')
      throw bridgeError('bad_value', {
        command: 'previs_render',
        field: 'output',
        expected: 'frame, video or scene',
      })
    const time = numberArg('previs_render', args, 'time_seconds') ?? 0
    try {
      const scene = await agentBlocking({
        scene: given,
        description,
        fresh: args.fresh === true,
        accept: (built) => {
          if (time < 0 || time > built.seconds)
            throw new Error(`time_seconds must be from 0 to ${built.seconds}`)
        },
      })
      useEditorStore.getState().setActiveTab('blocking')
      if (output === 'scene') return { scene }
      const name =
        textArg('previs_render', args, 'name') ??
        `${scene.title} (${output === 'frame' ? 'blocking frame' : 'blocking'})`
      const mediaId = await withPrevisRenderer(scene, (renderer) =>
        output === 'frame'
          ? importPrevisFrame(renderer, time, name)
          : importPrevisVideo(renderer, name),
      )
      return { media_id: mediaId, name, scene }
    } catch (problem) {
      throw failed('previs_render', problem)
    }
  })

  registerBridgeCommand('checkpoint_create', async (args) => {
    takeArgs('checkpoint_create', args, ['label'])
    const project = openProject()
    return keepCheckpoint(project.id, 'asked', {
      label: textArg('checkpoint_create', args, 'label'),
    })
  })

  registerBridgeCommand('checkpoint_restore', async (args) => {
    takeArgs('checkpoint_restore', args, ['id'])
    openProject()
    const id = textArg('checkpoint_restore', args, 'id')
    if (!id) throw bridgeError('missing', { command: 'checkpoint_restore', field: 'id' })
    try {
      await restoreCheckpoint(id)
    } catch (problem) {
      throw failed('checkpoint_restore', problem)
    }
    return { restored: id, timeline: timeline() }
  })

  registerBridgeCommand('timeline_undo', async (args) => {
    takeArgs('timeline_undo', args, [])
    const project = openProject()
    const commands = useTimelineCommandStore.getState()
    if (!commands.canUndo) throw bridgeError('nothing_to_undo')
    commands.undo()
    await save(project.id)
    return { text: 'Undone.' }
  })

  registerBridgeCommand('timeline_redo', async (args) => {
    takeArgs('timeline_redo', args, [])
    const project = openProject()
    const commands = useTimelineCommandStore.getState()
    if (!commands.canRedo) throw bridgeError('nothing_to_redo')
    commands.redo()
    await save(project.id)
    return { text: 'Redone.' }
  })

  registerBridgeCommand('media_list', (args) => {
    takeArgs('media_list', args, [])
    openProject()
    return {
      media: useMediaLibraryStore.getState().mediaItems.map((item) => ({
        id: item.id,
        file_name: item.fileName,
        mime: item.mimeType,
        duration_s: round(item.duration),
        width: item.width,
        height: item.height,
        size: item.fileSize,
        tags: item.tags,
      })),
    }
  })

  registerBridgeCommand('media_import', async (args) => {
    takeArgs('media_import', args, ['url'])
    const url = textArg('media_import', args, 'url')
    if (!url) throw bridgeError('missing', { command: 'media_import', field: 'url' })
    const project = openProject()
    try {
      // a file of this computer arrives as the service's own address, relative to this page
      const media = await mediaLibraryService.importMediaFromUrl(
        new URL(url, window.location.origin).href,
        project.id,
      )
      await useMediaLibraryStore.getState().loadMediaItems()
      return {
        media_id: media.id,
        file_name: media.fileName,
        mime: media.mimeType,
        duration_s: round(media.duration),
      }
    } catch (problem) {
      throw failed('media_import', problem)
    }
  })

  registerBridgeCommand('playhead_seek', (args) => {
    takeArgs('playhead_seek', args, ['seconds', 'frame'])
    const project = openProject()
    const frame =
      numberArg('playhead_seek', args, 'frame') ??
      Math.round((numberArg('playhead_seek', args, 'seconds') ?? 0) * fpsOf(project))
    usePlaybackStore.getState().setCurrentFrame(Math.max(0, Math.round(frame)))
    return { frame: usePlaybackStore.getState().currentFrame }
  })

  registerBridgeCommand('playback', (args) => {
    takeArgs('playback', args, ['action'])
    openProject()
    const action = textArg('playback', args, 'action')
    if (action === 'play') usePlaybackStore.getState().play()
    else if (action === 'pause') usePlaybackStore.getState().pause()
    else
      throw bridgeError('bad_value', {
        command: 'playback',
        field: 'action',
        expected: 'play or pause',
      })
    return { playing: usePlaybackStore.getState().isPlaying }
  })

  registerBridgeCommand('editor_tab', (args) => {
    takeArgs('editor_tab', args, ['tab'])
    const tab = textArg('editor_tab', args, 'tab') as EditorSidebarTab | undefined
    if (!tab || !TABS.includes(tab))
      throw bridgeError('bad_value', {
        command: 'editor_tab',
        field: 'tab',
        expected: TABS.join(', '),
      })
    openProject()
    useEditorStore.getState().setActiveTab(tab)
    return { tab }
  })

  registerBridgeCommand('export_video', async (args) => {
    takeArgs('export_video', args, ['format', 'quality', 'width', 'height', 'file_name'])
    const project = openProject()
    const format = (textArg('export_video', args, 'format') ?? 'mp4') as VideoContainer
    if (!['mp4', 'webm', 'mov', 'mkv'].includes(format)) {
      throw bridgeError('bad_value', {
        command: 'export_video',
        field: 'format',
        expected: 'mp4, webm, mov or mkv',
      })
    }
    const quality = (textArg('export_video', args, 'quality') ??
      'high') as ExtendedExportSettings['quality']
    if (!['low', 'medium', 'high', 'ultra'].includes(quality)) {
      throw bridgeError('bad_value', {
        command: 'export_video',
        field: 'quality',
        expected: 'low, medium, high or ultra',
      })
    }
    if (useItemsStore.getState().items.length === 0)
      throw failed('export_video', 'the timeline is empty')
    await save(project.id)
    const settings: ExtendedExportSettings = {
      mode: 'video',
      codec: format === 'webm' ? 'vp9' : 'h264',
      quality,
      resolution: {
        width: numberArg('export_video', args, 'width') ?? project.metadata?.width ?? 1920,
        height: numberArg('export_video', args, 'height') ?? project.metadata?.height ?? 1080,
      },
      videoContainer: format,
      renderWholeProject: true,
      subtitleMode: 'burn',
    }
    const fileName = textArg('export_video', args, 'file_name')
      ?.replace(/[<>:"/\\|?*]+/g, '_')
      .trim()
    let job
    try {
      job = await buildRenderJob({ settings, name: fileName || project.name })
    } catch (problem) {
      throw failed('export_video', problem)
    }
    if (fileName) job = { ...job, fileName: `${fileName}.${job.clientSettings.container}` }
    useRenderQueueStore.getState().enqueueJobs([job])
    const deadline = Date.now() + 3_500_000
    for (;;) {
      if (Date.now() > deadline)
        throw failed('export_video', 'the render did not finish within an hour')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const current = useRenderQueueStore.getState().jobs.find((each) => each.id === job.id)
      if (!current) throw failed('export_video', 'the render job left the queue')
      if (current.status === 'completed')
        return { saved: current.savedPath, size: current.fileSize }
      if (current.status === 'failed')
        throw failed('export_video', current.error ?? 'the render failed')
      if (current.status === 'cancelled') throw failed('export_video', 'the render was cancelled')
    }
  })

  registerBridgeCommand('project_open', async (args) => {
    takeArgs('project_open', args, ['project_id'])
    const id = textArg('project_open', args, 'project_id')
    try {
      await showProject(id || null)
    } catch (problem) {
      throw failed('project_open', problem)
    }
    for (
      let wait = 0;
      wait < 40 && id && useProjectStore.getState().currentProject?.id !== id;
      wait += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (id && useProjectStore.getState().currentProject?.id !== id)
      throw failed('project_open', `the editor did not open ${id}`)
    return { screen: window.location.pathname }
  })
}
