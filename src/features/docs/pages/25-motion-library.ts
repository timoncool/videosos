import type { DocPageContent } from '../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Apply and reuse motion',
  description:
    'Apply editable presets, add live behaviors, adjust text motion, and save animation for reuse.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Choose the right animation surface',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut uses one animation system in two places. Use the compact **Animation** tab while editing a sequence clip, or open **Motion** for layered composition work.',
        },
        {
          kind: 'table',
          headers: ['Surface', 'Use it for'],
          rows: [
            [
              'Edit > Animation',
              'Common presets, applied-animation status, text motion, and creating or reopening a Motion Clip',
            ],
            [
              'Motion > Motion Library',
              'The full preset catalog, live behaviors, saved animations, and selected-layer controls',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Select one or more Edit clips and choose **Create Motion Clip** to preserve them inside a layered composition. Select an existing Motion Clip and choose **Open in Motion** to edit its layers.',
        },
      ],
    },
    {
      title: 'Apply an editable preset',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Select one or more clips or Motion layers.',
            'Choose a preset under **Entrance**, **Exit**, or **Emphasis**.',
            'Set **On apply** to **Replace** to swap motion with the same intent, or **Add** to keep existing keyframes.',
            'Open the property rows or value graph to adjust the generated keyframes.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'The **Applied** section lists manual keyframes and each preset application separately. Select an entry to move the playhead to its first keyframe.',
        },
      ],
    },
    {
      title: 'Add a live behavior',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Live behaviors evaluate during playback without creating keyframes. Leave them live for adjustable motion, or bake them when you need frame-level control.',
        },
        {
          kind: 'table',
          headers: ['Behavior', 'Result'],
          rows: [
            ['Float drift', 'Offsets position and rotation'],
            ['Sway', 'Rotates back and forth'],
            ['Breath pulse', 'Changes size and opacity'],
            ['Spin', 'Rotates continuously'],
            ['Micro shake', 'Adds seeded position and rotation jitter'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Select a behavior tile to apply it with default settings.',
            'Adjust **Intensity** and **Duration** from its applied controls.',
            'Read the hatched band in the Motion timeline to see where procedural motion runs.',
            'Apply a behavior to several clips to offset their phases instead of moving every clip in lockstep.',
          ],
        },
      ],
    },
    {
      title: 'Adjust text motion on the timeline',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Text motion animates characters, words, lines, or the whole clip through live **In**, **Out**, and **Loop** slots.',
        },
        {
          kind: 'list',
          items: [
            'Select a text clip, then choose a preset for each slot in the **Animation** tab or Motion Library.',
            'Drag a text-motion band edge in Motion to change its duration.',
            'Drag an **In** or **Out** band away from the clip edge to offset its start or end.',
            'Select its **Applied** entry to move the playhead to the band.',
          ],
        },
      ],
    },
    {
      title: 'Review and clean applied animation',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Applied** to distinguish manual keyframes, generated keyframes, live behaviors, and text motion.',
            'Remove one preset application without deleting unrelated keyframes.',
            'Remove a live behavior or text-motion slot from its own row.',
            'When a trim leaves keys outside the clip, use **Trim animation** to delete only those parked keyframes.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Trim animation** changes stored animation. Use the toast action or Undo if you need the removed keys back.',
        },
      ],
    },
    {
      title: 'Bake, save, and reuse motion',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Choose **Bake to keyframes** to sample live layer behaviors into editable property keys.',
            'Select a clip with the animation you want to keep.',
            'Choose **Save Animation**, enter a name, and save it to the project library.',
            'Apply the saved animation to another compatible clip or layer.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Saved animations can include editable keyframes, live layer behaviors, text motion, or a combination. Exported projects carry their saved animation library.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
