import type { DocPageContent } from '../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Text, Captions, and Subtitles',
  description:
    'Add and style text clips, generate captions from a transcript, and import embedded subtitle tracks.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Three related things',
      blocks: [
        {
          kind: 'table',
          headers: ['Kind', 'What it is', 'Starts from'],
          rows: [
            ['Text clip', 'A standalone timeline item you type into', 'The Text tab'],
            ['Captions', 'Generated lines that ride on a video or audio clip', 'A clip transcript'],
            [
              'Subtitles',
              'A cue track on the timeline',
              'An embedded track, or consolidated captions',
            ],
          ],
        },
      ],
    },
    {
      title: 'Add and style a text clip',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the **Text** tab, then click **Add text** or a template to place text at the playhead — or drag a template onto the timeline or canvas.',
            'Choose a layout (**Single**, **2 Spans**, **3 Spans**) and a style preset such as Clean, Lower Third, Cinematic, or Neon.',
            'In the **Text** section set font, size (8–500 px), weight, color, background, alignment, spacing, line height, padding, and radius.',
            'Add shadow or stroke under **Effects**, and animate the text under **Text Animation**.',
          ],
        },
      ],
    },
    {
      title: 'Text animation',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In the **Text Animation** section (in text properties or the selected layer’s **Motion** library), each character, word, or line can animate independently. Text animation stays live and procedural, so there are no layer keyframes to manage.',
        },
        {
          kind: 'steps',
          items: [
            'Select a text clip and open the **Text Animation** section.',
            'Pick a preset in the **In**, **Out**, or **Loop** row. **In** plays at the clip start, **Out** at the clip end, and **Loop** runs continuously between them.',
            'Click the active preset again (or its ✕) to remove it — one preset per row.',
            'Tune the controls that appear under the active preset.',
            'In Motion, drag a text-motion band edge to change its duration, or drag an In or Out band away from the clip edge to offset it.',
          ],
        },
        {
          kind: 'table',
          headers: ['Control', 'What it does'],
          rows: [
            ['Applies to', 'The unit each preset animates: Character, Word, Line, or Whole clip.'],
            ['Duration', 'Length, in frames, of each unit’s animation.'],
            ['Stagger', 'Frames of delay between each unit, for a cascading effect.'],
            ['Order', 'Which unit animates first: Forward, Backward, Center out, or Random.'],
            ['Intensity', 'Scales the effect strength, from 0 to 200 percent.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'The **Applied** list shows each live text-motion slot. Select an entry to move the playhead to its timeline band.',
        },
      ],
    },
    {
      title: 'Captions from a transcript',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Generate a transcript for the clip from the Media library or the Transcript panel.',
            'Use **Generate Captions** (or let FreeCut enable transcript captions automatically) from the clip context menu.',
            'Edit cue timing and text, and pick a style preset (Netflix, YouTube, Bold Yellow, Outlined, TikTok) in the **Subtitle** section.',
            'Adjust caption color, size, vertical position, and an optional background.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use **Consolidate Captions To Segment** to turn transcript captions into a standalone subtitle segment.',
        },
      ],
    },
    {
      title: 'Embedded and imported subtitles',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Extract Embedded Subtitles** on a media card to scan a file for subtitle tracks.',
            'In the **Embedded subtitles** dialog, pick a track — each row shows its language, codec, and cue count.',
            'Insert the track to add its cues to the timeline as a subtitle segment.',
            'Edit each cue start, end, and text in the **Subtitle** section, and set whole-cue Italic, Bold, or Underline.',
          ],
        },
      ],
    },
    {
      title: 'Subtitles on export',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Turn on **Embed subtitles** in the export settings to include transcript captions as a subtitle track (MP4, MKV, WebM). Some players hide subtitle tracks by default, so viewers may need to switch them on.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
