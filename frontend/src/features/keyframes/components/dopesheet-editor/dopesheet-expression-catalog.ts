import type { DirectLinkableProperty } from '@/types/keyframe'

export type ExpressionPresetGroup = 'Adjust' | 'Motion' | 'Timing'

export interface ExpressionPreset {
  label: string
  source: string
  group: ExpressionPresetGroup
  description: string
}

const DEFAULT_SCALAR_PRESETS: readonly ExpressionPreset[] = [
  { label: 'Add 50', source: 'value + 50', group: 'Adjust', description: 'Add a fixed offset.' },
  {
    label: 'Subtract 50',
    source: 'value - 50',
    group: 'Adjust',
    description: 'Subtract a fixed offset.',
  },
  {
    label: 'Double',
    source: 'value * 2',
    group: 'Adjust',
    description: 'Double the authored value.',
  },
  {
    label: 'Half',
    source: 'value * 0.5',
    group: 'Adjust',
    description: 'Halve the authored value.',
  },
  {
    label: 'Clamp 0–100',
    source: 'clamp(value, 0, 100)',
    group: 'Adjust',
    description: 'Keep the result between 0 and 100.',
  },
  {
    label: 'Gentle oscillation',
    source: 'value + sin(time * 6.283) * 20',
    group: 'Motion',
    description: 'Move smoothly around the authored value once per second.',
  },
  {
    label: 'Fast oscillation',
    source: 'value + sin(time * 12.566) * 10',
    group: 'Motion',
    description: 'A smaller two-cycle-per-second oscillation.',
  },
  {
    label: 'Positive bounce',
    source: 'value + abs(sin(time * 6.283)) * 20',
    group: 'Motion',
    description: 'Bounce above the authored value.',
  },
  {
    label: 'Increase over time',
    source: 'value + time * 20',
    group: 'Timing',
    description: 'Add 20 units per second.',
  },
  {
    label: 'Increase by frame',
    source: 'value + frame * 2',
    group: 'Timing',
    description: 'Add two units for each composition frame.',
  },
  {
    label: 'Blend toward 100',
    source: 'lerp(value, 100, clamp(time / 2, 0, 1))',
    group: 'Timing',
    description: 'Blend toward 100 during the first two seconds.',
  },
]

const POSITION_PRESETS: readonly ExpressionPreset[] = [
  {
    label: 'Offset right',
    source: 'value + [100, 0]',
    group: 'Adjust',
    description: 'Move 100 px right.',
  },
  {
    label: 'Offset down',
    source: 'value + [0, 100]',
    group: 'Adjust',
    description: 'Move 100 px down.',
  },
  {
    label: 'Horizontal drift',
    source: 'value + [sin(time * 6.283) * 50, 0]',
    group: 'Motion',
    description: 'Drift left and right once per second.',
  },
  {
    label: 'Vertical bob',
    source: 'value + [0, sin(time * 6.283) * 50]',
    group: 'Motion',
    description: 'Bob vertically once per second.',
  },
  {
    label: 'Circular orbit',
    source: 'value + [cos(time * 6.283) * 100, sin(time * 6.283) * 100]',
    group: 'Motion',
    description: 'Orbit around the authored position.',
  },
  {
    label: 'Elliptical orbit',
    source: 'value + [cos(time * 6.283) * 140, sin(time * 6.283) * 60]',
    group: 'Motion',
    description: 'Follow a wide elliptical orbit.',
  },
  {
    label: 'Positive bounce',
    source: 'value + [0, abs(sin(time * 6.283)) * 80]',
    group: 'Motion',
    description: 'Bounce downward from the authored position.',
  },
  {
    label: 'Glide toward origin',
    source: 'lerp(value, [0, 0], clamp(time / 2, 0, 1))',
    group: 'Timing',
    description: 'Blend toward the composition origin over two seconds.',
  },
]

const ANCHOR_PRESETS: readonly ExpressionPreset[] = POSITION_PRESETS.map((preset) => ({
  ...preset,
  source: preset.source.replaceAll('100', '50').replaceAll('140', '70').replaceAll('80', '40'),
  description: preset.description.replaceAll('100 px', '50 px'),
}))

const SCALE_PRESETS: readonly ExpressionPreset[] = [
  {
    label: 'Enlarge 10%',
    source: 'value * 1.1',
    group: 'Adjust',
    description: 'Scale both axes up by 10%.',
  },
  {
    label: 'Shrink 10%',
    source: 'value * 0.9',
    group: 'Adjust',
    description: 'Scale both axes down by 10%.',
  },
  {
    label: 'Reset to 100%',
    source: '[100, 100]',
    group: 'Adjust',
    description: 'Return both axes to 100%.',
  },
  {
    label: 'Gentle breathe',
    source: 'value * (1 + sin(time * 6.283) * 0.05)',
    group: 'Motion',
    description: 'A subtle one-cycle-per-second scale pulse.',
  },
  {
    label: 'Strong pulse',
    source: 'value * (1 + sin(time * 6.283) * 0.15)',
    group: 'Motion',
    description: 'A pronounced scale pulse.',
  },
  {
    label: 'Positive pulse',
    source: 'value * (1 + abs(sin(time * 6.283)) * 0.15)',
    group: 'Motion',
    description: 'Pulse above the authored scale without shrinking.',
  },
  {
    label: 'Alternating axes',
    source: 'value * [1 + sin(time * 6.283) * 0.1, 1 + cos(time * 6.283) * 0.1]',
    group: 'Motion',
    description: 'Alternate the X and Y scale axes.',
  },
  {
    label: 'Grow over time',
    source: 'value * (1 + time * 0.05)',
    group: 'Timing',
    description: 'Grow by 5% of the authored scale per second.',
  },
  {
    label: 'Settle toward 100%',
    source: 'lerp(value, [100, 100], clamp(time / 2, 0, 1))',
    group: 'Timing',
    description: 'Blend both axes toward 100% over two seconds.',
  },
]

const ROTATION_PRESETS: readonly ExpressionPreset[] = [
  { label: 'Quarter turn', source: 'value + 90', group: 'Adjust', description: 'Add 90 degrees.' },
  { label: 'Half turn', source: 'value + 180', group: 'Adjust', description: 'Add 180 degrees.' },
  {
    label: 'Reverse',
    source: '-value',
    group: 'Adjust',
    description: 'Reverse the authored angle.',
  },
  {
    label: 'Clockwise spin',
    source: 'value + time * 45',
    group: 'Motion',
    description: 'Rotate clockwise at 45° per second.',
  },
  {
    label: 'Fast spin',
    source: 'value + time * 180',
    group: 'Motion',
    description: 'Rotate clockwise at 180° per second.',
  },
  {
    label: 'Counter-clockwise',
    source: 'value - time * 45',
    group: 'Motion',
    description: 'Rotate counter-clockwise at 45° per second.',
  },
  {
    label: 'Gentle swing',
    source: 'value + sin(time * 6.283) * 15',
    group: 'Motion',
    description: 'Swing 15° around the authored angle.',
  },
  {
    label: 'Fast wobble',
    source: 'value + sin(time * 18.849) * 6',
    group: 'Motion',
    description: 'A small three-cycle-per-second wobble.',
  },
  {
    label: 'Rotate by frame',
    source: 'value + frame * 2',
    group: 'Timing',
    description: 'Add two degrees per composition frame.',
  },
]

const OPACITY_PRESETS: readonly ExpressionPreset[] = [
  {
    label: 'Half opacity',
    source: 'value * 0.5',
    group: 'Adjust',
    description: 'Halve the authored opacity.',
  },
  {
    label: 'Invert opacity',
    source: '1 - value',
    group: 'Adjust',
    description: 'Invert a normalized opacity value.',
  },
  {
    label: 'Clamp valid range',
    source: 'clamp(value, 0, 1)',
    group: 'Adjust',
    description: 'Keep opacity between 0 and 1.',
  },
  {
    label: 'Gentle pulse',
    source: 'clamp(value + sin(time * 6.283) * 0.2, 0, 1)',
    group: 'Motion',
    description: 'Pulse opacity gently once per second.',
  },
  {
    label: 'Strong pulse',
    source: 'clamp(value + sin(time * 6.283) * 0.4, 0, 1)',
    group: 'Motion',
    description: 'Pulse opacity strongly once per second.',
  },
  {
    label: 'Soft blink',
    source: 'abs(sin(time * 3.142))',
    group: 'Motion',
    description: 'Fade between transparent and opaque every two seconds.',
  },
  {
    label: 'Rapid blink',
    source: 'abs(sin(time * 12.566))',
    group: 'Motion',
    description: 'Fade rapidly between transparent and opaque.',
  },
  {
    label: 'Fade out',
    source: 'clamp(value - time * 0.25, 0, 1)',
    group: 'Timing',
    description: 'Reduce opacity by 0.25 per second.',
  },
  {
    label: 'Fade in',
    source: 'clamp(value + time * 0.25, 0, 1)',
    group: 'Timing',
    description: 'Increase opacity by 0.25 per second.',
  },
]

const PERCENT_PRESETS: readonly ExpressionPreset[] = [
  {
    label: 'Clamp 0–100',
    source: 'clamp(value, 0, 100)',
    group: 'Adjust',
    description: 'Keep the value in a percentage-like range.',
  },
  {
    label: 'Half',
    source: 'value * 0.5',
    group: 'Adjust',
    description: 'Halve the authored value.',
  },
  {
    label: 'Gentle pulse',
    source: 'clamp(value + sin(time * 6.283) * 15, 0, 100)',
    group: 'Motion',
    description: 'Pulse within the 0–100 range.',
  },
  {
    label: 'Full ping-pong',
    source: 'abs(sin(time * 3.142)) * 100',
    group: 'Motion',
    description: 'Travel smoothly between 0 and 100.',
  },
  {
    label: 'Reveal over time',
    source: 'clamp(value + time * 20, 0, 100)',
    group: 'Timing',
    description: 'Increase by 20 per second, capped at 100.',
  },
]

const OFFSET_PRESETS: readonly ExpressionPreset[] = [
  {
    label: 'Quarter turn',
    source: 'value + 90',
    group: 'Adjust',
    description: 'Add a 90° path offset.',
  },
  {
    label: 'Continuous spin',
    source: 'value + time * 90',
    group: 'Motion',
    description: 'Rotate the path offset at 90° per second.',
  },
  {
    label: 'Fast spin',
    source: 'value + time * 360',
    group: 'Motion',
    description: 'Rotate the path offset once per second.',
  },
  {
    label: 'Gentle swing',
    source: 'value + sin(time * 6.283) * 45',
    group: 'Motion',
    description: 'Swing the path offset by 45°.',
  },
]

const PROPERTY_PRESETS: Partial<Record<DirectLinkableProperty, readonly ExpressionPreset[]>> = {
  position: POSITION_PRESETS,
  anchor: ANCHOR_PRESETS,
  scale: SCALE_PRESETS,
  rotation: ROTATION_PRESETS,
  opacity: OPACITY_PRESETS,
  trimPathStart: PERCENT_PRESETS,
  trimPathEnd: PERCENT_PRESETS,
  taperStartWidth: PERCENT_PRESETS,
  taperEndWidth: PERCENT_PRESETS,
  taperStartLength: PERCENT_PRESETS,
  taperEndLength: PERCENT_PRESETS,
  trimPathOffset: OFFSET_PRESETS,
}

export function getExpressionPresets(
  property: DirectLinkableProperty,
): readonly ExpressionPreset[] {
  return PROPERTY_PRESETS[property] ?? DEFAULT_SCALAR_PRESETS
}

export const EXPRESSION_GUIDE_SECTIONS = [
  { id: 'basics', label: 'Basics' },
  { id: 'functions', label: 'Functions' },
  { id: 'references', label: 'References' },
  { id: 'errors', label: 'Errors' },
  { id: 'recipes', label: 'Recipes' },
] as const

export type ExpressionGuideSectionId = (typeof EXPRESSION_GUIDE_SECTIONS)[number]['id']

export interface ExpressionGuideItem {
  title: string
  syntax: string
  description: string
}

export const EXPRESSION_GUIDE_ITEMS: Record<
  Exclude<ExpressionGuideSectionId, 'recipes'>,
  readonly ExpressionGuideItem[]
> = {
  basics: [
    {
      title: 'Current value',
      syntax: 'value',
      description: 'The property value before this expression.',
    },
    { title: 'Seconds', syntax: 'time', description: 'Composition time in seconds.' },
    { title: 'Frame', syntax: 'frame', description: 'The current composition frame.' },
    {
      title: 'Arithmetic',
      syntax: '+  -  *  /',
      description: 'Combine scalar or matching vector values.',
    },
    {
      title: 'Vector',
      syntax: '[x, y]',
      description: 'A two-axis value for Position, Scale, or Anchor.',
    },
  ],
  functions: [
    {
      title: 'Sine / cosine',
      syntax: 'sin(x)  cos(x)',
      description: 'Smooth repeating motion. One cycle is about 6.283 radians.',
    },
    {
      title: 'Absolute',
      syntax: 'abs(x)',
      description: 'Turn negative values positive; useful for bounces.',
    },
    {
      title: 'Minimum / maximum',
      syntax: 'min(a, b)  max(a, b)',
      description: 'Choose the lower or higher value.',
    },
    { title: 'Clamp', syntax: 'clamp(x, min, max)', description: 'Keep a result inside a range.' },
    {
      title: 'Interpolate',
      syntax: 'lerp(from, to, amount)',
      description: 'Blend between values; amount 0–1 stays between them.',
    },
  ],
  references: [
    {
      title: 'Property reference',
      syntax: 'prop("layer-id", "property")',
      description: 'Read a compatible property from a layer.',
    },
    {
      title: 'Pick property',
      syntax: 'Pick property',
      description: 'Click the picker, then choose a highlighted property row.',
    },
    {
      title: 'Add an offset',
      syntax: 'prop("…", "x") + 50',
      description: 'References can participate in normal arithmetic.',
    },
    {
      title: 'Value types',
      syntax: 'scalar ↔ scalar  ·  vector ↔ vector',
      description: 'References must return the same value shape as the target.',
    },
  ],
  errors: [
    {
      title: 'Wrong value type',
      syntax: '[x, y] vs number',
      description: 'A scalar property cannot return a vector, and vice versa.',
    },
    {
      title: 'Unavailable reference',
      syntax: 'prop("…", "…")',
      description: 'The referenced layer or property no longer exists.',
    },
    {
      title: 'Division by zero',
      syntax: 'value / 0',
      description: 'The previous value is kept and Apply stays disabled.',
    },
    {
      title: 'Unknown name',
      syntax: 'noise(time)',
      description: 'Only the names and functions listed here are supported.',
    },
    {
      title: 'Invalid draft',
      syntax: 'Apply disabled',
      description: 'Fix the inline error or Cancel without changing the saved expression.',
    },
  ],
}
