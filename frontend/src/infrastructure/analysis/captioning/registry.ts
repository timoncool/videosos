import { ProviderRegistry } from '@/shared/utils/provider-registry'
import { gemmaCaptioningProvider } from './gemma-captioning-provider'
import type { MediaCaptioningProvider } from './types'

const DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID = gemmaCaptioningProvider.id

const mediaCaptioningProviderRegistry = new ProviderRegistry<MediaCaptioningProvider>(
  [gemmaCaptioningProvider],
  DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID,
)

export function getDefaultMediaCaptioningProvider(): MediaCaptioningProvider {
  return mediaCaptioningProviderRegistry.getDefault()
}
