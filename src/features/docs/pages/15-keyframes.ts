import type { DocPageContent } from '../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Animate with keyframes',
  description:
    'Animate transform, crop, text, effect, and audio values with keyframes, easing, and the curve editor.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Choose where to edit keyframes',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Edit keeps keyframe work compact. Motion exposes the complete layer dope sheet and graph for deeper timing and curve work.',
        },
        {
          kind: 'table',
          headers: ['Surface', 'Keyframe workflow'],
          rows: [
            [
              'Edit',
              'Select a clip and press `K` to add a key for its active property. Open **Animation** in Properties for presets and applied status.',
            ],
            [
              'Motion',
              'Expand a layer for property rows, keyframe diamonds, segment easing, and an inline value graph.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'In Motion, the shared playhead, selection, snapping, ruler, property lanes, and graph use the same time axis.',
        },
      ],
    },
    {
      title: 'Add a keyframe',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Move the playhead to the frame you want to key.',
            'Type a value next to a parameter and press `Enter`, or click the **diamond** on the parameter row.',
            'Move to another frame and set a second value to create motion between them.',
            'Turn on **auto-key** with the timer icon, or press `A`, to capture later value changes automatically.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'You cannot add a keyframe inside a transition region, or with the playhead outside the clip bounds — the diamond is disabled there.',
        },
      ],
    },
    {
      title: 'What you can animate',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip type', 'Animatable values'],
          rows: [
            ['All visual clips', 'X / Y position, width, height, rotation, opacity, corner radius'],
            ['Video', 'Adds anchor point, the four crop edges, crop softness, and volume'],
            [
              'Text',
              'Adds preset scale, font size, line height, padding, background radius, shadow, and stroke',
            ],
            ['Audio', 'Volume in decibels'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Effects also contribute their own animatable parameters — look for the keyframe toggle beside each slider.',
        },
      ],
    },
    {
      title: 'Shape the motion',
      blocks: [
        {
          kind: 'list',
          items: [
            'Click the **connector** between two keyframes to open the **easing editor**.',
            'Browse preset curves under **Cubic Easing** and **Spring**. Filter by **All**, **In**, **Out**, or **In-Out**.',
            'Choose **Hold** to keep the earlier value until the next key.',
            'Switch to **Edit** to shape the curve directly: drag the two control handles on the graph, or type exact values. Springs expose **tension**, **friction**, and **mass** and preview their real bounce.',
            'Feel the timing on **Position**, **Scale**, **Rotate**, or **Opacity** in the live preview, and **Pause** the loop.',
            'Save a tweaked curve as a **custom preset** with **Save As**, **Update** it later, or **Reset** back to the preset it came from. Custom presets are stored on your device and appear in every project.',
            'Copy, cut, paste, and delete keyframes, marquee-select groups, drag to retime, and `Alt`-drag to duplicate.',
          ],
        },
      ],
    },
    {
      title: 'Work in the value graph',
      blocks: [
        {
          kind: 'list',
          items: [
            'Pick a property from the dropdown to edit its curve, or leave it on all to see the others as faded overlay curves. The keyframe count for the active property shows beside it.',
            'The graph draws a labelled **grid** — frames or seconds across, values up — so you can read positions at a glance.',
            'Frame the curve with **Fit to content**, or nudge the view with **Zoom in** / **Zoom out** and the mouse wheel. **Reset view** returns to the default fit.',
            'Step through keys with the **previous** / **next** arrows, then type an exact frame (**F**) and value (**V**) for the selected keyframe.',
            'While dragging a keyframe, hold **Shift** to lock it to one axis, or **Alt** to fine-adjust.',
          ],
        },
      ],
    },
    {
      title: 'Convert and clean generated motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Live behaviors such as drift, breath, shake, and spin evaluate during playback without creating property keys.',
        },
        {
          kind: 'list',
          items: [
            'Choose **Bake to keyframes** to convert live layer behaviors into editable keys.',
            'Use **Applied** to navigate to manual keys or a generated preset’s first frame.',
            'Use **Trim animation** when a clip trim leaves stored keys outside its visible duration.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Read [Apply and reuse motion](motion-library) for presets, live behaviors, text motion, baking, and saved animations.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
