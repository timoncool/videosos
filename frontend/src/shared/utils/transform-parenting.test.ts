import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import {
  applyTransformParentBinding,
  createTransformParentBinding,
  resolveTransformHierarchy,
  wouldCreateTransformParentCycle,
  worldToLocalTransform,
} from './transform-parenting'

function transform(overrides: Partial<ResolvedTransform> = {}): ResolvedTransform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    anchorX: 50,
    anchorY: 50,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    ...overrides,
  }
}

function controller(id: string, resolved: ResolvedTransform): TimelineItem {
  return {
    id,
    type: 'controller',
    controllerKind: 'null',
    trackId: `${id}-track`,
    from: 0,
    durationInFrames: 100,
    label: id,
    transform: resolved,
  }
}

describe('transform parenting', () => {
  it('preserves the child pose at bind time', () => {
    const child = transform({ x: 25, y: -10, width: 40, height: 20, rotation: 15 })
    const parent = transform({ width: 80, height: 80 })
    const binding = createTransformParentBinding({
      childLocal: child,
      childWorld: child,
      parentItemId: 'parent',
      parentWorld: parent,
    })

    const resolved = applyTransformParentBinding(child, binding, parent)
    expect(resolved).toMatchObject({ ...child, rotation: resolved.rotation })
    expect(resolved.rotation).toBeCloseTo(child.rotation)
  })

  it('propagates parent translation, rotation, and scale', () => {
    const child = transform({ x: 10, width: 20, height: 10, anchorX: 10, anchorY: 5 })
    const parentAtBind = transform({ width: 100, height: 100 })
    const binding = createTransformParentBinding({
      childLocal: child,
      childWorld: child,
      parentItemId: 'parent',
      parentWorld: parentAtBind,
    })
    const parentNow = transform({ x: 50, width: 200, height: 200, rotation: 90 })

    const resolved = applyTransformParentBinding(child, binding, parentNow)
    expect(resolved.x).toBeCloseTo(50)
    expect(resolved.y).toBeCloseTo(20)
    expect(resolved.width).toBeCloseTo(40)
    expect(resolved.height).toBeCloseTo(20)
    expect(resolved.rotation).toBeCloseTo(90)
  })

  it('keeps a detached bind-space offset while local animation continues', () => {
    const binding = createTransformParentBinding({
      childLocal: transform({ x: 10 }),
      childWorld: transform({ x: 60 }),
    })
    const resolved = applyTransformParentBinding(transform({ x: 25 }), binding)
    expect(resolved.x).toBeCloseTo(75)
  })

  it('round-trips canvas edits back into child-local space', () => {
    const child = transform({ x: 10, width: 20, height: 10, anchorX: 10, anchorY: 5 })
    const parentAtBind = transform({ width: 100, height: 100 })
    const binding = createTransformParentBinding({
      childLocal: child,
      childWorld: child,
      parentItemId: 'parent',
      parentWorld: parentAtBind,
    })
    const parentNow = transform({ x: 50, width: 200, height: 200, rotation: 90 })
    const world = applyTransformParentBinding(child, binding, parentNow)
    const editedWorld = { ...world, y: world.y + 20 }
    const local = worldToLocalTransform(editedWorld, binding, parentNow)
    expect(applyTransformParentBinding(local, binding, parentNow).y).toBeCloseTo(editedWorld.y)
  })

  it('resolves nested controller chains and terminates malformed cycles', () => {
    const root = controller('root', transform({ x: 30 }))
    const middleBinding = createTransformParentBinding({
      childLocal: transform(),
      childWorld: transform(),
      parentItemId: root.id,
      parentWorld: transform(),
    })
    const middle = { ...controller('middle', transform()), transformParent: middleBinding }
    const childBinding = createTransformParentBinding({
      childLocal: transform({ x: 10 }),
      childWorld: transform({ x: 10 }),
      parentItemId: middle.id,
      parentWorld: transform(),
    })
    const child = { ...controller('child', transform({ x: 10 })), transformParent: childBinding }
    const itemById = new Map([root, middle, child].map((item) => [item.id, item]))
    const resolved = resolveTransformHierarchy(child, {
      getItem: (id) => itemById.get(id),
      resolveLocal: (item) => transform(item.transform),
    })
    expect(resolved.x).toBeCloseTo(40)

    const cycleA = {
      ...controller('a', transform()),
      transformParent: { ...childBinding, parentItemId: 'b' },
    }
    const cycleB = {
      ...controller('b', transform({ x: 5 })),
      transformParent: { ...childBinding, parentItemId: 'a' },
    }
    const cycleItems = new Map([cycleA, cycleB].map((item) => [item.id, item]))
    const cycleResult = resolveTransformHierarchy(cycleA, {
      getItem: (id) => cycleItems.get(id),
      resolveLocal: (item) => transform(item.transform),
    })
    expect(Number.isFinite(cycleResult.x)).toBe(true)
  })

  it('rejects direct and indirect parent cycles', () => {
    const a = controller('a', transform())
    const b = {
      ...controller('b', transform()),
      transformParent: createTransformParentBinding({
        childLocal: transform(),
        childWorld: transform(),
        parentItemId: 'a',
        parentWorld: transform(),
      }),
    }
    const items = new Map([a, b].map((item) => [item.id, item]))
    expect(wouldCreateTransformParentCycle('a', 'b', (id) => items.get(id))).toBe(true)
    expect(wouldCreateTransformParentCycle('a', 'a', (id) => items.get(id))).toBe(true)
    expect(wouldCreateTransformParentCycle('b', 'a', (id) => items.get(id))).toBe(false)
  })
})
