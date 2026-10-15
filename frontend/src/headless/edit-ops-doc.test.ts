import { describe, expect, it } from 'vitest'
import documented from '../../../crates/vs-server/src/edit-ops.json'
import type { EditOp, EditOperationName } from './edit-op-support'
import { applyOp } from './edit-ops'

const HANDLED: Record<EditOperationName, true> = {
  addText: true,
  addItem: true,
  updateItem: true,
  moveItem: true,
  removeItems: true,
  split: true,
  trimStart: true,
  trimEnd: true,
  addTransition: true,
  updateTransition: true,
  removeTransition: true,
  addTrack: true,
  addClip: true,
  replaceMedia: true,
  addKeyframe: true,
  removeKeyframes: true,
  setTransformParent: true,
  addEffect: true,
  removeEffect: true,
  setTransform: true,
  addShape: true,
  updateTrack: true,
  removeTrack: true,
  addMarker: true,
  updateMarker: true,
  removeMarker: true,
}

describe('the edit operations an agent is told of', () => {
  const names = documented.ops.map((op) => op.op)

  it('are every operation the window handles, each once', () => {
    expect([...names].sort()).toEqual(Object.keys(HANDLED).sort())
  })

  it('are each one the window knows', () => {
    for (const name of names) {
      let problem = ''
      try {
        applyOp({ op: name } as EditOp)
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error)
      }
      expect(problem, name).not.toContain('Unknown edit op')
    }
  })
})
