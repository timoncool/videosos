/**
 * GPU texture manager for mask data.
 * Uploads CPU-rendered mask ImageData to GPU textures for use in
 * the compositor pipeline's fragment shader.
 */

export class MaskTextureManager {
  private fallbackTexture: GPUTexture
  private fallbackView: GPUTextureView

  constructor(device: GPUDevice) {
    // 1x1 white fallback (no mask = fully visible)
    this.fallbackTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: this.fallbackTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    )
    this.fallbackView = this.fallbackTexture.createView()
  }

  getFallbackView(): GPUTextureView {
    return this.fallbackView
  }

  destroy(): void {
    this.fallbackTexture.destroy()
  }
}
