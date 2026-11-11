import { describe, expect, it } from 'vitest'
import {
  cameraAt,
  examplePrevisScene,
  normalizePrevisScene,
  parsePrevisAnswer,
  poseAt,
  previsInstruction,
} from './previs-scene'

describe('previs scene', () => {
  it('reads a fenced answer and keeps the example as it is', () => {
    const example = examplePrevisScene()
    expect(parsePrevisAnswer('```json\n' + JSON.stringify(example) + '\n```')).toEqual(example)
  })

  it('names what is wrong in a scene', () => {
    const example = examplePrevisScene()
    expect(() => normalizePrevisScene({ ...example, extra: 1 })).toThrow('unknown fields extra')
    expect(() => normalizePrevisScene({ ...example, camera: [example.camera[0]] })).toThrow(
      'keys at 0 and at the last second',
    )
    expect(() =>
      normalizePrevisScene({ ...example, objects: [{ ...example.objects[0], shape: 'mesh' }] }),
    ).toThrow('the shape of object 1')
    expect(() =>
      normalizePrevisScene({ ...example, objects: [example.objects[0], example.objects[0]] }),
    ).toThrow('share an id')
    expect(() =>
      normalizePrevisScene({
        ...example,
        camera: [
          { ...example.camera[0], target: example.camera[0]!.position },
          example.camera.at(-1),
        ],
      }),
    ).toThrow('looks at itself')
    expect(() => parsePrevisAnswer('Sure! Here is the scene.')).toThrow(
      'did not answer with a scene',
    )
  })

  it('keeps an opacity only where one is given and knows a seated person', () => {
    const example = examplePrevisScene()
    const glass = { ...example.objects[0]!, id: 'glass', shape: 'box', opacity: 0.2 }
    const sitting = { ...example.objects[0]!, id: 'guest', shape: 'seated' }
    const scene = normalizePrevisScene({
      ...example,
      objects: [...example.objects, glass, sitting],
    })
    expect(scene.objects.find((each) => each.id === 'glass')?.opacity).toBe(0.2)
    expect('opacity' in scene.objects[0]!).toBe(false)
    expect(scene.objects.find((each) => each.id === 'guest')?.shape).toBe('seated')
    expect(() => normalizePrevisScene({ ...example, objects: [{ ...glass, opacity: 0 }] })).toThrow(
      'the opacity of object 1',
    )
  })

  it('moves the camera and the objects between their keys', () => {
    const scene = { ...examplePrevisScene(), easing: 'linear' as const }
    expect(cameraAt(scene, 0).position).toEqual([0, 1.6, 7])
    expect(cameraAt(scene, 1.5).position[2]).toBeCloseTo(4.8)
    expect(cameraAt(scene, 99).lens).toBe(50)
    const hero = scene.objects.find((each) => each.id === 'hero')!
    expect(poseAt(hero, 3, false).position[2]).toBeCloseTo(0.5)
    expect(poseAt(hero, 3, true).position[2]).toBeCloseTo(0.5)
    expect(poseAt(hero, 1, true).position[2]).toBeGreaterThan(poseAt(hero, 1, false).position[2])
  })

  it('asks to change the current scene when there is one', () => {
    expect(previsInstruction('16:9', null)).toContain('The frame is 16:9')
    expect(previsInstruction('9:16', examplePrevisScene())).toContain('That is the current scene')
  })
})
