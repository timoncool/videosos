import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'

interface CompositionCanvas {
  editorKind?: 'sequence' | 'composite-2d'
  width: number
  height: number
}

interface ProjectCanvas {
  width?: number
  height?: number
}

export function resolveGeneratedLayerCanvasSize(
  activeComposition: CompositionCanvas | undefined,
  projectCanvas: ProjectCanvas | undefined,
): { width: number; height: number } {
  if (activeComposition?.editorKind === 'composite-2d') {
    return { width: activeComposition.width, height: activeComposition.height }
  }

  return {
    width: projectCanvas?.width ?? DEFAULT_PROJECT_WIDTH,
    height: projectCanvas?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}
