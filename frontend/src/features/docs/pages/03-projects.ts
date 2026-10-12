import type { DocPageContent } from '../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projects',
  description: 'Create, configure, duplicate, organize, trash, restore, and move projects.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Create and configure a project',
      blocks: [
        {
          kind: 'list',
          items: [
            'Create a project from the Projects page with **New Project**.',
            'Set the project name, description, resolution, frame rate, and background color.',
            'Resolution and frame rate define the export canvas and timeline timing, so pick them to match your target delivery.',
            'You can revisit project specs later from the editor toolbar.',
          ],
        },
      ],
    },
    {
      title: 'Canvas size and aspect ratio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The canvas defines the frame your video is composed and exported in. Pick a size when you create a project, or change it any time from the **Canvas** panel while editing.',
        },
        {
          kind: 'paragraph',
          text: 'On **New Project**, the **Resolution** section offers ready-made presets for common platforms. Each preset card shows its pixel size and aspect ratio. Choose **Custom** to type an exact width and height instead.',
        },
        {
          kind: 'table',
          headers: ['Preset', 'Resolution', 'Aspect ratio'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` landscape'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` vertical'],
            ['Instagram Square', '`1080x1080`', '`1:1` square'],
            ['Instagram Portrait', '`1080x1350`', '`4:5` portrait'],
            ['Twitter/X', '`1200x675`', '`16:9` landscape'],
            ['LinkedIn', '`1200x627`', 'landscape'],
            ['Custom', 'Your own values', 'Anything you enter'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'To change the size after the project exists:',
        },
        {
          kind: 'steps',
          items: [
            'Deselect any clip so the properties sidebar shows the **Canvas** panel.',
            'Edit the **W** and **H** fields to set the frame width and height in pixels.',
            'Use **Swap** to flip width and height, for example to turn a landscape project into a vertical one.',
            'Use **Reset** to return the canvas to `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Dimensions snap to even numbers and range from `320x240` up to `7680x4320`. Existing clips keep their current position and scale when the canvas changes, so reposition anything that now sits outside the new frame.',
        },
      ],
    },
    {
      title: 'Organize the project list',
      blocks: [
        {
          kind: 'list',
          items: [
            'Search projects by name, and sort or filter the list as it grows.',
            'Use thumbnails and metadata to spot the project you last worked on.',
            'The active workspace is shown on the Projects page, so you always know where projects are stored.',
            'Use **Duplicate** to branch a variation without touching the original.',
          ],
        },
      ],
    },
    {
      title: 'Trash and restore',
      blocks: [
        {
          kind: 'list',
          items: [
            'Deleting a project moves it to **Trash** rather than removing it immediately.',
            'Restore a project from the Trash section while it is still there.',
            '**Empty trash** permanently deletes trashed projects and any media they exclusively reference.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Permanent deletion cannot be undone, so confirm the name before emptying trash.',
        },
      ],
    },
    {
      title: 'Move work between workspaces',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Export Project** to create a bundle that packages the project with its media.',
            'Import a bundle into another workspace to continue the same edit on a different machine or folder.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bundles are the safe way to hand a project to someone else, because they carry the linked media along with the timeline.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
