import type { DocPageContent } from '../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Clip Properties',
  description:
    'Transform, crop, opacity and blend, and the type-specific controls for each kind of clip.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'How selection drives the panel',
      blocks: [
        {
          kind: 'list',
          items: [
            'Select one clip to edit its full set of properties.',
            'Select several clips to change a shared property on all of them at once.',
            'The panel shows tabs only for the property groups that apply to the current selection.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A **Mixed** value means the selected clips do not currently share that setting; changing it applies one value to all.',
        },
      ],
    },
    {
      title: 'Controls shared by visual clips',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Transform**: position, size, rotation, and anchor point.',
            '**Crop**: crop each edge inward, with a softness control for the crop edge.',
            '**Opacity** and **Blend**: fade a clip and choose how it composites over the layers below.',
            '**Video**: playback speed and related timing for video clips.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Many numeric controls can be animated — look for the keyframe toggle beside the value.',
        },
      ],
    },
    {
      title: 'Type-specific controls',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip type', 'Controls'],
          rows: [
            ['Audio', 'Gain, fade in/out, pitch, and a per-clip equalizer (see Audio Editing).'],
            [
              'Text',
              'Content, font, size, color, alignment, background, spacing, effects, and animation (see the Text page).',
            ],
            ['Shape', 'Shape type, path, fill, stroke, mask, and feather.'],
            ['Subtitle', 'Cue timing and text, plus caption style presets.'],
            ['Color', 'Wheels, curves, and grading tools (see Effects and Color).'],
          ],
        },
      ],
    },
    {
      title: 'Markers',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The properties panel lists every marker in the project under a **Markers** heading, sorted by time. The list is always available — it shows below the canvas settings when nothing is selected, and below the marker editor when a marker is selected — so you can browse and reach your markers regardless of what is selected.',
        },
        {
          kind: 'list',
          items: [
            'Each row shows the marker color, its label (or a default name if it has none), and its timecode.',
            'Select a row to make it the active marker and jump the playhead to that point.',
            'Use the trash icon on a row to remove that single marker.',
            '**Clear all** removes every marker at once.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Press `M` to drop a marker at the playhead. When the list is empty it shows this hint.',
        },
        {
          kind: 'paragraph',
          text: 'Selecting a marker opens its editor above the list, where you can change the **Frame** position, edit the **Label**, and set the **Color** from a preset swatch or reset it to the default. The **Time** field shows the marker timecode as read-only, and **Delete Marker** removes it.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
