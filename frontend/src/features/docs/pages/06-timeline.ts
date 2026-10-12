import type { DocPageContent } from '../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Basic Timeline Editing',
  description:
    'Tracks, adding clips, selection, split and join, deleting, snapping, markers, ranges, sequences, and zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Tracks',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Video tracks** hold visual items: video, images, text, shapes, captions, and adjustment layers.',
            '**Audio tracks** hold audio clips and the audio linked to video files.',
            'Add tracks with **Add Video Track** or **Add Audio Track** when you need more room.',
            'Track controls include **Lock**, **Solo**, **Enable/Disable** (visibility), and sync lock.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Track groups are one level deep and act as headers — mute, visibility, and lock flow from a group down to its tracks.',
        },
      ],
    },
    {
      title: 'Add and arrange clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Drag a clip from the Media panel onto a video or audio track.',
            'Use the **Selection** tool (`V`) to move and rearrange clips.',
            '**Linked selection** keeps a video clip and its audio moving together; unlink them to edit one alone.',
            'Nudge a selected item with `Shift+Arrow` (1px) or `Ctrl+Shift+Arrow` (10px).',
          ],
        },
      ],
    },
    {
      title: 'Split, join, and delete',
      blocks: [
        {
          kind: 'list',
          items: [
            'Split at the playhead with `Alt+C`, or use the **Razor** tool (`C`) to cut wherever you click.',
            'Join adjacent sections of the same clip with `Shift+J`.',
            '**Delete** leaves a gap; **Ripple Delete** (`Ctrl+Delete`) removes the clip and closes the gap.',
            'Use **Close All Gaps** to pull clips together and remove empty space on a track.',
          ],
        },
      ],
    },
    {
      title: 'Snapping, markers, and ranges',
      blocks: [
        {
          kind: 'list',
          items: [
            'Toggle snapping with `S` so clips snap to nearby cuts, markers, and the playhead.',
            'Add a marker with `M` for notes and timing references; jump between markers with `[` and `]`.',
            'Set an in point (`I`) and out point (`O`) to define a range for preview and export; clear them with `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Sequences (multi-timeline)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A **sequence** is a self-contained timeline with its own tracks, clips, markers, and in/out range. The tab bar above the timeline lists the **Main** timeline plus every sequence — click a tab to switch which one you are editing.',
        },
        {
          kind: 'list',
          items: [
            'Create a sequence with the **+** button at the end of the tab bar; it opens as its own tab.',
            'Switch sequences by clicking a tab; the **Main** tab is always first.',
            'Double-click a tab to **rename** it, or use the tab options menu (⋮) for **Rename**, **Close tab**, and **Delete sequence**.',
            '**Close tab** only removes the tab — the sequence stays available in the Media panel and in any clips that reference it. **Delete sequence** removes it entirely (undoable), along with any clips that reference it.',
            'A **compound clip** can be opened as a sequence tab — in the Media panel, right-click a compound clip and choose **Open as tab** to edit it as a standalone timeline.',
            'Drop a sequence onto the timeline to nest it as a clip (labelled **Sequence**); double-click that clip to jump to its tab.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Each sequence keeps its own markers, in/out range, view, and undo history — switching tabs never mixes them.',
        },
      ],
    },
    {
      title: 'Zoom and undo',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zoom with `Ctrl+=` and `Ctrl+-`, fit the whole edit with `\\`, and return to 100% with `Shift+\\`.',
            'Zoom changes only the view, never clip timing.',
            'Undo with `Ctrl+Z` and redo with `Ctrl+Shift+Z`; undo history depth is configurable in Settings.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
