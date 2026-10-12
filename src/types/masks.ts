/** Bezier mask vertex (normalized 0-1 relative to item bounds) */
export interface MaskVertex {
  position: [number, number]
  inHandle: [number, number]
  outHandle: [number, number]
  /** How handle edits affect the opposite tangent. Legacy vertices infer this from their handles. */
  tangentMode?: 'corner' | 'smooth' | 'continuous' | 'broken'
}
