// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { shouldRenderExternalVideoAudio } from './audio-playback-routing'

describe('shouldRenderExternalVideoAudio', () => {
  it('routes an ordinary nested video to decoded audio during reverse shuttle', () => {
    expect(
      shouldRenderExternalVideoAudio({
        muted: false,
        hasAudioSource: true,
        authoredReversed: false,
        reverseShuttle: true,
        requiresPitchShift: false,
        requiresCustomDecoder: false,
      }),
    ).toBe(true)
  })

  it('preserves native forward audio and respects compound mute ownership', () => {
    expect(
      shouldRenderExternalVideoAudio({
        muted: false,
        hasAudioSource: true,
        authoredReversed: false,
        reverseShuttle: false,
        requiresPitchShift: false,
        requiresCustomDecoder: false,
      }),
    ).toBe(false)
    expect(
      shouldRenderExternalVideoAudio({
        muted: true,
        hasAudioSource: true,
        authoredReversed: false,
        reverseShuttle: true,
        requiresPitchShift: false,
        requiresCustomDecoder: false,
      }),
    ).toBe(false)
  })
})
