/**
 * The timeline as FCPXML 1.11, the interchange Final Cut Pro, DaVinci Resolve and Premiere read, as Descript and
 * the competitors hand an edit over to a finishing editor. Every clip is a connected clip of one gap that spans
 * the timeline, on a lane of its track (video tracks above, audio below), so each keeps its exact place without
 * rebuilding a primary storyline. Media is referenced where it lies in the workspace, not copied.
 */

import type { TimelineItem } from '@/types/timeline'

export interface FcpxmlTrack {
  id: string
  kind?: 'video' | 'audio'
  order: number
  isGroup?: boolean
}

export interface FcpxmlMedia {
  fileName: string
  mimeType: string
  /** Seconds; 0 for a still. */
  duration: number
  audioCodec?: string
  /** The file on this computer; null when it is not in the workspace. */
  path: string | null
}

export interface FcpxmlInput {
  name: string
  width: number
  height: number
  fps: number
  tracks: FcpxmlTrack[]
  items: TimelineItem[]
  media: Record<string, FcpxmlMedia>
}

export interface FcpxmlResult {
  xml: string
  /** Items the file does not carry, by label, with why. */
  left: Array<{ label: string; reason: 'kind' | 'file' | 'speed' }>
}

const TITLE_EFFECT = '.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti'

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The frame's length as FCPXML writes it: 1/30s, or 1001/30000s for 29.97. */
function frameDuration(fps: number): { numerator: number; denominator: number } {
  if (Number.isInteger(fps)) return { numerator: 1, denominator: fps }
  const rounded = Math.round(fps)
  return { numerator: 1001, denominator: rounded * 1000 }
}

function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const absolute = slashed.startsWith('/') ? slashed : `/${slashed}`
  return `file://${absolute.split('/').map((part, index) => (index === 1 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))).join('/')}`
}

export function buildFcpxml(input: FcpxmlInput): FcpxmlResult {
  const frame = frameDuration(input.fps)
  const time = (frames: number) => (frames === 0 ? '0s' : `${Math.round(frames) * frame.numerator}/${frame.denominator}s`)
  const framesOf = (seconds: number) => Math.round((seconds * frame.denominator) / frame.numerator)

  // lanes count only the tracks that hold something, so empty tracks leave no empty lanes
  const used = new Set(input.items.map((item) => item.trackId))
  const lanes = new Map<string, number>()
  const tracks = input.tracks.filter((track) => !track.isGroup && used.has(track.id)).sort((a, b) => a.order - b.order)
  const video = tracks.filter((track) => (track.kind ?? 'video') === 'video')
  const audio = tracks.filter((track) => track.kind === 'audio')
  video.forEach((track, index) => lanes.set(track.id, video.length - index))
  audio.forEach((track, index) => lanes.set(track.id, -(index + 1)))

  const left: FcpxmlResult['left'] = []
  const assets = new Map<string, string>()
  const resources: string[] = [
    `<format id="r1" frameDuration="${frame.numerator}/${frame.denominator}s" width="${input.width}" height="${input.height}"/>`,
  ]
  const assetId = (mediaId: string, media: FcpxmlMedia): string => {
    const known = assets.get(mediaId)
    if (known) return known
    const id = `r${resources.length + 1}`
    const still = media.mimeType.startsWith('image/')
    const hasVideo = still || media.mimeType.startsWith('video/')
    const hasAudio = media.mimeType.startsWith('audio/') || (media.mimeType.startsWith('video/') && !!media.audioCodec)
    resources.push(
      `<asset id="${id}" name="${escape(media.fileName)}" start="0s" duration="${still ? '0s' : time(framesOf(media.duration))}"${hasVideo ? ` hasVideo="1" format="r1"` : ''}${hasAudio ? ' hasAudio="1" audioSources="1"' : ''}>` +
        `<media-rep kind="original-media" src="${escape(fileUrl(media.path!))}"/></asset>`,
    )
    assets.set(mediaId, id)
    return id
  }

  // a video's sound comes with its clip; the linked audio item the editor splits off is not a clip of its own
  const linkedAudio = new Set(
    input.items
      .filter((item) => item.type === 'audio' && item.linkedGroupId && input.items.some((other) => other.type === 'video' && other.linkedGroupId === item.linkedGroupId))
      .map((item) => item.id),
  )
  const videoWithSound = new Set(
    input.items.filter((item) => item.type === 'video' && item.linkedGroupId && input.items.some((other) => linkedAudio.has(other.id) && other.linkedGroupId === item.linkedGroupId)).map((item) => item.id),
  )

  let titleEffect: string | null = null
  const clips: string[] = []
  let end = 0
  for (const item of [...input.items].sort((a, b) => a.from - b.from)) {
    if (linkedAudio.has(item.id)) continue
    const lane = lanes.get(item.trackId)
    if (lane === undefined) continue
    const label = item.label || item.type
    const common = `lane="${lane}" offset="${time(item.from)}" duration="${time(item.durationInFrames)}" name="${escape(label)}"`
    if (item.type === 'video' || item.type === 'audio' || item.type === 'image') {
      const media = item.mediaId ? input.media[item.mediaId] : undefined
      if (!media?.path) {
        left.push({ label, reason: 'file' })
        continue
      }
      if ((item.speed ?? 1) !== 1) {
        left.push({ label, reason: 'speed' })
        continue
      }
      const ref = assetId(item.mediaId!, media)
      if (item.type === 'image') {
        clips.push(`<video ref="${ref}" ${common} start="0s"/>`)
      } else {
        const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : input.fps
        const start = time(framesOf((item.sourceStart ?? 0) / sourceFps))
        const silent = item.type === 'video' && media.audioCodec && !videoWithSound.has(item.id) ? '<adjust-volume amount="-96dB"/>' : ''
        clips.push(`<asset-clip ref="${ref}" ${common} start="${start}">${silent}</asset-clip>`)
      }
    } else if (item.type === 'text') {
      if (!titleEffect) {
        titleEffect = `r${resources.length + 1}`
        resources.push(`<effect id="${titleEffect}" name="Basic Title" uid="${TITLE_EFFECT}"/>`)
      }
      const style = `ts${clips.length + 1}`
      clips.push(
        `<title ref="${titleEffect}" ${common} start="0s"><text><text-style ref="${style}">${escape(item.text ?? '')}</text-style></text>` +
          `<text-style-def id="${style}"><text-style font="Helvetica" fontSize="63" fontColor="1 1 1 1" alignment="center"/></text-style-def></title>`,
      )
    } else {
      left.push({ label, reason: 'kind' })
      continue
    }
    end = Math.max(end, item.from + item.durationInFrames)
  }

  const duration = time(end)
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.11">',
    `<resources>${resources.join('')}</resources>`,
    `<library><event name="VideoSOS"><project name="${escape(input.name)}">`,
    `<sequence format="r1" duration="${duration}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `<spine><gap name="${escape(input.name)}" offset="0s" start="0s" duration="${duration}">${clips.join('')}</gap></spine>`,
    '</sequence></project></event></library>',
    '</fcpxml>',
    '',
  ].join('\n')
  return { xml, left }
}
