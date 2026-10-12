export function shouldRasterizeSvgMaskForFrame({
  maskType,
  hasPaths,
  feather,
  isPlaying,
}: {
  maskType: 'clip' | 'alpha' | 'svg-mask' | null
  hasPaths: boolean
  feather: number
  isPlaying: boolean
}): boolean {
  return maskType === 'svg-mask' && hasPaths && feather > 0 && !isPlaying
}
