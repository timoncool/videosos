/**
 * Shared JSON coercion for WASM-free Lottie inspectors (`lottie-color`,
 * `lottie-slots`, `lottie-text`). Accepts an already-parsed animation object
 * or a raw `.json` string and normalizes it to a record, or null when the
 * input is neither.
 */
export function parseLottieJsonObject(json: unknown): Record<string, unknown> | null {
  if (typeof json === 'string') {
    try {
      return JSON.parse(json) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
}
