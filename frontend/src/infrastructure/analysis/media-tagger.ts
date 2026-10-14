/**
 * Media captioning facade.
 *
 * Consumers keep using `captionVideo` / `captionImage`, while the underlying
 * model-specific implementation is resolved through the captioning provider
 * registry. That lets us swap captioning models without changing call sites.
 */

import { getDefaultMediaCaptioningProvider } from './captioning/registry'
import type { CaptioningOptions, MediaCaption } from './captioning/types'

export type { MediaCaption }

export async function captionVideo(
  video: HTMLVideoElement,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  return getDefaultMediaCaptioningProvider().captionVideo(video, options)
}

/** Who writes the captions now: the provider's id and its model, recorded with each caption set. */
export function captioningSource(): { service: string; model: string } {
  const provider = getDefaultMediaCaptioningProvider()
  return { service: provider.id, model: provider.model }
}

export async function captionImage(
  imageBlob: Blob,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  return getDefaultMediaCaptioningProvider().captionImage(imageBlob, options)
}
