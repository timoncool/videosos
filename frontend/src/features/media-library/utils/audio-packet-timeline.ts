/**
 * Structural view of the parts of mediabunny's `EncodedPacket` this module needs, so the rule
 * can be tested without constructing a real packet.
 */
export interface TimedPacket<Self> {
  readonly timestamp: number
  readonly duration: number
  clone(options: { timestamp: number; duration: number }): Self
}

/**
 * Fit an encoded audio packet onto a timeline that starts at zero.
 *
 * AAC and Opus carry encoder priming: the first packets sit at negative timestamps (for AAC,
 * one 1024-sample frame — -23.2ms at 44.1kHz). Muxers reject negative timestamps outright.
 * Priming is decoder warm-up rather than audible content, so a packet that ends at or before
 * zero is dropped, and a packet straddling zero is trimmed to start there.
 *
 * @returns the packet to mux, or null if it lies entirely before the timeline.
 */
export function clampPacketToTimeline<T extends TimedPacket<T>>(packet: T): T | null {
  const end = packet.timestamp + packet.duration
  if (end <= 0) return null
  if (packet.timestamp >= 0) return packet
  return packet.clone({ timestamp: 0, duration: end })
}
