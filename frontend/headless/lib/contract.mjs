import crypto from 'node:crypto'
import { z } from 'zod'

export const HEADLESS_API_VERSION = 1

const id = z.string().min(1)
// Unknown direction values render the transition window BLACK — reject at the wire.
const transitionDirection = z.enum(['from-left', 'from-right', 'from-top', 'from-bottom'])
const portableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const revisionSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const uuidV7Schema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const finite = z.number().finite()
const frame = z.number().int().nonnegative()
const positiveFrames = z.number().int().positive()
const projectObject = z.record(z.string(), z.unknown())
const params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
const imageFormat = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  z.enum(['png', 'jpg', 'jpeg', 'webp']),
)

const projectFrameFields = {
  project: id.optional(),
  projectObject: projectObject.optional(),
  frame: finite.nonnegative().optional(),
  at: finite.nonnegative().optional(),
  atSeconds: finite.nonnegative().optional(),
}

const hasExactlyOneProjectSource = (value) =>
  Boolean(value.project) !== Boolean(value.projectObject)

const GPU_EFFECT_TYPES = [
  'gpu-ascii',
  'gpu-block-glitch',
  'gpu-blocks',
  'gpu-box-blur',
  'gpu-brightness',
  'gpu-bulge',
  'gpu-chroma-key',
  'gpu-color-glitch',
  'gpu-color-wheels',
  'gpu-contrast',
  'gpu-crt',
  'gpu-curves',
  'gpu-dither',
  'gpu-droste',
  'gpu-edge-detect',
  'gpu-exposure',
  'gpu-fluted-glass',
  'gpu-gaussian-blur',
  'gpu-glass-mosaic',
  'gpu-glow',
  'gpu-gradient-map',
  'gpu-grain',
  'gpu-grayscale',
  'gpu-halftone',
  'gpu-hue-shift',
  'gpu-ink',
  'gpu-invert',
  'gpu-kaleidoscope',
  'gpu-levels',
  'gpu-lut',
  'gpu-mirror',
  'gpu-motion-blur',
  'gpu-pixelate',
  'gpu-pixel-sort',
  'gpu-pixel-sort-hq',
  'gpu-posterize',
  'gpu-power-window',
  'gpu-radial-blur',
  'gpu-rgb-split',
  'gpu-ripple-glass',
  'gpu-saturation',
  'gpu-scanlines',
  'gpu-secondary-qualifier',
  'gpu-sepia',
  'gpu-sharpen',
  'gpu-temperature',
  'gpu-threshold',
  'gpu-trigger-wave',
  'gpu-twirl',
  'gpu-vhs',
  'gpu-vibrance',
  'gpu-vignette',
  'gpu-wave',
  'gpu-zoom-blur',
]

const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'backgroundRadius',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
]
const animatableProperty = z.union([
  z.enum(ANIMATABLE_PROPERTIES),
  z.string().regex(/^effect:[^:]+:[^:]+:[^:]+$/, 'invalid effect keyframe property'),
])
const easing = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
])
const easingConfigSchema = z
  .object({
    type: easing,
    bezier: z.object({ x1: finite, y1: finite, x2: finite, y2: finite }).strict().optional(),
    spring: z
      .object({
        tension: z.number().min(0).max(500),
        friction: z.number().min(0).max(100),
        mass: z.number().min(0.1).max(10),
      })
      .strict()
      .optional(),
  })
  .strict()
const transform = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: finite.positive().optional(),
    height: finite.positive().optional(),
    anchorX: finite.optional(),
    anchorY: finite.optional(),
    rotation: finite.optional(),
    opacity: finite.min(0).max(1).optional(),
    cornerRadius: finite.nonnegative().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    aspectRatioLocked: z.boolean().optional(),
  })
  .strict()
const effect = z
  .object({
    type: z.literal('gpu-effect'),
    gpuEffectType: z.enum(GPU_EFFECT_TYPES),
    params: params.default({}),
  })
  .strict()

const opSchemas = [
  z
    .object({
      op: z.literal('addText'),
      id: id.optional(),
      text: z.string().optional(),
      from: frame.optional(),
      durationInFrames: positiveFrames.optional(),
      trackId: id.optional(),
      label: z.string().optional(),
      color: z.string().optional(),
      fontSize: finite.positive().optional(),
      fontFamily: z.string().min(1).optional(),
      fontWeight: z.enum(['medium', 'semibold', 'bold']).optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addItem'),
      item: z
        .object({
          type: id,
          trackId: id,
          from: frame,
          durationInFrames: positiveFrames,
          id: id.optional(),
        })
        .passthrough(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateItem'),
      id,
      updates: z
        .record(z.string(), z.unknown())
        .refine((value) => Object.keys(value).length > 0, 'updates must not be empty'),
    })
    .strict(),
  z.object({ op: z.literal('moveItem'), id, from: frame, trackId: id.optional() }).strict(),
  z
    .object({
      op: z.literal('removeItems'),
      ids: z.array(id).min(1),
      linked: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('split'), id, frame, linked: z.boolean().optional() }).strict(),
  z
    .object({
      op: z.literal('trimStart'),
      id,
      amount: positiveFrames,
      linked: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('trimEnd'),
      id,
      amount: positiveFrames,
      linked: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addTransition'),
      leftClipId: id,
      rightClipId: id,
      type: z.literal('crossfade').optional(),
      durationInFrames: positiveFrames.optional(),
      presentation: id.optional(),
      direction: transitionDirection.optional(),
      timing: id.optional(),
      alignment: z.number().min(0).max(1).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateTransition'),
      id,
      durationInFrames: positiveFrames.optional(),
      presentation: id.optional(),
      direction: transitionDirection.optional(),
      timing: id.optional(),
      alignment: z.number().min(0).max(1).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeTransition'), id }).strict(),
  z
    .object({
      op: z.literal('addTrack'),
      kind: z.enum(['video', 'audio']).optional(),
      order: finite.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addClip'),
      mediaId: id,
      from: frame.optional(),
      trackId: id.optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addKeyframe'),
      itemId: id,
      property: animatableProperty,
      frame,
      value: finite,
      easing: easing.optional(),
      easingConfig: easingConfigSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeKeyframes'), itemId: id, property: animatableProperty }).strict(),
  z
    .object({
      op: z.literal('setTransformParent'),
      id,
      parentItemId: id.nullable(),
      behavior: z.enum(['preserve-world', 'snap-to-parent', 'restore-local']).optional(),
      frame: frame.optional(),
    })
    .strict(),
  z.union([
    z.object({ op: z.literal('addEffect'), itemId: id, effect }).strict(),
    z
      .object({
        op: z.literal('addEffect'),
        itemId: id,
        gpuEffectType: z.enum(GPU_EFFECT_TYPES),
        params: params.optional(),
      })
      .strict(),
  ]),
  z.object({ op: z.literal('removeEffect'), itemId: id, effectId: id }).strict(),
  z
    .object({
      op: z.literal('setTransform'),
      id,
      transform: transform.refine(
        (value) => Object.keys(value).length > 0,
        'transform must not be empty',
      ),
    })
    .strict(),
]

export const EDIT_OPERATION_NAMES = [
  'addText',
  'addItem',
  'updateItem',
  'moveItem',
  'removeItems',
  'split',
  'trimStart',
  'trimEnd',
  'addTransition',
  'updateTransition',
  'removeTransition',
  'addTrack',
  'addClip',
  'addKeyframe',
  'removeKeyframes',
  'setTransformParent',
  'addEffect',
  'removeEffect',
  'setTransform',
]
const EDIT_OPERATION_DESCRIPTIONS = Object.fromEntries(
  EDIT_OPERATION_NAMES.map((name) => [name, samplesDescription(name)]),
)

function samplesDescription(name) {
  const descriptions = {
    addText: 'Add a text item',
    addItem: 'Add a complete timeline item',
    updateItem: 'Update an existing item',
    moveItem: 'Move an existing item',
    removeItems: 'Remove existing items atomically',
    split: 'Split an item at a frame',
    trimStart: 'Trim frames from an item start',
    trimEnd: 'Trim frames from an item end',
    addTransition: 'Add a transition between clips',
    updateTransition: 'Update an existing transition',
    removeTransition: 'Remove an existing transition',
    addTrack: 'Add a video or audio track',
    addClip: 'Add workspace media as a clip',
    addKeyframe: 'Add a property keyframe',
    removeKeyframes: 'Remove keyframes for a property',
    setTransformParent: 'Parent an item transform to another item (null detaches)',
    addEffect: 'Add a registered GPU effect',
    removeEffect: 'Remove an existing item effect',
    setTransform: 'Update an item transform',
  }
  return descriptions[name]
}
export const editOpSchema = z.union(opSchemas)
export const editRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    ops: z.array(editOpSchema).min(1),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const projectCreateRequestSchema = z
  .object({
    id: portableIdSchema.optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    width: z.number().int().min(320).max(7680).optional(),
    height: z.number().int().min(240).max(4320).optional(),
    fps: z.number().int().min(1).max(240).optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .strict()

const lifecycleTimelineSchema = z
  .object({
    tracks: z.array(z.unknown()),
    items: z.array(z.unknown()),
  })
  .passthrough()

const lifecycleProjectSchema = z
  .object({
    id: portableIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    duration: z.number().finite().nonnegative(),
    schemaVersion: z.number().int().positive().optional(),
    thumbnail: z.string().optional(),
    thumbnailId: z.string().optional(),
    rootFolderName: z.string().optional(),
    metadata: z
      .object({
        width: z.number().int().min(320).max(7680),
        height: z.number().int().min(240).max(4320),
        fps: z.number().int().min(1).max(240),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .strict(),
    timeline: lifecycleTimelineSchema.optional(),
  })
  .strict()

export const projectSaveRequestSchema = z
  .object({
    project: lifecycleProjectSchema,
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const projectUpdateRequestSchema = z
  .object({
    updates: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(240).max(4320).optional(),
        fps: z.number().int().min(1).max(240).optional(),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'updates must not be empty'),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const lifecycleEditRequestSchema = z
  .object({
    ops: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const callers = new Set()
    const referenceFields = new Set([
      'id',
      'ids',
      'itemId',
      'trackId',
      'leftClipId',
      'rightClipId',
      'effectId',
      'mediaId',
    ])
    for (let index = 0; index < value.ops.length; index++) {
      const callerId = value.ops[index]?.callerId
      if (typeof callerId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId is required and invalid',
          path: ['ops', index, 'callerId'],
        })
      } else if (callers.has(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId must be unique',
          path: ['ops', index, 'callerId'],
        })
      }
      const validateRefs = (input, field, path = []) => {
        if (Array.isArray(input)) {
          input.forEach((entry, itemIndex) => validateRefs(entry, field, [...path, itemIndex]))
        } else if (input && typeof input === 'object') {
          if ('$ref' in input) {
            const keys = Object.keys(input)
            const ref = input.$ref
            const match =
              typeof ref === 'string' ? /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref) : null
            if (
              keys.length !== 1 ||
              !referenceFields.has(field) ||
              !match ||
              !callers.has(match[1])
            ) {
              ctx.addIssue({
                code: 'custom',
                message: 'reference must target a prior callerId from an ID-valued field',
                path: ['ops', index, ...path],
              })
            }
            return
          }
          for (const [key, entry] of Object.entries(input)) validateRefs(entry, key, [...path, key])
        }
      }
      validateRefs(value.ops[index], undefined)
      const normalizeRefs = (input) => {
        if (Array.isArray(input)) return input.map(normalizeRefs)
        if (input && typeof input === 'object') {
          if (Object.keys(input).length === 1 && typeof input.$ref === 'string')
            return 'reference-id'
          return Object.fromEntries(
            Object.entries(input).map(([key, entry]) => [key, normalizeRefs(entry)]),
          )
        }
        return input
      }
      const { callerId: _callerId, ...wireOp } = value.ops[index]
      const parsed = editOpSchema.safeParse(normalizeRefs(wireOp))
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: ['ops', index, ...issue.path] })
      }
      if (typeof callerId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId))
        callers.add(callerId)
    }
    if (value.persist && !value.expectedRevision && value.force !== true) {
      ctx.addIssue({
        code: 'custom',
        message: 'expectedRevision is required for persisted edits unless force is true',
        path: ['expectedRevision'],
      })
    }
  })

export const mediaProbeRequestSchema = z
  .object({
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.persist || Boolean(value.expectedRevision) || value.force === true, {
    message: 'expectedRevision is required for persisted probes unless force is true',
    path: ['expectedRevision'],
  })

/** No NUL, no backslashes, no absolute/UNC/drive paths, no empty or dot segments. */
function refineWorkspaceRelativePath(value, ctx) {
  const invalid =
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith('//') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  if (invalid) ctx.addIssue({ code: 'custom', message: 'must be a safe workspace-relative path' })
}

const workspaceRelativeMediaPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .superRefine(refineWorkspaceRelativePath)

export const mediaImportRequestSchema = z
  .object({
    mediaId: portableIdSchema,
    sourceRelativePath: workspaceRelativeMediaPathSchema,
    expectedByteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 ** 3),
    expectedSha256: revisionSchema,
    projectId: portableIdSchema.optional(),
  })
  .strict()

const RENDER_OPTIONS = {
  codecs: ['h264', 'h265', 'vp9', 'vp8', 'av1'],
  containers: ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a'],
  qualities: ['low', 'medium', 'high', 'ultra'],
}
export const renderRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    out: id.optional(),
    codec: z.enum(RENDER_OPTIONS.codecs).optional(),
    container: z.enum(RENDER_OPTIONS.containers).optional(),
    resolution: z
      .string()
      .regex(/^(\d{1,5})x(\d{1,5})$/)
      .refine((value) => {
        const [w, h] = value.split('x').map(Number)
        return w >= 16 && h >= 16 && w <= 16384 && h <= 16384
      }, 'resolution dimensions must be between 16 and 16384')
      .optional(),
    fps: finite.min(1).max(240).optional(),
    quality: z.enum(RENDER_OPTIONS.qualities).optional(),
    inSec: finite.nonnegative().optional(),
    outSec: finite.positive().optional(),
    duration: finite.positive().optional(),
    audioOnly: z.boolean().optional(),
    strict: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })
  .refine((v) => !(v.outSec !== undefined && v.duration !== undefined), {
    message: 'outSec and duration are mutually exclusive',
    path: ['outSec'],
  })
  .refine((v) => v.outSec === undefined || v.outSec > (v.inSec ?? 0), {
    message: 'outSec must be greater than inSec',
    path: ['outSec'],
  })
  .refine((v) => !v.audioOnly || !v.container || ['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audioOnly requires an audio container',
    path: ['container'],
  })
  .refine((v) => v.audioOnly || !v.container || !['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audio containers require audioOnly',
    path: ['container'],
  })

export const frameRequestSchema = z
  .object({
    ...projectFrameFields,
    width: positiveFrames.max(16384).optional(),
    height: positiveFrames.max(16384).optional(),
    format: imageFormat.optional(),
    quality: finite.min(0).max(1).optional(),
  })
  .strict()
  .refine(hasExactlyOneProjectSource, {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const layoutRequestSchema = z
  .object(projectFrameFields)
  .strict()
  .refine(hasExactlyOneProjectSource, {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const CHECKPOINT_RECIPE_SCHEMA_VERSION = '1.1'

const checkpointReferenceSchema = z
  .object({
    $ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}#\/detail(?:\/[A-Za-z0-9_-]+)+$/),
  })
  .strict()
const checkpointResourceSchema = z.union([portableIdSchema, checkpointReferenceSchema])

const checkpointRecipeOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('addTrack'),
      kind: z.enum(['video', 'audio']).optional(),
      order: finite.optional(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('addClip'),
      mediaId: portableIdSchema,
      from: frame.optional(),
      trackId: checkpointResourceSchema.optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('moveItem'),
      id: checkpointResourceSchema,
      from: frame,
      trackId: checkpointResourceSchema.optional(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('removeItems'),
      ids: z.array(checkpointResourceSchema).min(1),
      linked: z.boolean(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('split'),
      id: checkpointResourceSchema,
      frame,
      linked: z.boolean(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('trimStart'),
      id: checkpointResourceSchema,
      amount: positiveFrames,
      linked: z.boolean(),
    })
    .strict(),
  z
    .object({
      callerId: portableIdSchema,
      op: z.literal('trimEnd'),
      id: checkpointResourceSchema,
      amount: positiveFrames,
      linked: z.boolean(),
    })
    .strict(),
])

const checkpointRecipeSchema = z
  .object({
    schemaVersion: z.literal(CHECKPOINT_RECIPE_SCHEMA_VERSION),
    operations: z.array(checkpointRecipeOperationSchema).min(1).max(1000),
    render: z
      .object({
        codec: z.enum(RENDER_OPTIONS.codecs).optional(),
        container: z.enum(RENDER_OPTIONS.containers).optional(),
        resolution: z
          .string()
          .regex(/^(\d{1,5})x(\d{1,5})$/)
          .refine((value) => {
            const [width, height] = value.split('x').map(Number)
            return width >= 16 && height >= 16 && width <= 16384 && height <= 16384
          }, 'resolution dimensions must be between 16 and 16384')
          .optional(),
        fps: finite.min(1).max(240).optional(),
        quality: z.enum(RENDER_OPTIONS.qualities).optional(),
        inSec: finite.nonnegative().optional(),
        outSec: finite.positive().optional(),
        duration: finite.positive().optional(),
        audioOnly: z.boolean().optional(),
        strict: z.boolean().optional(),
      })
      .strict()
      .refine((value) => !(value.outSec !== undefined && value.duration !== undefined), {
        message: 'outSec and duration are mutually exclusive',
        path: ['outSec'],
      })
      .refine((value) => value.outSec === undefined || value.outSec > (value.inSec ?? 0), {
        message: 'outSec must be greater than inSec',
        path: ['outSec'],
      })
      .refine(
        (value) =>
          !value.audioOnly || !value.container || ['mp3', 'wav', 'm4a'].includes(value.container),
        { message: 'audioOnly requires an audio container', path: ['container'] },
      )
      .refine(
        (value) =>
          value.audioOnly || !value.container || !['mp3', 'wav', 'm4a'].includes(value.container),
        { message: 'audio containers require audioOnly', path: ['container'] },
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const callers = new Map()
    const referenceTargets = {
      addTrack: [/^\/detail\/trackId$/],
      addClip: [/^\/detail\/created\/[0-9]+\/id$/],
      moveItem: [/^\/detail\/id$/],
      split: [/^\/detail\/(?:leftId|rightId)$/],
      trimStart: [/^\/detail\/id$/],
      trimEnd: [/^\/detail\/id$/],
    }
    const inspectReference = (entry, path) => {
      if (Array.isArray(entry)) {
        entry.forEach((item, index) => inspectReference(item, [...path, index]))
        return
      }
      if (!entry || typeof entry !== 'object') return
      if ('$ref' in entry) {
        const [callerId, pointer] = typeof entry.$ref === 'string' ? entry.$ref.split('#', 2) : []
        const priorOperation = callers.get(callerId)
        const allowedPointers = referenceTargets[priorOperation?.op] ?? []
        if (!priorOperation || !allowedPointers.some((pattern) => pattern.test(pointer))) {
          ctx.addIssue({
            code: 'custom',
            message: 'reference must target a known ID result from a prior recipe operation',
            path,
          })
        }
        return
      }
      for (const [key, item] of Object.entries(entry)) inspectReference(item, [...path, key])
    }
    value.operations.forEach((operation, index) => {
      inspectReference(operation, ['operations', index])
      if (callers.has(operation.callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId must be unique',
          path: ['operations', index, 'callerId'],
        })
      }
      callers.set(operation.callerId, operation)
    })
  })

export function canonicalJsonBytes(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize)
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.keys(entry)
          .sort()
          .map((key) => [key, normalize(entry[key])]),
      )
    }
    return entry
  }
  return Buffer.from(JSON.stringify(normalize(value)))
}

export const qualifiedSha256 = (bytes) =>
  `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`

export const checkpointRecipeJsonSchema = z.toJSONSchema(checkpointRecipeSchema, {
  target: 'draft-7',
})
export const CHECKPOINT_RECIPE_SCHEMA_SHA256 = qualifiedSha256(
  canonicalJsonBytes(checkpointRecipeJsonSchema),
)

const checkpointLegacyOperationRequestSchema = z
  .object({
    operationId: uuidV7Schema,
    projectId: portableIdSchema,
    expectedRevision: revisionSchema,
    recipe: checkpointRecipeSchema,
    recipeSha256: revisionSchema,
    outputRelativePath: z.string().min(1).max(1024),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (qualifiedSha256(canonicalJsonBytes(value.recipe)) !== value.recipeSha256) {
      ctx.addIssue({
        code: 'custom',
        message: 'recipeSha256 does not match the canonical recipe bytes',
        path: ['recipeSha256'],
      })
    }
  })

export const FINAL_RENDER_PROFILE = Object.freeze({
  id: 'shorts-h264-high-v1',
  codec: 'h264',
  container: 'mp4',
  quality: 'high',
  width: 1080,
  height: 1920,
  pixelFormat: 'yuv420p',
  frameRate: Object.freeze({ numerator: 25, denominator: 1 }),
  audioCodec: 'aac',
  audioSampleRateHz: 48000,
  audioChannels: 2,
})
export const FINAL_RENDER_PROFILE_SHA256 = qualifiedSha256(canonicalJsonBytes(FINAL_RENDER_PROFILE))

const finalRenderOperationRequestSchema = z
  .object({
    kind: z.literal('final_render'),
    operationId: uuidV7Schema,
    projectId: portableIdSchema,
    expectedRevision: revisionSchema,
    renderProfile: z
      .object({
        id: z.literal(FINAL_RENDER_PROFILE.id),
        codec: z.literal(FINAL_RENDER_PROFILE.codec),
        container: z.literal(FINAL_RENDER_PROFILE.container),
        quality: z.literal(FINAL_RENDER_PROFILE.quality),
        width: z.literal(FINAL_RENDER_PROFILE.width),
        height: z.literal(FINAL_RENDER_PROFILE.height),
        pixelFormat: z.literal(FINAL_RENDER_PROFILE.pixelFormat),
        frameRate: z
          .object({
            numerator: z.literal(FINAL_RENDER_PROFILE.frameRate.numerator),
            denominator: z.literal(FINAL_RENDER_PROFILE.frameRate.denominator),
          })
          .strict(),
        audioCodec: z.literal(FINAL_RENDER_PROFILE.audioCodec),
        audioSampleRateHz: z.literal(FINAL_RENDER_PROFILE.audioSampleRateHz),
        audioChannels: z.literal(FINAL_RENDER_PROFILE.audioChannels),
      })
      .strict(),
    renderProfileSha256: z.literal(FINAL_RENDER_PROFILE_SHA256),
    approvalBindingSha256: revisionSchema,
    outputRelativePath: z.string().min(1).max(1024),
  })
  .strict()

const withPortableOutputPath = (schema) =>
  schema.superRefine((value, ctx) => {
    const candidate = value.outputRelativePath
    const normalized = candidate.replace(/\\/g, '/')
    if (
      candidate.includes('\0') ||
      candidate.includes('\\') ||
      candidate.startsWith('/') ||
      /^\/?(?:[A-Za-z]:|\/{2}|[?.]\/{2})/.test(normalized) ||
      !normalized.startsWith('artifacts/') ||
      normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'outputRelativePath must be a contained portable relative path',
        path: ['outputRelativePath'],
      })
    }
  })

const portableCheckpointLegacyOperationRequestSchema = withPortableOutputPath(
  checkpointLegacyOperationRequestSchema,
)
const portableFinalRenderOperationRequestSchema = withPortableOutputPath(
  finalRenderOperationRequestSchema.superRefine((value, ctx) => {
    if (!value.outputRelativePath.endsWith('.mp4')) {
      ctx.addIssue({
        code: 'custom',
        message: 'final render outputRelativePath must end in .mp4',
        path: ['outputRelativePath'],
      })
    }
  }),
)

export const checkpointOperationRequestSchema = z.union([
  portableCheckpointLegacyOperationRequestSchema,
  portableFinalRenderOperationRequestSchema,
])

const FINAL_RENDER_OPERATION_JSON_SCHEMA = Object.freeze({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    kind: { const: 'final_render' },
    operationId: {
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
    projectId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' },
    expectedRevision: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    renderProfile: { const: FINAL_RENDER_PROFILE },
    renderProfileSha256: { const: FINAL_RENDER_PROFILE_SHA256 },
    approvalBindingSha256: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    outputRelativePath: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
      pattern: '^artifacts/(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\u0000).+\\.mp4$',
    },
  },
  required: [
    'kind',
    'operationId',
    'projectId',
    'expectedRevision',
    'renderProfile',
    'renderProfileSha256',
    'approvalBindingSha256',
    'outputRelativePath',
  ],
  additionalProperties: false,
})

export function normalizeRenderInput(value) {
  const out = { ...value }
  if (out.in !== undefined) out.inSec = Number(out.in)
  if (out['out-sec'] !== undefined) out.outSec = Number(out['out-sec'])
  if (out['audio-only'] !== undefined) out.audioOnly = Boolean(out['audio-only'])
  if (out.strict !== undefined) out.strict = Boolean(out.strict)
  delete out.in
  delete out['out-sec']
  delete out['audio-only']
  for (const key of ['fps', 'duration']) if (out[key] !== undefined) out[key] = Number(out[key])
  return out
}

export class ContractValidationError extends Error {
  constructor(message, fields) {
    super(message)
    this.name = 'ContractValidationError'
    this.code = 'VALIDATION_ERROR'
    this.fields = fields
  }
}

export function validate(schema, value) {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
    code: issue.code,
  }))
  throw new ContractValidationError('Request validation failed', fields)
}

export function capabilities() {
  return {
    apiVersion: HEADLESS_API_VERSION,
    operations: EDIT_OPERATION_NAMES,
    operationDescriptions: EDIT_OPERATION_DESCRIPTIONS,
    options: {
      ...RENDER_OPTIONS,
      gpuEffects: GPU_EFFECT_TYPES,
      animatableProperties: ANIMATABLE_PROPERTIES,
    },
    schemas: {
      render: z.toJSONSchema(renderRequestSchema, { target: 'draft-7' }),
      frame: z.toJSONSchema(frameRequestSchema, { target: 'draft-7' }),
      layout: z.toJSONSchema(layoutRequestSchema, { target: 'draft-7' }),
      edit: z.toJSONSchema(editRequestSchema, { target: 'draft-7' }),
      projectCreate: z.toJSONSchema(projectCreateRequestSchema, { target: 'draft-7' }),
      projectSave: z.toJSONSchema(projectSaveRequestSchema, { target: 'draft-7' }),
      projectUpdate: z.toJSONSchema(projectUpdateRequestSchema, { target: 'draft-7' }),
      lifecycleEdit: z.toJSONSchema(lifecycleEditRequestSchema, { target: 'draft-7' }),
      mediaProbe: z.toJSONSchema(mediaProbeRequestSchema, { target: 'draft-7' }),
      mediaImport: z.toJSONSchema(mediaImportRequestSchema, { target: 'draft-7' }),
      checkpointOperation: z.toJSONSchema(portableCheckpointLegacyOperationRequestSchema, {
        target: 'draft-7',
      }),
      finalRenderOperation: FINAL_RENDER_OPERATION_JSON_SCHEMA,
    },
    checkpointRecipe: {
      schemaVersion: CHECKPOINT_RECIPE_SCHEMA_VERSION,
      schemaSha256: CHECKPOINT_RECIPE_SCHEMA_SHA256,
      schema: checkpointRecipeJsonSchema,
      canonicalization: 'sorted-object-keys-json-utf8',
    },
    finalRender: {
      kind: 'final_render',
      renderProfileSha256: FINAL_RENDER_PROFILE_SHA256,
      approvalBinding: 'sha256',
      phases: [
        'queued',
        'revision_verified',
        'rendering',
        'artifact_committed',
        'succeeded',
        'failed',
      ],
      artifactMediaProbeKeys: [
        'width',
        'height',
        'durationMillis',
        'videoCodec',
        'pixelFormat',
        'frameRate',
        'audioCodec',
        'audioSampleRateHz',
        'audioChannels',
      ],
    },
    lifecycle: {
      routes: [
        'GET /v1/capabilities',
        'GET /v1/status',
        'POST /v1/projects',
        'GET /v1/projects',
        'GET /v1/projects/:id',
        'PUT /v1/projects/:id',
        'PATCH /v1/projects/:id',
        'POST /v1/projects/:id/edit',
        'GET /v1/media',
        'POST /v1/media/import',
        'GET /v1/media/:id',
        'POST /v1/media/:id/probe',
        'POST /v1/render',
        'POST /v1/checkpoint-operations',
        'GET /v1/checkpoint-operations/:id',
      ],
      httpMediaUpload: false,
      workspaceMediaImport: true,
      deleteProject: false,
      writerMode: 'exclusive',
      status: {
        transport: 'poll',
        route: 'GET /v1/status',
        renderProgress: true,
      },
      limits: {
        projectJsonBytes: 16 * 1024 * 1024,
        mediaMetadataBytes: 2 * 1024 * 1024,
        editOps: 1000,
        localMediaBytes: 20 * 1024 ** 3,
      },
      deprecatedRoutes: ['/capabilities', '/projects', '/render', '/edit'],
    },
  }
}
