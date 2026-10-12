import { ProviderRegistry } from '@/shared/utils/provider-registry'
import { lfmCaptioningProvider } from './lfm-captioning-provider'
import type { MediaCaptioningProvider } from './types'

const DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID = lfmCaptioningProvider.id

const mediaCaptioningProviderRegistry = new ProviderRegistry<MediaCaptioningProvider>(
  [lfmCaptioningProvider],
  DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID,
)

export function getDefaultMediaCaptioningProvider(): MediaCaptioningProvider {
  return mediaCaptioningProviderRegistry.getDefault()
}
