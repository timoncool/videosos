/**
 * Lazy, once-per-realm bootstrap of onnxruntime-web.
 *
 * The wasm binaries are pulled from a CDN pinned to the exact dev build in `package.json` — a
 * mismatch between the JS glue and the wasm is a silent, confusing failure, so the two move
 * together. `numThreads = 1` because every model we run is already GPU-bound on the WebGPU EP,
 * and the wasm fallback path is a correctness net rather than a performance one.
 *
 * Worker-safe, and intended to be imported by workers rather than the main thread: each worker
 * bundle gets its own module instance and therefore its own single initialization.
 */

const ORT_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260410-5e55544225/dist/'

export type OrtModule = typeof import('onnxruntime-web')
export type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

let ortPromise: Promise<OrtModule> | null = null

export function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((module) => {
      module.env.wasm.wasmPaths = ORT_WASM_PATH
      module.env.wasm.numThreads = 1
      return module
    })
  }
  return ortPromise
}
