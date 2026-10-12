import type { DocPageContent } from '../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Getting Started',
  description:
    'What VideoSOS is, what your computer needs, and your first edit from launch to export.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'What VideoSOS is',
      blocks: [
        {
          kind: 'paragraph',
          text: 'VideoSOS is a desktop AI video studio: a **Generate** tab that makes images, video, music, voices, sound effects and text with OpenRouter, fal and Runware, and a multitrack editor that cuts the results into a finished video. Editing, effects, color and export run on your own machine using your GPU and CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Your media stays on your device. Only a generation goes out, to the provider you picked, with your own key; its result is downloaded into the project at once. Projects, caches and exports live in the **workspace** beside the program.',
        },
      ],
    },
    {
      title: 'What your computer needs',
      blocks: [
        {
          kind: 'table',
          headers: ['Part', 'Needed'],
          rows: [
            ['System', 'Windows 10 or 11, 64-bit, with Microsoft Edge WebView2 (the installer adds it when missing)'],
            ['Graphics card', 'One with WebGPU (any recent NVIDIA, AMD or Intel) for the preview, effects and the fast export'],
            ['Internet', 'Only for generation; editing and export work offline'],
            ['Keys', 'A key of OpenRouter, fal or Runware to generate; one provider is enough'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'VideoSOS uses WebCodecs (decode and export) and WebGPU (effects, color, AI) inside its own window. Keep GPU drivers current.',
        },
      ],
    },
    {
      title: 'Your first edit',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Start VideoSOS; its workspace is ready, there is no folder to pick.',
            'On the Projects page, choose **New Project** and set the resolution and frame rate for the edit.',
            'Open the **Media** tab and use **Import** to add files, or drag media straight into the library — or open **Generate**, pick a task and a model, and press **Generate**.',
            'Drag a clip from the Media panel onto a timeline track.',
            'Press `Space` to play, and use `Left` and `Right` to step one frame at a time.',
            'Save with `Ctrl+S` as you work, then choose **Export** to render the finished video.',
          ],
        },
      ],
    },
    {
      title: 'Confirm your setup works',
      blocks: [
        {
          kind: 'list',
          items: [
            'The Projects page opens without asking for a folder.',
            'Imported media appears as cards in the Media panel with thumbnails.',
            'Playback starts from the timeline when you press `Space`.',
            'Export opens and the preflight check reports no blocking problems.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'If any step fails, see the **Troubleshooting** page for the matching symptom.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
