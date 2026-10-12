/**
 * The Anime4K network ships three weight sets trained on different kinds of footage. They share an
 * architecture and a cost — picking one is purely a statement about the source material.
 *
 * `animation` carries the original Anime4K weights and is what the network was designed for.
 * `liveAction` and `threeD` were retrained by the WebSR author; on photographic content all three
 * land within 0.05 dB of one another, so the choice matters far less than the name suggests.
 */
export const UPSCALE_VARIANTS = ['liveAction', 'animation', 'threeD'] as const

export type UpscaleVariant = (typeof UPSCALE_VARIANTS)[number]

/** The only factor this network implements. It is a 2x pixel shuffle; there is no 4x variant. */
export const UPSCALE_FACTOR = 2
