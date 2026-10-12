import { useEffect, useState } from 'react'

/**
 * Physical `KeyboardEvent.code` for a hotkey token whose printed character
 * varies by layout (letters, digits, and the punctuation caps on the ANSI
 * preview). Named keys (Tab, Enter, arrows…) print the same everywhere, so
 * they return `null` and keep their static label.
 */
const CODE_FOR_PUNCTUATION_TOKEN: Record<string, string> = {
  backquote: 'Backquote',
  minus: 'Minus',
  equal: 'Equal',
  bracketleft: 'BracketLeft',
  bracketright: 'BracketRight',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
}

function codeForToken(token: string): string | null {
  if (/^[a-z]$/.test(token)) return `Key${token.toUpperCase()}`
  if (/^[0-9]$/.test(token)) return `Digit${token}`
  return CODE_FOR_PUNCTUATION_TOKEN[token] ?? null
}

interface KeyboardLayoutApi {
  getLayoutMap?: () => Promise<Map<string, string>>
}

export interface KeyboardLayoutLabels {
  /**
   * Localized character printed on the physical key that produces `token`, or
   * `null` when the layout is unknown or the token isn't a character key —
   * callers fall back to the US label in that case.
   */
  labelForToken: (token: string) => string | null
  /** True once the browser reported a real per-key layout map. */
  isNativeLayout: boolean
}

/**
 * Reads the user's physical keyboard layout via the Keyboard Map API so the
 * on-screen keyboard prints the characters actually under their fingers
 * (AZERTY, QWERTZ, Dvorak…). Capture is physical-`code` based, so the
 * highlighted key stays correct regardless of layout — this only fixes the
 * *labels*. Chromium-only; elsewhere `isNativeLayout` stays false and the UI
 * shows a US-layout disclaimer.
 */
export function useKeyboardLayoutLabels(): KeyboardLayoutLabels {
  const [layoutMap, setLayoutMap] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLayoutApi }).keyboard
    if (!keyboard?.getLayoutMap) {
      return
    }

    let cancelled = false
    keyboard
      .getLayoutMap()
      .then((map) => {
        if (!cancelled) setLayoutMap(map)
      })
      .catch(() => {
        // Layout unavailable (permission policy, non-secure context) — keep US labels.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    isNativeLayout: layoutMap !== null,
    labelForToken: (token) => {
      if (!layoutMap) return null
      const code = codeForToken(token)
      if (!code) return null
      const label = layoutMap.get(code)
      if (!label) return null
      return label.length === 1 ? label.toUpperCase() : label
    },
  }
}
