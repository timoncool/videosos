/**
 * Transition Registry
 *
 * Map-based registry for transition definitions and renderers.
 * Follows the same pattern as src/features/gpu/graph/node-registry.ts.
 *
 * Each registered transition has:
 * - A TransitionDefinition (metadata for UI)
 * - A TransitionRenderer (canvas/GPU render logic for export and preview)
 */

import type {
  TransitionDefinition,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('TransitionRegistry')

/**
 * Renderer interface for transitions.
 * Each registered transition must provide this.
 */
export interface TransitionRenderer {
  /**
   * Render the transition onto a Canvas 2D context (for export).
   * @param ctx - Output canvas context
   * @param leftCanvas - Pre-rendered outgoing clip
   * @param rightCanvas - Pre-rendered incoming clip
   * @param progress - Transition progress (0-1)
   * @param direction - Optional direction
   * @param canvas - Canvas dimensions { width, height }
   * @param properties - Optional custom properties
   */
  renderCanvas?(
    ctx: OffscreenCanvasRenderingContext2D,
    leftCanvas: OffscreenCanvas,
    rightCanvas: OffscreenCanvas,
    progress: number,
    direction?: WipeDirection | SlideDirection | FlipDirection,
    canvas?: { width: number; height: number },
    properties?: Record<string, unknown>,
  ): void

  /** GPU transition ID for WebGPU-accelerated rendering via TransitionPipeline */
  gpuTransitionId?: string
}

/**
 * Entry stored in the registry for each transition.
 */
interface TransitionRegistryEntry {
  definition: TransitionDefinition
  renderer: TransitionRenderer
}

/**
 * Transition Registry class.
 * Stores transition definitions and renderers by presentation ID.
 */
export class TransitionRegistry {
  private entries: Map<string, TransitionRegistryEntry> = new Map()

  /**
   * Register a transition with its definition and renderer.
   */
  register(id: string, definition: TransitionDefinition, renderer: TransitionRenderer): void {
    if (this.entries.has(id)) {
      log.warn(`Transition "${id}" is being overwritten`)
    }
    this.entries.set(id, { definition, renderer })
  }

  /**
   * Unregister a transition by ID.
   */
  unregister(id: string): boolean {
    return this.entries.delete(id)
  }

  /**
   * Get just the renderer for a transition ID.
   */
  getRenderer(id: string): TransitionRenderer | undefined {
    return this.entries.get(id)?.renderer
  }

  /**
   * Get just the definition for a transition ID.
   */
  getDefinition(id: string): TransitionDefinition | undefined {
    return this.entries.get(id)?.definition
  }

  /**
   * Check if a transition ID is registered.
   */
  has(id: string): boolean {
    return this.entries.has(id)
  }

  /**
   * Get all definitions (for UI listing).
   */
  getDefinitions(): TransitionDefinition[] {
    return Array.from(this.entries.values()).map((e) => e.definition)
  }

  /**
   * Get all registered IDs.
   */
  getIds(): string[] {
    return Array.from(this.entries.keys())
  }

  /**
   * Get count of registered transitions.
   */
  get size(): number {
    return this.entries.size
  }
}

/**
 * Global singleton transition registry.
 */
export const transitionRegistry = new TransitionRegistry()
