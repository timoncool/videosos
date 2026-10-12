export function shouldRenderExternalVideoAudio(options: {
  muted: boolean
  hasAudioSource: boolean
  authoredReversed: boolean
  reverseShuttle: boolean
  requiresPitchShift: boolean
  requiresCustomDecoder: boolean
}): boolean {
  return (
    !options.muted &&
    options.hasAudioSource &&
    (options.authoredReversed ||
      options.reverseShuttle ||
      options.requiresPitchShift ||
      options.requiresCustomDecoder)
  )
}
