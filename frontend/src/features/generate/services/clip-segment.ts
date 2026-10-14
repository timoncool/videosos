/**
 * The part of a clip's source file the timeline shows, cut in the window (WebCodecs through mediabunny), as a
 * video a provider takes. The picture is encoded again, so the cut starts on the clip's own first frame rather
 * than on the key frame before it; the sound is copied.
 */
export async function cutSegment(file: Blob, start: number, end: number): Promise<Blob> {
  const { Input, BlobSource, Output, Mp4OutputFormat, BufferTarget, Conversion, ALL_FORMATS } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start, end },
    video: { codec: 'avc', forceTranscode: true },
  })
  if (!conversion.isValid) {
    throw new Error(conversion.discardedTracks.map((each) => `${each.track.type}: ${each.reason}`).join('; ') || 'no track to cut')
  }
  await conversion.execute()
  if (!target.buffer) throw new Error('the cut came out empty')
  return new Blob([target.buffer], { type: 'video/mp4' })
}
