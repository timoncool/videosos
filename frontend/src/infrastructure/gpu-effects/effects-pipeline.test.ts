import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { GPU_EFFECT_REGISTRY } from './registry'
import { EffectsPipeline } from './effects-pipeline'
import type { GpuEffectInstance } from './types'

const originalShaderStage = globalThis.GPUShaderStage
const originalBufferUsage = globalThis.GPUBufferUsage
const originalGpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu')

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(globalThis, {
    GPUShaderStage: originalShaderStage,
    GPUBufferUsage: originalBufferUsage,
  })
  if (originalGpuDescriptor) {
    Object.defineProperty(navigator, 'gpu', originalGpuDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'gpu')
  }
})

describe('EffectsPipeline device ownership', () => {
  it('reuses immutable compiled pipelines across renderer sessions on one device', async () => {
    Object.assign(globalThis, {
      GPUShaderStage: { FRAGMENT: 1, COMPUTE: 2 },
      GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    })
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    })
    const createRenderPipeline = vi.fn(() => ({}))
    const createComputePipeline = vi.fn(() => ({}))
    const device = {
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline,
      createComputePipeline,
      createBuffer: vi.fn(() => ({ destroy: vi.fn(), size: 16 })),
    } as unknown as GPUDevice
    const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
    const initialize = (pipeline: EffectsPipeline) =>
      (
        pipeline as unknown as {
          createPipelines(): Promise<void>
        }
      ).createPipelines()

    const first = new Pipeline(device)
    await initialize(first)
    const renderPipelineCount = createRenderPipeline.mock.calls.length
    const computePipelineCount = createComputePipeline.mock.calls.length
    expect(renderPipelineCount + computePipelineCount).toBeGreaterThanOrEqual(
      GPU_EFFECT_REGISTRY.size,
    )

    const second = new Pipeline(device)
    await initialize(second)
    expect(createRenderPipeline).toHaveBeenCalledTimes(renderPipelineCount)
    expect(createComputePipeline).toHaveBeenCalledTimes(computePipelineCount)

    first.destroy()
    const secondState = second as unknown as { pipelines: Map<string, GPURenderPipeline> }
    expect(secondState.pipelines.size).toBeGreaterThan(0)
  })
})

describe('EffectsPipeline pass planning', () => {
  it('fuses adjacent color operations while preserving spatial-effect boundaries', async () => {
    Object.assign(globalThis, {
      GPUShaderStage: { FRAGMENT: 1, COMPUTE: 2 },
      GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    })
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    })

    const writeBuffer = vi.fn()
    const device = {
      queue: { writeBuffer },
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => ({
        destroy: vi.fn(),
        size: descriptor.size,
      })),
    } as unknown as GPUDevice
    const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
    const pipeline = new Pipeline(device)
    await (
      pipeline as unknown as {
        createPipelines(): Promise<void>
      }
    ).createPipelines()

    const ping = {} as GPUTexture
    const pong = {} as GPUTexture
    const pingView = {} as GPUTextureView
    const pongView = {} as GPUTextureView
    Object.assign(pipeline, {
      pingTexture: ping,
      pongTexture: pong,
      pingView,
      pongView,
    })

    const beginRenderPass = vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    }))
    const encoder = { beginRenderPass } as unknown as GPUCommandEncoder
    const run = (effects: GpuEffectInstance[]): GPUTexture =>
      (
        pipeline as unknown as {
          runEffectChain(
            encoder: GPUCommandEncoder,
            effects: GpuEffectInstance[],
            input: GPUTexture,
            output: GPUTexture,
            width: number,
            height: number,
          ): GPUTexture
        }
      ).runEffectChain(encoder, effects, ping, pong, 1920, 1080)
    const effect = (
      type: string,
      params: Record<string, number | boolean | string> = {},
    ): GpuEffectInstance => ({ id: type, type, name: type, enabled: true, params })

    const fusedOutput = run([
      effect('gpu-brightness', { amount: 0.1 }),
      effect('gpu-contrast', { amount: 1.2 }),
      effect('gpu-saturation', { amount: 0.8 }),
      effect('gpu-invert'),
    ])
    expect(beginRenderPass).toHaveBeenCalledTimes(1)
    expect(fusedOutput).toBe(pong)
    const packedBatch = writeBuffer.mock.calls[0]![2] as ArrayBuffer
    expect(new Uint32Array(packedBatch, 0, 1)[0]).toBe(4)

    beginRenderPass.mockClear()
    run([
      effect('gpu-brightness', { amount: 0.1 }),
      effect('gpu-gaussian-blur', { radius: 10, samples: 5 }),
      effect('gpu-contrast', { amount: 1.2 }),
    ])
    expect(beginRenderPass).toHaveBeenCalledTimes(3)

    // Both fused and standalone passes must receive the requested frame time.
    const hue = GPU_EFFECT_REGISTRY.get('gpu-hue-shift')!
    const glitch = GPU_EFFECT_REGISTRY.get('gpu-color-glitch')!
    const huePack = vi.spyOn(hue, 'packUniforms')
    const glitchPack = vi.spyOn(glitch, 'packUniforms')
    run([
      { ...effect('gpu-hue-shift'), timelineTimeSeconds: 5.125 },
      { ...effect('gpu-color-glitch'), timelineTimeSeconds: 5.125 },
    ])
    expect(huePack).toHaveBeenLastCalledWith({}, 1920, 1080, 5.125)
    expect(glitchPack).toHaveBeenLastCalledWith({}, 1920, 1080, 5.125)

    beginRenderPass.mockClear()
    Object.assign(pipeline, {
      colorBatchPipeline: null,
      colorBatchBindGroupLayout: null,
    })
    run([effect('gpu-brightness', { amount: 0.1 }), effect('gpu-contrast', { amount: 1.2 })])
    expect(beginRenderPass).toHaveBeenCalledTimes(2)
  })
})
