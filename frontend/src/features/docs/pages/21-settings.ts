import type { DocPageContent } from '../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Settings',
  description:
    'The General, Timeline, AI, and Storage tabs, plus where language and shortcuts are set.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'The four tabs',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'What you set'],
          rows: [
            [
              'General',
              'Auto-save on/off and interval (5–30 min); undo history depth (10–200 steps); interface sounds (on/off, volume, sound theme).',
            ],
            [
              'Timeline',
              'Snap by default; show waveforms and filmstrips; extract filmstrips on import.',
            ],
            ['AI', 'Caption sample interval (seconds or frames); default caption style.'],
            [
              'Storage',
              'Generate missing proxies; clear project cache; regenerate thumbnails; delete proxies; manage Local AI.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Clearing the project cache removes regenerated data (waveforms, filmstrips, GIF frames, decoded audio); it never deletes source media. Use **Reset** in the dialog header to restore defaults.',
        },
      ],
    },
    {
      title: 'Interface sounds',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut can play subtle synthesized interface sounds — short cues that confirm actions like selecting, confirming, toggling, and deleting. They are **off by default**, opt-in, and never affect exported audio.',
        },
        {
          kind: 'steps',
          items: [
            'Open **Settings** and go to the **General** tab.',
            'Turn on **Interface sounds**.',
            'Set **Sound volume** to taste (0–100%).',
            'Pick a **Sound theme** — **Signature**, **Velvet**, or **Crisp** — and use the **Preview** button to audition it.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sounds are suppressed while the preview is playing, so they never bleed into the audio you are monitoring; exports are silent by design. Turning the toggle on plays a short confirmation.',
        },
      ],
    },
    {
      title: 'Customizing keyboard shortcuts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Keyboard shortcuts are fully customizable, but the editor is its own dialog opened from the **Keyboard** button in the toolbar — not this Settings dialog. It has an interactive on-screen keyboard, search and **Custom** / **Conflicts** / **Unassigned** filters, record-to-rebind, alternate bindings, per-command and **Reset All** defaults, conflict detection, and JSON preset **Import** / **Export**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'See the **Keyboard shortcuts** page for the full command list and a step-by-step rebinding walkthrough.',
        },
      ],
    },
    {
      title: 'Set elsewhere',
      blocks: [
        {
          kind: 'list',
          items: [
            'Interface **language** is a separate control in the toolbar, not part of this dialog; FreeCut ships in 9 languages.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'FreeCut currently uses a single dark theme; there is no theme selector.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
