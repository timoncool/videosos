import { describe, expect, it } from 'vitest'
import { buildFcpxml, type FcpxmlInput } from './fcpxml'
import type { TimelineItem } from '@/types/timeline'

const item = (fields: Record<string, unknown>) =>
  ({ label: 'clip', ...fields }) as unknown as TimelineItem

const input: FcpxmlInput = {
  name: 'Trip & co',
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [
    { id: 'empty', kind: 'video', order: -5 },
    { id: 'v2', kind: 'video', order: -1 },
    { id: 'v1', kind: 'video', order: 0 },
    { id: 'a1', kind: 'audio', order: 1 },
  ],
  items: [
    item({
      id: 'v',
      type: 'video',
      trackId: 'v1',
      from: 30,
      durationInFrames: 90,
      mediaId: 'm1',
      sourceStart: 48,
      sourceFps: 24,
      linkedGroupId: 'g',
      label: 'shot.mp4',
    }),
    item({
      id: 'va',
      type: 'audio',
      trackId: 'a1',
      from: 30,
      durationInFrames: 90,
      mediaId: 'm1',
      linkedGroupId: 'g',
    }),
    item({
      id: 'i',
      type: 'image',
      trackId: 'v2',
      from: 0,
      durationInFrames: 60,
      mediaId: 'm2',
      label: 'still.png',
    }),
    item({
      id: 't',
      type: 'text',
      trackId: 'v2',
      from: 60,
      durationInFrames: 30,
      text: 'Hello <world>',
    }),
    item({ id: 's', type: 'shape', trackId: 'v2', from: 0, durationInFrames: 30, label: 'Box' }),
    item({
      id: 'f',
      type: 'video',
      trackId: 'v1',
      from: 200,
      durationInFrames: 30,
      mediaId: 'm1',
      speed: 2,
      label: 'fast.mp4',
    }),
  ],
  media: {
    m1: {
      fileName: 'shot.mp4',
      mimeType: 'video/mp4',
      duration: 10,
      audioCodec: 'aac',
      path: 'D:\\Work space\\media\\m1\\shot.mp4',
    },
    m2: {
      fileName: 'still.png',
      mimeType: 'image/png',
      duration: 0,
      path: '/home/me/media/m2/still.png',
    },
  },
}

describe('FCPXML of a timeline', () => {
  const { xml, left } = buildFcpxml(input)

  it('places each clip at its frame on its track lane, with the source start in the sequence frames', () => {
    expect(xml).toContain('<format id="r1" frameDuration="1/30s" width="1920" height="1080"/>')
    expect(xml).toContain(
      '<asset-clip ref="r3" lane="1" offset="30/30s" duration="90/30s" name="shot.mp4" start="60/30s"></asset-clip>',
    )
    expect(xml).toContain(
      '<video ref="r2" lane="2" offset="0s" duration="60/30s" name="still.png" start="0s"></video>',
    )
    expect(xml).toContain('<gap name="Trip &amp; co" offset="0s" start="0s" duration="120/30s">')
  })

  it('references the files where they lie, as file URLs', () => {
    expect(xml).toContain('src="file:///D:/Work%20space/media/m1/shot.mp4"')
    expect(xml).toContain('src="file:///home/me/media/m2/still.png"')
    expect(xml).toContain('hasVideo="1" format="r1" hasAudio="1"')
  })

  it('writes a title for text and keeps the linked sound with its video', () => {
    expect(xml).toContain('<effect id="r4" name="Basic Title"')
    expect(xml).toContain('Hello &lt;world&gt;')
    expect(xml.match(/<asset-clip /g)).toHaveLength(1)
  })

  it('says what it does not carry', () => {
    expect(left).toEqual([
      { label: 'Box', reason: 'kind' },
      { label: 'fast.mp4', reason: 'speed' },
    ])
  })
})

describe('FCPXML of a mixed edit', () => {
  const { xml, left } = buildFcpxml({
    ...input,
    tracks: [
      { id: 'v1', kind: 'video', order: 0 },
      { id: 'v2', kind: 'video', order: -1, visible: false },
      { id: 'a1', kind: 'audio', order: 1, volume: -6 },
      { id: 'a2', kind: 'audio', order: 2, volume: -14 },
    ],
    items: [
      item({
        id: 'v',
        type: 'video',
        trackId: 'v1',
        from: 0,
        durationInFrames: 90,
        mediaId: 'm1',
        linkedGroupId: 'g',
        label: 'a.mp4',
        fadeOut: 1,
      }),
      item({
        id: 'va',
        type: 'audio',
        trackId: 'a1',
        from: 0,
        durationInFrames: 90,
        mediaId: 'm1',
        linkedGroupId: 'g',
        volume: 2,
        audioFadeOut: 0.5,
      }),
      item({
        id: 'w',
        type: 'video',
        trackId: 'v1',
        from: 90,
        durationInFrames: 60,
        mediaId: 'm1',
        label: 'b.mp4',
      }),
      item({
        id: 'm',
        type: 'audio',
        trackId: 'a2',
        from: 0,
        durationInFrames: 150,
        mediaId: 'm3',
        label: 'music.mp3',
        audioFadeIn: 1,
      }),
      item({
        id: 'h',
        type: 'image',
        trackId: 'v2',
        from: 0,
        durationInFrames: 30,
        mediaId: 'm2',
        label: 'hidden.png',
      }),
    ],
    media: {
      ...input.media,
      m3: { fileName: 'music.mp3', mimeType: 'audio/mpeg', duration: 20, path: 'D:\\m\\music.mp3' },
    },
    markers: [
      { frame: 60, name: 'Boat <sails>' },
      { frame: 400, name: 'Past the end' },
    ],
    transitions: [{ leftClipId: 'v', rightClipId: 'w' }],
  })

  it("gives a video the gain and fades of its linked sound on that sound's track, and its picture fades", () => {
    expect(xml).toContain(
      '<adjust-blend amount="1"><param name="amount"><fadeOut type="linear" duration="30/30s"/></param></adjust-blend>' +
        '<adjust-volume amount="-4dB"><param name="amount"><fadeOut type="linear" duration="15/30s"/></param></adjust-volume>',
    )
  })

  it('carries a music clip with its track gain and fade in, and a video without its sound silent', () => {
    expect(xml).toContain(
      '<adjust-volume amount="-14dB"><param name="amount"><fadeIn type="linear" duration="30/30s"/></param></adjust-volume>',
    )
    expect(xml).toContain('name="b.mp4" start="0s"><adjust-volume amount="-96dB"/></asset-clip>')
  })

  it('switches off a clip of a hidden track and writes the markers within the edit', () => {
    expect(xml).toContain('name="hidden.png" enabled="0"')
    expect(xml).toContain(
      '<marker start="60/30s" duration="1/30s" value="Boat &lt;sails&gt;"/></gap>',
    )
    expect(xml).not.toContain('Past the end')
  })

  it('names the transitions it cannot carry', () => {
    expect(left).toEqual([{ label: 'a.mp4 → b.mp4', reason: 'transition' }])
  })
})
