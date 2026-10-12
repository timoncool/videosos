// Shared headless render core used by the render CLI (render.mjs) and the
// render service (serve.mjs): settings, range, media resolution, the
// harness/media servers, and the per-page render call.
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import {
  loadProject,
  collectMediaIds,
  resolveMediaFiles,
  resolveMediaFile,
  readMediaMetadata,
} from './workspace.mjs'
import { createMediaServer } from '../media-server.mjs'
import { createHarnessServer } from '../server.mjs'
import { normalizeRenderInput, renderRequestSchema, validate } from './contract.mjs'
import { HttpError } from './http-security.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const CODEC_MAP = {
  h264: 'avc',
  avc: 'avc',
  h265: 'hevc',
  hevc: 'hevc',
  vp9: 'vp9',
  vp8: 'vp8',
  av1: 'av1',
}
const DEFAULT_CONTAINER = { avc: 'mp4', hevc: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'webm' }
const VIDEO_BITRATE_BY_QUALITY = {
  low: 2_500_000,
  medium: 5_000_000,
  high: 10_000_000,
  ultra: 20_000_000,
}

/** Build ClientExportSettings from a job's options (same keys as the CLI flags). */
const AUDIO_CODEC_BY_CONTAINER = { mp3: 'mp3', wav: 'pcm-s16' }

/** Effective frame size: project metadata unless --resolution overrides it. */
function resolveFrameSize(meta, resolution) {
  if (!resolution) return { width: meta.width ?? 1920, height: meta.height ?? 1080 }
  const match = /^(\d+)x(\d+)$/.exec(resolution)
  if (!match) throw new Error(`Invalid resolution "${resolution}" (expected WxH, e.g. 1920x1080)`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

function assertRenderableFormat(fps, width, height) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 240)
    throw new Error('Effective fps must be between 1 and 240')
  if (![width, height].every((value) => Number.isInteger(value) && value >= 16 && value <= 16384)) {
    throw new Error('Effective resolution dimensions must be integers between 16 and 16384')
  }
}

function buildAudioOnlySettings({ container = 'mp3', quality, width, height, fps }) {
  return {
    mode: 'audio',
    codec: 'avc',
    audioCodec: AUDIO_CODEC_BY_CONTAINER[container] ?? 'aac',
    container,
    quality,
    resolution: { width, height },
    fps,
    audioBitrate: 192_000,
  }
}

function buildVideoSettings({ codecInput, codecOption, container, quality, width, height, fps }) {
  const codec = CODEC_MAP[codecInput]
  if (!codec) throw new Error(`Unknown codec "${codecOption}" (use h264|h265|vp9|vp8|av1)`)
  const effectiveContainer = container ?? DEFAULT_CONTAINER[codec]
  return {
    mode: 'video',
    codec,
    audioCodec: effectiveContainer === 'webm' ? 'opus' : 'aac',
    container: effectiveContainer,
    quality,
    resolution: { width, height },
    fps,
    videoBitrate: VIDEO_BITRATE_BY_QUALITY[quality] ?? 10_000_000,
    audioBitrate: 192_000,
  }
}

function buildSettings(project, opts) {
  const meta = project.metadata ?? {}
  const fps = opts.fps ? Number(opts.fps) : (meta.fps ?? 30)
  const { width, height } = resolveFrameSize(meta, opts.resolution)
  assertRenderableFormat(fps, width, height)
  const common = { quality: opts.quality ?? 'high', width, height, fps }
  return opts.audioOnly
    ? buildAudioOnlySettings({ container: opts.container, ...common })
    : buildVideoSettings({
        codecInput: (opts.codec ?? 'h264').toLowerCase(),
        codecOption: opts.codec,
        container: opts.container,
        ...common,
      })
}

/** Compute the render range (frames) from a job's in/out-sec/duration (seconds). */
function computeRange(opts, fps) {
  const inV = opts.inSec
  const outV = opts.outSec
  const hasRange = inV !== undefined || outV !== undefined || opts.duration !== undefined
  if (!hasRange) return { hasRange: false, inPoint: null, outPoint: null }
  const inSec = inV !== undefined ? Number(inV) : 0
  const outSec =
    outV !== undefined
      ? Number(outV)
      : opts.duration !== undefined
        ? inSec + Number(opts.duration)
        : undefined
  return {
    hasRange: true,
    inPoint: Math.round(inSec * fps),
    outPoint: outSec !== undefined ? Math.round(outSec * fps) : null,
  }
}

async function ensureHarnessReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (res.ok) return
  } catch {
    // fall through
  }
  throw new Error(`Dev harness not reachable at ${url}. Start it with: npm run dev`)
}

/**
 * Start the harness + media servers (media resolved dynamically from the
 * workspace). Default: standalone server over built dist/. devUrl: drive a
 * running Vite dev server + cross-origin media server. Omit `workspace` for the
 * edit path (no rendering): no media server is started and `mediaUrlOf` is a
 * no-op.
 */
export async function startHarness({ workspace, devUrl, build, resolveAdditionalMedia }) {
  const resolveMedia = workspace
    ? (mediaId) => resolveAdditionalMedia?.(mediaId) ?? resolveMediaFile(workspace, mediaId)
    : undefined
  if (devUrl) {
    await ensureHarnessReachable(devUrl)
    if (!resolveMedia)
      return { harnessUrl: devUrl, mediaUrlOf: () => undefined, closeServers: async () => {} }
    const mediaServer = await createMediaServer(resolveMedia)
    return {
      harnessUrl: devUrl,
      mediaUrlOf: (id) => mediaServer.url(id),
      closeServers: () => mediaServer.close(),
    }
  }
  const distDir = path.join(REPO_ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    if (build) {
      execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
    } else {
      throw new Error(
        'Harness not built: dist/headless.html is missing. Run `npm run build` (or pass build:true / --build).',
      )
    }
  }
  const server = await createHarnessServer({ distDir, resolveMedia })
  return {
    harnessUrl: server.harnessUrl,
    mediaUrlOf: (id) => server.mediaUrl(id),
    closeServers: () => server.close(),
  }
}

/**
 * Resolve the media a project references to `{ mediaId, url, metadata }` entries
 * the harness can consume. `range` ({ inFrame, outFrame }) limits collection to
 * media overlapping a slice; pass null for the whole project. Shared by the
 * render, frame-grab, and layout-dump paths (no browser involved).
 */
export function resolveProjectMedia(workspace, project, mediaUrlOf, range = null) {
  const mediaIds = collectMediaIds(project, range)
  const { files, missing } = resolveMediaFiles(workspace, mediaIds)
  const media = [...files.keys()].map((id) => ({
    mediaId: id,
    url: mediaUrlOf(id),
    metadata: readMediaMetadata(workspace, id) ?? undefined,
  }))
  return { media, missing, mediaResolved: files.size, mediaTotal: mediaIds.length }
}

/** Load a project from a job's `project` id/path or inline `projectObject`. */
export function loadJobProject(workspace, jobArgs) {
  if (!jobArgs.project && !jobArgs.projectObject) throw new Error('Job missing "project"')
  return jobArgs.projectObject
    ? { project: jobArgs.projectObject, projectJsonPath: '(inline)' }
    : loadProject(workspace, jobArgs.project)
}

/** Resolve everything needed to render one job (no browser involved). */
export function prepareJob(workspace, jobArgs, mediaUrlOf) {
  jobArgs = validate(renderRequestSchema, normalizeRenderInput(jobArgs))
  const { project, projectJsonPath } = loadJobProject(workspace, jobArgs)
  const settings = buildSettings(project, jobArgs)
  const { hasRange, inPoint, outPoint } = computeRange(jobArgs, settings.fps)

  const range = hasRange
    ? { inFrame: inPoint ?? 0, outFrame: outPoint ?? Number.POSITIVE_INFINITY }
    : null
  const { media, missing, mediaResolved, mediaTotal } = resolveProjectMedia(
    workspace,
    project,
    mediaUrlOf,
    range,
  )

  const outName = `${(project.name ?? 'freecut-export').replace(/[^\w.-]+/g, '_')}.${settings.container}`
  const outPath = path.resolve(jobArgs.out ?? path.join('headless', 'output', outName))

  return {
    project,
    projectJsonPath,
    settings,
    hasRange,
    inPoint,
    outPoint,
    media,
    missing,
    mediaResolved,
    mediaTotal,
    outPath,
    strict: jobArgs.strict === true,
  }
}

export class MissingMediaError extends Error {
  constructor(mediaIds) {
    super(`Referenced media source(s) not found on disk: ${mediaIds.join(', ')}`)
    this.name = 'MissingMediaError'
    this.code = 'MISSING_MEDIA'
    this.mediaIds = mediaIds
  }
}

class HardwareGpuRequiredError extends HttpError {
  constructor() {
    super(
      422,
      'HARDWARE_GPU_REQUIRED',
      'This project uses GPU effects, but the active WebGPU adapter is software-only. ' +
        'Run on a native Linux host with NVIDIA Vulkan support or render natively.',
    )
    this.name = 'HardwareGpuRequiredError'
  }
}

function projectUsesGpuEffects(project) {
  const timeline = project?.timeline
  if (!timeline) return false
  const timelines = [timeline, ...(timeline.compositions ?? [])]
  return timelines.some((entry) =>
    (entry.items ?? []).some((item) => item.effects?.some((effect) => effect.enabled)),
  )
}

export function assertHardwareGpuForJob(job, softwareGpu) {
  if (softwareGpu && projectUsesGpuEffects(job.project)) {
    throw new HardwareGpuRequiredError()
  }
}

export function outputPathForContainer(requestedPath, container) {
  const extension = path.extname(requestedPath)
  return `${extension ? requestedPath.slice(0, -extension.length) : requestedPath}.${container}`
}

function warningMessage(warning) {
  return typeof warning === 'string' ? warning : warning.message
}

export function warningsHeaderValue(warnings) {
  return JSON.stringify(warnings).replace(/[^\t\x20-\x7E]/g, ' ')
}

/** Render one prepared job through an already-loaded harness page; saves to job.outPath. */
export async function renderJob(
  page,
  job,
  {
    setProgressLabel,
    onWarn,
    allowMissingMedia = false,
    softwareGpu = false,
    downloadTimeoutMs = 30 * 60_000,
  } = {},
) {
  const warn = onWarn ?? ((m) => console.warn(m))
  assertHardwareGpuForJob(job, softwareGpu)
  if (job.missing.length > 0) {
    if (!allowMissingMedia) throw new MissingMediaError(job.missing)
  }
  const preparationWarnings = []
  if (job.missing.length > 0)
    preparationWarnings.push({
      code: 'MISSING_MEDIA',
      message: `${job.missing.length} media source(s) not found on disk: ${job.missing.join(', ')}`,
      details: { mediaIds: job.missing },
    })
  // audioCodecSupported=false on media WITHOUT any audio track is a metadata
  // authoring bug (seen with external registration scripts) — only warn when
  // there is an actual audio track that can't be decoded.
  const unsupportedAudio = job.media.filter(
    (m) => m.metadata?.audioCodecSupported === false && m.metadata?.audioCodec,
  )
  if (unsupportedAudio.length > 0) {
    const list = unsupportedAudio
      .map((m) => `${m.metadata.fileName ?? m.mediaId} (${m.metadata.audioCodec ?? 'unknown'})`)
      .join(', ')
    preparationWarnings.push({
      code: 'UNSUPPORTED_AUDIO',
      message: `Audio may be silent (codec not decodable headlessly): ${list}`,
      details: {
        media: unsupportedAudio.map((m) => ({
          mediaId: m.mediaId,
          fileName: m.metadata.fileName,
          audioCodec: m.metadata.audioCodec ?? 'unknown',
        })),
      },
    })
  }

  setProgressLabel?.(path.basename(job.outPath))
  const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeoutMs })
  downloadPromise.catch(() => {})
  const summary = await page.evaluate((payload) => window.freecut.renderProject(payload), {
    project: job.project,
    settings: job.settings,
    media: job.media,
    renderWholeProject: !job.hasRange,
    inPoint: job.inPoint,
    outPoint: job.outPoint,
    strict: job.strict,
  })
  const download = await downloadPromise
  const effectiveContainer = summary.effectiveSettings?.container
  if (!effectiveContainer) throw new Error('Render summary omitted effectiveSettings.container')
  const outputPath = outputPathForContainer(job.outPath, effectiveContainer)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  await download.saveAs(outputPath)
  const warnings = [...preparationWarnings, ...(summary.warnings ?? [])]
  for (const warning of warnings)
    warn(`  WARNING [${warning.code ?? 'UNKNOWN'}]: ${warningMessage(warning)}`)
  return { ...summary, fileName: path.basename(outputPath), outputPath, warnings }
}
