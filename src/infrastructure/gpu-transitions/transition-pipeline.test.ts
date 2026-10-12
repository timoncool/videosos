import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { GPU_TRANSITION_REGISTRY } from './registry'
import { TransitionPipeline } from './transition-pipeline'

const originalShaderStage = globalThis.GPUShaderStage
const originalBufferUsage = globalThis.GPUBufferUsage

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(globalThis, {
    GPUShaderStage: originalShaderStage,
    GPUBufferUsage: originalBufferUsage,
  })
})

describe('TransitionPipeline device ownership', () => {
  it('reuses immutable compiled pipelines across renderer sessions on one device', () => {
    Object.assign(globalThis, { GPUShaderStage: { FRAGMENT: 1 } })
    const createRenderPipeline = vi.fn(() => ({}))
    const device = {
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({
        getCompilationInfo: vi.fn(() => Promise.resolve({ messages: [] })),
      })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline,
    } as unknown as GPUDevice
    const Pipeline = TransitionPipeline as unknown as new (device: GPUDevice) => TransitionPipeline
    const initialize = (pipeline: TransitionPipeline) =>
      (pipeline as unknown as { init(): void }).init()

    const first = new Pipeline(device)
    initialize(first)
    expect(createRenderPipeline).toHaveBeenCalledTimes(GPU_TRANSITION_REGISTRY.size)

    const second = new Pipeline(device)
    initialize(second)
    expect(createRenderPipeline).toHaveBeenCalledTimes(GPU_TRANSITION_REGISTRY.size)

    const transitionId = GPU_TRANSITION_REGISTRY.keys().next().value
    expect(transitionId).toBeDefined()
    first.destroy()
    expect(second.has(transitionId!)).toBe(true)
  })

  it('reuses pooled texture views and bind groups across transition frames', () => {
    Object.assign(globalThis, {
      GPUShaderStage: { FRAGMENT: 1 },
      GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    })
    const createBindGroup = vi.fn(() => ({}))
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    }
    const commandEncoder = {
      beginRenderPass: vi.fn(() => pass),
      finish: vi.fn(() => ({})),
    }
    const device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({
        getCompilationInfo: vi.fn(() => Promise.resolve({ messages: [] })),
      })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => ({
        destroy: vi.fn(),
        size: descriptor.size,
      })),
      createBindGroup,
      createCommandEncoder: vi.fn(() => commandEncoder),
    } as unknown as GPUDevice
    const createTexture = () => {
      const createView = vi.fn(() => ({}))
      return {
        width: 1920,
        height: 1080,
        createView,
      } as unknown as GPUTexture
    }
    const leftTexture = createTexture()
    const rightTexture = createTexture()
    const outputTexture = createTexture()

    const pipeline = TransitionPipeline.create(device)
    expect(pipeline).not.toBeNull()
    for (const progress of [0.25, 0.5]) {
      expect(
        pipeline!.renderTexturesToTexture(
          'dissolve',
          leftTexture,
          rightTexture,
          outputTexture,
          progress,
          1920,
          1080,
        ),
      ).toBe(true)
    }

    expect(leftTexture.createView).toHaveBeenCalledTimes(1)
    expect(rightTexture.createView).toHaveBeenCalledTimes(1)
    expect(outputTexture.createView).toHaveBeenCalledTimes(1)
    expect(createBindGroup).toHaveBeenCalledTimes(1)
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(2)
    expect(device.queue.submit).toHaveBeenCalledTimes(2)
  })
})
