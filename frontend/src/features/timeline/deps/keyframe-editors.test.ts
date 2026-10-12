// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import * as keyframeEditors from './keyframe-editors'

describe('keyframe editor adapter', () => {
  it('loads every transitive export used by lazy timeline panels', () => {
    expect(keyframeEditors.DopesheetEditor).toBeDefined()
    expect(keyframeEditors.getEffectPropertyBaseValue).toBeTypeOf('function')
    expect(keyframeEditors.getAnimatablePropertiesForItem).toBeTypeOf('function')
    expect(keyframeEditors.resolveAnimatedShapeItem).toBeTypeOf('function')
  })
})
