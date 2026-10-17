/**
 * A 3D blocking of a shot, as AIMovieStudio's previs and AI Canvas's director desk make one: stand-in shapes and
 * figures on a floor, their moves and the camera's path over the shot's seconds, so the framing and the motion
 * are settled before a paid generation. A language model writes the scene from words; the person or an agent may
 * write it by hand. Metres, Y up, right-handed; a figure stands on its position.
 */

export type PrevisVector = [number, number, number]
export type PrevisShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'figure' | 'seated'
export type PrevisView = 'camera' | 'top' | 'orbit'

export interface PrevisPose {
  time: number
  position: PrevisVector
  /** Degrees about X, Y, Z. */
  rotation: PrevisVector
}

export interface PrevisObject {
  id: string
  name: string
  shape: PrevisShape
  position: PrevisVector
  rotation: PrevisVector
  /** Width, height, depth. */
  size: PrevisVector
  color: string
  /** Below 1 for glass, water and haze, seen through. */
  opacity?: number
  /** Where it is at moments of the shot; empty for what stands still. */
  moves: PrevisPose[]
}

export interface PrevisCameraKey {
  time: number
  position: PrevisVector
  /** The point the camera looks at. */
  target: PrevisVector
  /** Millimetres of a full-frame lens. */
  lens: number
}

export interface PrevisScene {
  version: 1
  title: string
  seconds: number
  /** `smooth` eases in and out of every key; `linear` moves at an even pace. */
  easing: 'linear' | 'smooth'
  sky: string
  floor: string
  objects: PrevisObject[]
  camera: PrevisCameraKey[]
}

const SHAPES: readonly PrevisShape[] = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'plane',
  'figure',
  'seated',
]
const PREVIS_MAX_SECONDS = 30
const MAX_OBJECTS = 64
const MAX_KEYS = 64

function bad(what: string): never {
  throw new Error(`the scene is not valid: ${what}`)
}

function objectOf(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(`${what} is not an object`)
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !keys.includes(key))
  if (unknown.length > 0) bad(`${what} has unknown fields ${unknown.join(', ')}`)
  return record
}

function numberOf(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    bad(`${what} must be a number from ${min} to ${max}`)
  return value
}

function textOf(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    bad(`${what} must be text of 1 to ${max} characters`)
  return value.trim()
}

function colorOf(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))
    bad(`${what} must be a color as #rrggbb`)
  return value.toLowerCase()
}

function vectorOf(value: unknown, min: number, max: number, what: string): PrevisVector {
  if (!Array.isArray(value) || value.length !== 3) bad(`${what} must be three numbers`)
  return value.map((each) => numberOf(each, min, max, what)) as PrevisVector
}

function listOf(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) bad(`${what} must be a list of at most ${max}`)
  return value
}

function inOrder<T extends { time: number }>(keys: T[], seconds: number, what: string): T[] {
  keys.forEach((key, index) => {
    if (key.time > seconds || (index > 0 && key.time <= keys[index - 1]!.time))
      bad(`the times of ${what} must grow and stay within the shot`)
  })
  return keys
}

/** The scene as the window draws it, or an error naming what is wrong in it. */
export function normalizePrevisScene(value: unknown): PrevisScene {
  const raw = objectOf(
    value,
    ['version', 'title', 'seconds', 'easing', 'sky', 'floor', 'objects', 'camera'],
    'the scene',
  )
  if (raw.version !== 1) bad('version must be 1')
  const seconds = numberOf(raw.seconds, 1, PREVIS_MAX_SECONDS, 'seconds')
  if (raw.easing !== 'linear' && raw.easing !== 'smooth') bad('easing must be linear or smooth')
  const objects = listOf(raw.objects, MAX_OBJECTS, 'objects').map((each, index): PrevisObject => {
    const what = `object ${index + 1}`
    const item = objectOf(
      each,
      ['id', 'name', 'shape', 'position', 'rotation', 'size', 'color', 'opacity', 'moves'],
      what,
    )
    const id = textOf(item.id, 64, `the id of ${what}`)
    if (!/^[\w-]+$/.test(id)) bad(`the id of ${what} may hold only letters, digits, - and _`)
    if (!SHAPES.includes(item.shape as PrevisShape))
      bad(`the shape of ${what} must be one of ${SHAPES.join(', ')}`)
    const moves = listOf(item.moves ?? [], MAX_KEYS, `the moves of ${what}`).map(
      (move): PrevisPose => {
        const pose = objectOf(move, ['time', 'position', 'rotation'], `a move of ${what}`)
        return {
          time: numberOf(pose.time, 0, seconds, `the time of a move of ${what}`),
          position: vectorOf(pose.position, -500, 500, `the position of a move of ${what}`),
          rotation: vectorOf(pose.rotation, -3600, 3600, `the rotation of a move of ${what}`),
        }
      },
    )
    return {
      id,
      name: textOf(item.name, 100, `the name of ${what}`),
      shape: item.shape as PrevisShape,
      position: vectorOf(item.position, -500, 500, `the position of ${what}`),
      rotation: vectorOf(item.rotation, -3600, 3600, `the rotation of ${what}`),
      size: vectorOf(item.size, 0.01, 500, `the size of ${what}`),
      color: colorOf(item.color, `the color of ${what}`),
      ...(item.opacity === undefined
        ? {}
        : { opacity: numberOf(item.opacity, 0.05, 1, `the opacity of ${what}`) }),
      moves: inOrder(moves, seconds, `the moves of ${what}`),
    }
  })
  if (objects.length === 0) bad('it has no object')
  if (new Set(objects.map((each) => each.id)).size !== objects.length)
    bad('two objects share an id')
  const camera = listOf(raw.camera, MAX_KEYS, 'camera').map((each, index): PrevisCameraKey => {
    const key = objectOf(each, ['time', 'position', 'target', 'lens'], `camera key ${index + 1}`)
    const position = vectorOf(key.position, -500, 500, `the position of camera key ${index + 1}`)
    const target = vectorOf(key.target, -500, 500, `the target of camera key ${index + 1}`)
    if (
      Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 0.01
    )
      bad(`camera key ${index + 1} looks at itself`)
    return {
      time: numberOf(key.time, 0, seconds, `the time of camera key ${index + 1}`),
      position,
      target,
      lens: numberOf(key.lens, 12, 200, `the lens of camera key ${index + 1}`),
    }
  })
  inOrder(camera, seconds, 'the camera keys')
  if (camera.length < 2 || camera[0]!.time !== 0 || camera.at(-1)!.time !== seconds)
    bad('the camera needs keys at 0 and at the last second')
  return {
    version: 1,
    title: textOf(raw.title, 120, 'title'),
    seconds,
    easing: raw.easing,
    sky: colorOf(raw.sky, 'sky'),
    floor: colorOf(raw.floor, 'floor'),
    objects,
    camera,
  }
}

/** A model's answer as a scene: the JSON inside it, fenced or not. */
export function parsePrevisAnswer(text: string): PrevisScene {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error(`the model did not answer with a scene: ${text.slice(0, 200)}`)
  }
  return normalizePrevisScene(value)
}

/** A figure walking down a corridor, the camera following behind and coming round in front. */
export function examplePrevisScene(): PrevisScene {
  return normalizePrevisScene({
    version: 1,
    title: 'Corridor follow',
    seconds: 6,
    easing: 'smooth',
    sky: '#1d1b2e',
    floor: '#3a3748',
    objects: [
      {
        id: 'wall-left',
        name: 'Left wall',
        shape: 'box',
        position: [-2.2, 1.5, 0],
        rotation: [0, 0, 0],
        size: [0.2, 3, 14],
        color: '#6b6880',
        moves: [],
      },
      {
        id: 'wall-right',
        name: 'Right wall',
        shape: 'box',
        position: [2.2, 1.5, 0],
        rotation: [0, 0, 0],
        size: [0.2, 3, 14],
        color: '#6b6880',
        moves: [],
      },
      {
        id: 'door',
        name: 'Door',
        shape: 'box',
        position: [0, 1.1, -6.8],
        rotation: [0, 0, 0],
        size: [1.2, 2.2, 0.1],
        color: '#a78bfa',
        moves: [],
      },
      {
        id: 'hero',
        name: 'Hero',
        shape: 'figure',
        position: [0, 0, 4],
        rotation: [0, 180, 0],
        size: [0.5, 1.75, 0.35],
        color: '#fbbf24',
        moves: [
          { time: 0, position: [0, 0, 4], rotation: [0, 180, 0] },
          { time: 6, position: [0, 0, -3], rotation: [0, 180, 0] },
        ],
      },
    ],
    camera: [
      { time: 0, position: [0, 1.6, 7], target: [0, 1.3, 4], lens: 35 },
      { time: 3, position: [0.4, 1.6, 2.6], target: [0, 1.3, 0.2], lens: 35 },
      { time: 4.5, position: [1.9, 1.5, -0.4], target: [0, 1.3, -1.4], lens: 40 },
      { time: 6, position: [0, 1.55, -6.3], target: [0, 1.35, -2.8], lens: 50 },
    ],
  })
}

/** What the language model is asked to write the scene from words, changing the current one when there is one. */
export function previsInstruction(aspect: string, current: PrevisScene | null): string {
  return [
    'You are a cinematographer blocking a shot in 3D before it is filmed. Turn the description into a scene of simple stand-in shapes and answer with one JSON object only: no comments, no code fences, no other fields.',
    'Coordinates are metres, Y is up, the floor is at Y=0. A "figure" is a standing person: its position is its feet, rotation [0, 180, 0] faces -Z; its size is about [0.5, 1.75, 0.35] for an adult. A "seated" is a person sitting, with the same standing size: its position is the floor under its hips, so put it on the seat of a chair, its back to the back of the chair. Other shapes are centred on their position and scaled by size (width, height, depth); rotation is in degrees.',
    'Build the place from boxes, planes, cylinders, cones and spheres (walls, tables, cars, trees as rough volumes); keep it small, at most 64 objects. Colors are #rrggbb; give people warm distinct colors and the set muted ones. Shapes are solid: give glass, water and haze an opacity of 0.15 to 0.4 so the camera sees through them, and never put a solid shape between the camera and what it films.',
    'moves are poses at moments of the shot, times growing within seconds; empty for what stands still. The camera is a list of keys at moments: position, target (the point it looks at) and lens in millimetres of a full-frame camera (12 to 200). The first camera key is at time 0, the last at seconds. A move around something needs at least four keys along the arc. Keep the camera out of walls and people and never at its target.',
    `The frame is ${aspect}. seconds is 1 to ${PREVIS_MAX_SECONDS}. easing is "smooth" (moves ease in and out) or "linear" (an even pace).`,
    'The form, to change by the description:',
    JSON.stringify(current ?? examplePrevisScene()),
    current
      ? 'That is the current scene: change it by the description and keep what the description does not touch.'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function between<T extends { time: number }>(
  keys: T[],
  time: number,
  smooth: boolean,
): { from: T; to: T; share: number } {
  const first = keys[0]!
  if (time <= first.time) return { from: first, to: first, share: 0 }
  for (let index = 1; index < keys.length; index++) {
    const to = keys[index]!
    if (time <= to.time) {
      const from = keys[index - 1]!
      const linear = (time - from.time) / (to.time - from.time)
      return { from, to, share: smooth ? linear * linear * (3 - 2 * linear) : linear }
    }
  }
  const last = keys.at(-1)!
  return { from: last, to: last, share: 0 }
}

function mix(a: PrevisVector, b: PrevisVector, share: number): PrevisVector {
  return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share]
}

/** Where the camera is and what it looks at, at a moment of the shot. */
export function cameraAt(scene: PrevisScene, time: number): PrevisCameraKey {
  const { from, to, share } = between(scene.camera, time, scene.easing === 'smooth')
  return {
    time,
    position: mix(from.position, to.position, share),
    target: mix(from.target, to.target, share),
    lens: from.lens + (to.lens - from.lens) * share,
  }
}

/** Where an object is, at a moment of the shot. */
export function poseAt(object: PrevisObject, time: number, smooth: boolean): PrevisPose {
  if (object.moves.length === 0)
    return { time, position: object.position, rotation: object.rotation }
  const { from, to, share } = between(object.moves, time, smooth)
  return {
    time,
    position: mix(from.position, to.position, share),
    rotation: mix(from.rotation, to.rotation, share),
  }
}
