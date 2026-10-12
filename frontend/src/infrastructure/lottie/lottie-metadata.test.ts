// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  parseLottieMetadata,
  parseLottieFileBytes,
  extractLottieAnimation,
  extractLottieManifest,
  extractLottieThemeData,
  readLottieMarkers,
} from './lottie-metadata'

// A `.lottie` archive with an image asset (images/img.png = bytes 0x89 'PNG' …),
// pre-built with fflate in Node (see parseLottieFileBytes fixtures note).
const IMAGE_ARCHIVE_B64 =
  'UEsDBBQAAAAIAFCr5lzzzTiqHQAAABsAAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayiq5WykxRslJKVKqNrQUAUEsDBBQAAAAIAFCr5lw9+VcAgQAAAMgAAAARAAAAYW5pbWF0aW9ucy9hLmpzb25djlsKwjAQRfdyv4cYFRFmB65BigSc1qCtJalKCdm7k1o/2q/LPM6ZSXiDcTBHY0GoA3hvCb4Hazw1SvkBb63mbc6uVca3jRIuRhki+Jzgr1PXNXIprgmaGcLrP4sbnam38KbvikP0WK4IDzdK+LmGEbwjBKlPS+vqs7uup5yr/AVQSwMEFAAAAAgAUKvmXGULmf4LAAAACQAAAA4AAABpbWFnZXMvaW1nLnBuZ+sM8HNnZGJmYQUAUEsBAhQAFAAAAAgAUKvmXPPNOKodAAAAGwAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACABQq+ZcPflXAIEAAADIAAAAEQAAAAAAAAAAAAAAAABIAAAAYW5pbWF0aW9ucy9hLmpzb25QSwECFAAUAAAACABQq+ZcZQuZ/gsAAAAJAAAADgAAAAAAAAAAAAAAAAD4AAAAaW1hZ2VzL2ltZy5wbmdQSwUGAAAAAAMAAwC2AAAALwEAAAAA'

function lottieJson(overrides: Record<string, unknown> = {}) {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 300,
    nm: 'test',
    layers: [{ ty: 4, nm: 'l', ip: 0, op: 60, ks: {} }],
    ...overrides,
  }
}

// Real `.lottie` (dotLottie ZIP) archives, generated with fflate in Node and
// embedded as base64. fflate's zipSync mis-encodes byte arrays under the vitest
// runner (module-realm Uint8Array mismatch), so fixtures are pre-built rather
// than zipped in-test; this also exercises the exact `unzipSync` path prod uses.
const FIXTURES = {
  // manifest -> anim0 (512x512), fr 30, op 60
  single:
    'UEsDBBQAAAAIAFVH5lxP03UzHgAAAB8AAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayiq5WykxRsgKLGSjVxtYCAFBLAwQUAAAACABVR+ZcrlJrjFMAAABxAAAAFQAAAGFuaW1hdGlvbnMvYW5pbTAuanNvbqtWKlOyUjLVM9czUNJRSitSsjI20FHKLFCyAlL5QMoMSJcrWZkaGukoZUDpvFygnhKg+pzEytSiYiWr6GqlkkolKxOoVA5QCs2IbKCq6tra2FoAUEsBAhQAFAAAAAgAVUfmXE/TdTMeAAAAHwAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACABVR+ZcrlJrjFMAAABxAAAAFQAAAAAAAAAAAAAAAABJAAAAYW5pbWF0aW9ucy9hbmltMC5qc29uUEsFBgAAAAACAAIAfgAAAM8AAAAAAA==',
  // manifest lists [second, first]; second=999x640, first=100x100
  multi:
    'UEsDBBQAAAAIAFVH5lzUzjjJKwAAAC8AAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayiq5WykxRslIqTk3Oz0tRqtWB8tMyi4pLlGpjawFQSwMEFAAAAAgAVUfmXGd/2GRSAAAAcQAAABUAAABhbmltYXRpb25zL2ZpcnN0Lmpzb26rVipTslIy1TPXM1DSUUorUrIyNtBRyixQsgJS+UDKDEiXK1kZGgDpDCidlwvUUwJUn5NYmVpUrGQVXa1UUqlkZQKVygFKoRmRDVRVXVsbWwsAUEsDBBQAAAAIAFVH5lyqYAixVgAAAHEAAAAWAAAAYW5pbWF0aW9ucy9zZWNvbmQuanNvbqtWKlOyUjLVM9czUNJRSitSsjI20FHKLFCyAlL5QMoMSJcrWVlaWuooZQC5JkB+Xi5QTwlQfU5iZWpRsZJVdLVSSaWSlQlUKgcohWZENlBVdW1tbC0AUEsBAhQAFAAAAAgAVUfmXNTOOMkrAAAALwAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACABVR+ZcZ3/YZFIAAABxAAAAFQAAAAAAAAAAAAAAAABWAAAAYW5pbWF0aW9ucy9maXJzdC5qc29uUEsBAhQAFAAAAAgAVUfmXKpgCLFWAAAAcQAAABYAAAAAAAAAAAAAAAAA2wAAAGFuaW1hdGlvbnMvc2Vjb25kLmpzb25QSwUGAAAAAAMAAwDCAAAAZQEAAAAA',
  // no manifest; only.json=256x256
  noManifest:
    'UEsDBBQAAAAIAFVH5lxgXqjRUwAAAHEAAAAUAAAAYW5pbWF0aW9ucy9vbmx5Lmpzb26rVipTslIy1TPXM1DSUUorUrIyNtBRyixQsgJS+UDKDEiXK1kZmZrpKGVA6bxcoJ4SoPqcxMrUomIlq+hqpZJKJSsTqFQOUArNiGygqura2thaAFBLAQIUABQAAAAIAFVH5lxgXqjRUwAAAHEAAAAUAAAAAAAAAAAAAAAAAAAAAABhbmltYXRpb25zL29ubHkuanNvblBLBQYAAAAAAQABAEIAAACFAAAAAAA=',
  // dotLottie v2 layout (LottieFiles): manifest {version:'2', animations:[{id:'anim0'}]}
  // with the animation stored at `a/anim0.json` (512x512), not `animations/`.
  v2Single:
    'UEsDBBQAAAAIACNb6FyPv86ETgAAAF8AAAANAAAAbWFuaWZlc3QuanNvbqtWKkstKs7Mz1OyUlAyUtJRUEpPzUstSizJLwKJOKTkl+Tkl5RkpurDWbpZxQ6GemZ6YNWJeZm5iSVA/cVA5dHVSpkpIG0gUQOl2thaAFBLAwQUAAAACAAjW+hcrWFQGVYAAACNAAAADAAAAGEvYW5pbTAuanNvbqtWKlOyUlAy1TPXM1DSUVBKKwJyjQ2ArMwCIAvEyAcxzECsciDD1NAIyMqAs/JyQfoT8zJzwfpzEitTi4qBQtHVSiWVQNoEriZHCbup2SDl1bW1sbUAUEsBAhQAFAAAAAgAI1voXI+/zoROAAAAXwAAAA0AAAAAAAAAAAAAAIABAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACAAjW+hcrWFQGVYAAACNAAAADAAAAAAAAAAAAAAAgAF5AAAAYS9hbmltMC5qc29uUEsFBgAAAAACAAIAdQAAAPkAAAAAAA==',
  // manifest with empty animations, no animation files
  empty:
    'UEsDBBQAAAAIAFVH5lx1pkWvEwAAABEAAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayio6tBQBQSwECFAAUAAAACABVR+ZcdaZFrxMAAAARAAAADQAAAAAAAAAAAAAAAAAAAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAQABADsAAAA+AAAAAAA=',
  // manifest {animations:[{id:'a',themes:['dark','light']}], themes:[{id:'dark'},{id:'light'}]};
  // animations/a.json (512x512) carries markers intro/loop/cue; themes/dark.json +
  // themes/light.json each hold a `bg` Color rule.
  themed:
    'UEsDBBQAAAAAAGMC51zS4vB/XQAAAF0AAAANAAAAbWFuaWZlc3QuanNvbnsiYW5pbWF0aW9ucyI6W3siaWQiOiJhIiwidGhlbWVzIjpbImRhcmsiLCJsaWdodCJdfV0sInRoZW1lcyI6W3siaWQiOiJkYXJrIn0seyJpZCI6ImxpZ2h0In1dfVBLAwQUAAAAAABjAudcJw8I9NUAAADVAAAAEQAAAGFuaW1hdGlvbnMvYS5qc29ueyJ2IjoiNS43LjAiLCJmciI6MzAsImlwIjowLCJvcCI6NjAsInciOjUxMiwiaCI6NTEyLCJubSI6ImEiLCJsYXllcnMiOlt7InR5Ijo0LCJubSI6ImwiLCJpcCI6MCwib3AiOjYwLCJrcyI6e319XSwibWFya2VycyI6W3sidG0iOjAsImNtIjoiaW50cm8iLCJkciI6MzB9LHsidG0iOjMwLCJjbSI6Imxvb3AiLCJkciI6MzB9LHsidG0iOjU5LCJjbSI6ImN1ZSIsImRyIjowfV19UEsDBBQAAAAAAGMC51w0nok/OAAAADgAAAAQAAAAdGhlbWVzL2RhcmsuanNvbnsicnVsZXMiOlt7ImlkIjoiYmciLCJ0eXBlIjoiQ29sb3IiLCJ2YWx1ZSI6WzAsMCwwLDFdfV19UEsDBBQAAAAAAGMC51wDXgtPOAAAADgAAAARAAAAdGhlbWVzL2xpZ2h0Lmpzb257InJ1bGVzIjpbeyJpZCI6ImJnIiwidHlwZSI6IkNvbG9yIiwidmFsdWUiOlsxLDEsMSwxXX1dfVBLAQIUABQAAAAAAGMC51zS4vB/XQAAAF0AAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAAAYwLnXCcPCPTVAAAA1QAAABEAAAAAAAAAAAAAAAAAiAAAAGFuaW1hdGlvbnMvYS5qc29uUEsBAhQAFAAAAAAAYwLnXDSeiT84AAAAOAAAABAAAAAAAAAAAAAAAAAAjAEAAHRoZW1lcy9kYXJrLmpzb25QSwECFAAUAAAAAABjAudcA14LTzgAAAA4AAAAEQAAAAAAAAAAAAAAAADyAQAAdGhlbWVzL2xpZ2h0Lmpzb25QSwUGAAAAAAQABAD3AAAAWQIAAAAA',
}

const decodeB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

describe('parseLottieMetadata', () => {
  it('extracts w/h/fr and derives totalFrames + duration', () => {
    expect(parseLottieMetadata(lottieJson())).toEqual({
      width: 400,
      height: 300,
      frameRate: 30,
      totalFrames: 60,
      durationSeconds: 2,
    })
  })

  it('honors a non-zero in-point when computing totalFrames', () => {
    const meta = parseLottieMetadata(lottieJson({ ip: 15, op: 75 }))
    expect(meta?.totalFrames).toBe(60)
    expect(meta?.durationSeconds).toBe(2)
  })

  it('rejects JSON that lacks the Lottie shape (no layers array)', () => {
    expect(parseLottieMetadata({ w: 100, h: 100, fr: 30, op: 60 })).toBeNull()
  })

  it('rejects JSON missing required numeric fields', () => {
    expect(parseLottieMetadata({ w: 100, h: 100, layers: [] })).toBeNull()
  })
})

describe('parseLottieFileBytes', () => {
  it('parses raw .json Lottie bytes', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(lottieJson()))
    expect(parseLottieFileBytes(bytes)?.width).toBe(400)
  })

  it('parses a .lottie (dotLottie ZIP) archive', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.single))).toEqual({
      width: 512,
      height: 512,
      frameRate: 30,
      totalFrames: 60,
      durationSeconds: 2,
    })
  })

  it('parses a dotLottie v2 archive (animations under `a/`)', () => {
    // Regression: LottieFiles serves v2 archives storing animations at
    // `a/<id>.json` rather than v1 `animations/<id>.json`.
    expect(parseLottieFileBytes(decodeB64(FIXTURES.v2Single))).toEqual({
      width: 512,
      height: 512,
      frameRate: 30,
      totalFrames: 60,
      durationSeconds: 2,
    })
  })

  it('probes the manifest-ordered animation in a multi-animation archive', () => {
    // manifest lists 'second' first -> expect its 999px width, not first's 100
    expect(parseLottieFileBytes(decodeB64(FIXTURES.multi))?.width).toBe(999)
  })

  it('reads a specific animation by id (overriding manifest order)', () => {
    // 'first' is second in manifest order but must still be selectable by id
    expect(parseLottieFileBytes(decodeB64(FIXTURES.multi), 'first')?.width).toBe(100)
    expect(parseLottieFileBytes(decodeB64(FIXTURES.multi), 'second')?.width).toBe(999)
    // Unknown id falls back to the manifest-primary animation
    expect(parseLottieFileBytes(decodeB64(FIXTURES.multi), 'nope')?.width).toBe(999)
  })

  it('falls back to the first animation entry when the manifest is absent', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.noManifest))?.width).toBe(256)
  })

  it('returns null for a ZIP with no animations', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.empty))).toBeNull()
  })

  it('returns null for non-Lottie bytes', () => {
    expect(parseLottieFileBytes(new TextEncoder().encode('not json at all'))).toBeNull()
    expect(parseLottieFileBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})

describe('extractLottieAnimation', () => {
  it('parses raw .json bytes into the animation object', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(lottieJson()))
    const anim = extractLottieAnimation(bytes)
    expect(anim?.w).toBe(400)
    expect(Array.isArray(anim?.layers)).toBe(true)
  })

  it('unzips a .lottie archive to the primary animation object', () => {
    const anim = extractLottieAnimation(decodeB64(FIXTURES.single))
    expect(anim?.w).toBe(512)
    expect(Array.isArray(anim?.layers)).toBe(true)
  })

  it('selects a specific animation by id from a multi-animation archive', () => {
    const bytes = decodeB64(FIXTURES.multi)
    expect(extractLottieAnimation(bytes)?.w).toBe(999) // manifest-primary
    expect(extractLottieAnimation(bytes, false, 'first')?.w).toBe(100)
    expect(extractLottieAnimation(bytes, false, 'second')?.w).toBe(999)
  })

  it('unzips a dotLottie v2 archive (animations under `a/`)', () => {
    const anim = extractLottieAnimation(decodeB64(FIXTURES.v2Single))
    expect(anim?.w).toBe(512)
    expect(Array.isArray(anim?.layers)).toBe(true)
  })

  it('returns null for non-Lottie bytes', () => {
    expect(extractLottieAnimation(new TextEncoder().encode('nope'))).toBeNull()
    expect(extractLottieAnimation(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })

  it('inlines archive images as data URIs only when requested', () => {
    const bytes = decodeB64(IMAGE_ARCHIVE_B64)

    const withoutInline = extractLottieAnimation(bytes, false)!
    const asset0 = (withoutInline.assets as Array<Record<string, unknown>>)[0]!
    expect(asset0.p).toBe('img.png') // untouched reference

    const withInline = extractLottieAnimation(bytes, true)!
    const inlined = (withInline.assets as Array<Record<string, unknown>>)[0]!
    expect(inlined.p).toBe('data:image/png;base64,iVBORwECAwQF')
    expect(inlined.u).toBe('')
    expect(inlined.e).toBe(1)
  })
})

describe('extractLottieManifest', () => {
  it('lists an archive’s animations and the union of its theme ids', () => {
    expect(extractLottieManifest(decodeB64(FIXTURES.themed))).toEqual({
      animations: [{ id: 'a' }],
      themes: ['dark', 'light'],
    })
  })

  it('lists animations in manifest order with no themes when none are declared', () => {
    expect(extractLottieManifest(decodeB64(FIXTURES.multi))).toEqual({
      animations: [{ id: 'second' }, { id: 'first' }],
      themes: [],
    })
  })

  it('returns null for raw .json (no archive/manifest) and non-Lottie bytes', () => {
    const raw = new TextEncoder().encode(JSON.stringify(lottieJson()))
    expect(extractLottieManifest(raw)).toBeNull()
    expect(extractLottieManifest(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})

describe('extractLottieThemeData', () => {
  it('reads a theme’s rule JSON by id', () => {
    const dark = extractLottieThemeData(decodeB64(FIXTURES.themed), 'dark')
    expect(dark).not.toBeNull()
    expect(JSON.parse(dark!)).toEqual({
      rules: [{ id: 'bg', type: 'Color', value: [0, 0, 0, 1] }],
    })
    const light = JSON.parse(extractLottieThemeData(decodeB64(FIXTURES.themed), 'light')!)
    expect(light.rules[0].value).toEqual([1, 1, 1, 1])
  })

  it('returns null for an unknown theme id or a themeless archive', () => {
    expect(extractLottieThemeData(decodeB64(FIXTURES.themed), 'missing')).toBeNull()
    expect(extractLottieThemeData(decodeB64(FIXTURES.multi), 'dark')).toBeNull()
    expect(extractLottieThemeData(new TextEncoder().encode('{}'), 'dark')).toBeNull()
  })
})

describe('readLottieMarkers', () => {
  it('reads named markers with start + duration in source frames', () => {
    const anim = extractLottieAnimation(decodeB64(FIXTURES.themed))
    expect(readLottieMarkers(anim)).toEqual([
      { name: 'intro', start: 0, duration: 30 },
      { name: 'loop', start: 30, duration: 30 },
      { name: 'cue', start: 59, duration: 0 }, // zero-duration cue point
    ])
  })

  it('skips unnamed markers and tolerates missing/negative fields', () => {
    const markers = readLottieMarkers({
      markers: [
        { tm: 10, cm: 'named', dr: 5 },
        { tm: 20, cm: '   ', dr: 5 }, // blank name -> skipped
        { tm: 30 }, // no name -> skipped
        { cm: 'origin' }, // no tm/dr -> defaults to 0/0
        { tm: -4, cm: 'clamped', dr: -2 }, // negative -> 0/0
      ],
    })
    expect(markers).toEqual([
      { name: 'named', start: 10, duration: 5 },
      { name: 'origin', start: 0, duration: 0 },
      { name: 'clamped', start: 0, duration: 0 },
    ])
  })

  it('returns [] when there are no markers or the input is not a Lottie', () => {
    expect(readLottieMarkers(lottieJson())).toEqual([])
    expect(readLottieMarkers(null)).toEqual([])
    expect(readLottieMarkers('nope')).toEqual([])
  })
})
