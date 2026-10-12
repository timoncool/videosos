import type { DocPageContent } from '../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Media Library',
  description:
    'Import media, inspect files, and generate proxies, transcripts, captions, and AI scene data.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Import media',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the **Media** tab and use **Import** to pick files, or drag files straight into the library.',
            'FreeCut handles video, audio, images, GIFs, SVGs, Lottie animations (`.json` and `.lottie`), and generated assets. GIFs import as image items.',
            'Use **Import Media From URL** for a direct link to a media file — the URL must point at the file itself, not a page that embeds it.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Apple ProRes footage imports, previews, and generates thumbnails like any other clip — including formats browsers cannot decode on their own. When you export, ProRes clips are re-encoded to your chosen output codec; there is no ProRes output format.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Folder import is not supported yet — drop the media files directly. What decodes depends on your browser; if a file will not import, try a different format or transcode it first.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Log footage (S-Log3 and similar) looks flat and washed out by design — that is how it is captured. Add a LUT or color grade to bring it back; nothing is wrong with the file.',
        },
      ],
    },
    {
      title: 'Inspect a clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **Media info** to see codec, dimensions, duration, frame rate, file size, type, and transcript status.',
            'Double-click a media card, or use **Open In Source Monitor**, to preview a source before editing it in.',
            'Media cards expose menus for File, Proxy, Transcript, Embedded captions, and AI actions.',
            'Sort, filter, and group assets by type when the library grows large.',
          ],
        },
      ],
    },
    {
      title: 'Generate support data',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'What it gives you'],
          rows: [
            [
              'Generate Proxy',
              'A lighter version of a heavy video for smoother editing; export still uses the original.',
            ],
            ['Generate Transcript', 'Editable speech text you can search and turn into captions.'],
            [
              'Extract Embedded Subtitles',
              'Subtitle tracks pulled from the file, ready to insert into the timeline.',
            ],
            [
              'Analyze with AI',
              'Local scene detection and captioning so clips become searchable in the Scene Browser.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Compound clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Group a section of the timeline into a **compound clip** that behaves like a single reusable media item.',
            'Compound clips appear in the media library and can be placed again like any other asset.',
            'Right-click a compound clip and choose **Open as tab** to edit it as a standalone **sequence**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Compound clips can be nested — one can contain another — as long as the chain never loops back on itself.',
        },
      ],
    },
    {
      title: 'Lottie animations',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Import Lottie files — raw `.json` or packaged `.lottie` archives — as timeline items that render frame-accurately in preview and export. Select a Lottie clip to reveal its editing controls in the properties panel **Lottie** section.',
        },
        {
          kind: 'list',
          items: [
            'Control **Speed**, **Reverse**, **Loop**, and **Ping-pong** playback.',
            'Set a **Start frame** / **End frame** segment to play only part of the animation, or pick a named **Marker** to jump the segment to it.',
            'Recolor the animation — author-named **Colors** are surfaced first, with the remaining shapes tucked under a disclosure; a shared color edits every shape that used it, and **Reset all** restores the originals.',
            'Edit template **Text** layers in place, and adjust exposed scalar and vector value slots under **Properties**.',
            'For `.lottie` archives that bundle more than one animation, switch between them with the **Animation** picker; swap palettes with the **Theme** picker when the file ships themes.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Color, text, slot, and segment edits preview live on the canvas as you drag or type, and commit as a single undo step. Animation, theme, marker, segment, and template editing apply to one selected Lottie clip at a time.',
        },
      ],
    },
    {
      title: 'Fix missing media',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Missing Media appears when a linked file moved, was renamed, was deleted, or needs renewed permission. Use **Grant Access**, **Locate**, **Locate Folder**, or **Browse Another Folder** to restore the link. Use **Work Offline** only when you intend to relink later.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
