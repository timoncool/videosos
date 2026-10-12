// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createGpuRenderPipelineMocks } from '@/infrastructure/gpu-test-helpers'
import {
  MAX_GPU_SHAPE_PATH_VERTICES,
  SHAPE_UNIFORM_HEADER_FLOAT_COUNT,
  ShapeRenderPipeline,
} from './shape-render-pipeline'

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  const outputView = {}
  const outputTexture = {
    createView: vi.fn(() => outputView),
    width: 1920,
    height: 1080,
  } as unknown as GPUTexture
  const { commandEncoder, device, pass, queue } = createGpuRenderPipelineMocks()
  const pipeline = new ShapeRenderPipeline(device as unknown as GPUDevice)
  return { commandEncoder, device, outputTexture, pass, pipeline, queue }
}

describe('ShapeRenderPipeline', () => {
  it('renders an analytic shape into the output texture', () => {
    const { commandEncoder, device, outputTexture, pass, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 120, width: 640, height: 360 },
      rotationRad: Math.PI / 4,
      opacity: 0.8,
      shapeType: 'star',
      fillColor: [1, 0, 0, 1],
      strokeColor: [0, 1, 0, 1],
      strokeWidth: 12,
      points: 7,
      innerRadius: 0.4,
      maskFeatherPixels: 16,
    })

    expect(rendered).toBe(true)
    expect(device.createBuffer).toHaveBeenCalledWith({
      size:
        (SHAPE_UNIFORM_HEADER_FLOAT_COUNT + MAX_GPU_SHAPE_PATH_VERTICES * 4) *
        Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData.length).toBe(
      SHAPE_UNIFORM_HEADER_FLOAT_COUNT + MAX_GPU_SHAPE_PATH_VERTICES * 4,
    )
    expect(Array.from(uniformData.slice(0, 3))).toEqual([1920, 1080, 5])
    expect(uniformData[3]).toBeCloseTo(0.8)
    expect(Array.from(uniformData.slice(4, 19))).toEqual([
      100, 120, 640, 360, 1, 0, 0, 1, 0, 1, 0, 1, 0, 12, 7,
    ])
    expect(uniformData[19]).toBeCloseTo(0.4)
    expect(uniformData[20]).toBeCloseTo(Math.PI / 4)
    expect(uniformData[23]).toBe(16)
    expect(commandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [
        {
          view: {},
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    expect(pass.setPipeline).toHaveBeenCalledWith('render-pipeline')
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, 'bind-group')
    expect(pass.draw).toHaveBeenCalledWith(6)
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
    expect(outputTexture.createView).toHaveBeenCalled()
  })

  it('reuses the shape bind group across frames', () => {
    const { device, outputTexture, pipeline } = createPipelineHarness()
    const params = {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 0, y: 0, width: 200, height: 200 },
      shapeType: 'rectangle' as const,
      fillColor: [1, 1, 1, 1] as [number, number, number, number],
    }

    expect(pipeline.renderShapeToTexture(outputTexture, params)).toBe(true)
    expect(pipeline.renderShapeToTexture(outputTexture, params)).toBe(true)

    expect(device.createBindGroup).toHaveBeenCalledTimes(1)
  })

  it('accepts heart shapes as analytic GPU shapes', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 100, width: 300, height: 240 },
      shapeType: 'heart',
      fillColor: [1, 0, 0, 1],
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[2]).toBe(6)
  })

  it('packs straight custom path vertices for GPU polygon rendering', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 100, width: 300, height: 240 },
      shapeType: 'path',
      fillColor: [1, 0, 0, 1],
      pathVertices: [
        [-150, -120],
        [150, -120],
        [0, 120],
      ],
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[2]).toBe(7)
    expect(uniformData[18]).toBe(3)
    expect(
      Array.from(
        uniformData.slice(SHAPE_UNIFORM_HEADER_FLOAT_COUNT, SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 12),
      ),
    ).toEqual([-150, -120, 0, 0, 150, -120, 0, 0, 0, 120, 0, 0])
  })

  it('packs linear gradient colors and angle without changing the Shape discriminator', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 0, y: 0, width: 1920, height: 1080 },
      shapeType: 'rectangle',
      fillColor: [0.25, 0.5, 0.75, 1],
      gradientEndColor: [0.75, 0.25, 0.5, 1],
      gradientAngleRad: Math.PI / 2,
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(Array.from(uniformData.slice(32, 36))).toEqual([0.75, 0.25, 0.5, 1])
    expect(uniformData[36]).toBeCloseTo(Math.PI / 2)
    expect(uniformData[37]).toBe(1)
  })

  it('packs up to the full GPU custom path vertex capacity', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()
    const pathVertices = Array.from({ length: MAX_GPU_SHAPE_PATH_VERTICES }, (_, index) => [
      index,
      index + 0.5,
    ]) as Array<[number, number]>

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 100, width: 300, height: 240 },
      shapeType: 'path',
      fillColor: [1, 0, 0, 1],
      pathVertices,
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[18]).toBe(MAX_GPU_SHAPE_PATH_VERTICES)
    expect(Array.from(uniformData.slice(-4))).toEqual([
      MAX_GPU_SHAPE_PATH_VERTICES - 1,
      MAX_GPU_SHAPE_PATH_VERTICES - 0.5,
      0,
      0,
    ])
  })

  it('uses generated perimeter distance for analytic shape progress', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()
    pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      shapeType: 'rectangle',
      fillColor: [1, 1, 1, 1],
      transformRect: { x: 0, y: 0, width: 200, height: 100 },
    })
    const rectangle = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(
      Array.from(
        rectangle.slice(SHAPE_UNIFORM_HEADER_FLOAT_COUNT, SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 3),
      ),
    ).toEqual([-100, -50, 0])
    expect(rectangle[SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 6]).toBeCloseTo(1 / 3)

    pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      shapeType: 'heart',
      fillColor: [1, 1, 1, 1],
      transformRect: { x: 0, y: 0, width: 220, height: 200 },
    })
    const heart = queue.writeBuffer.mock.calls[1]?.[2] as Float32Array
    expect(heart[SHAPE_UNIFORM_HEADER_FLOAT_COUNT]).toBeCloseTo(0)
    expect(heart[SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 1]).toBeGreaterThan(0)
    expect(heart[SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 4]).toBeLessThan(0)
    const heartVertexCount = heart[21]!
    const progress = Array.from(
      { length: heartVertexCount },
      (_, index) => heart[SHAPE_UNIFORM_HEADER_FLOAT_COUNT + 2 + index * 4]!,
    )
    expect(progress.every((value, index) => index === 0 || value > progress[index - 1]!)).toBe(true)
  })
})
