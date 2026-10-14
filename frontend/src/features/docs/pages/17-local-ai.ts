import type { DocPageContent } from '../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Local AI Tools',
  description:
    'Local text to speech and transcription, with local model caching.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'How local AI works',
      blocks: [
        {
          kind: 'list',
          items: [
            'These local AI tools run on your own hardware — nothing is sent to a server. Generation with providers is on the **Generate** tab.',
            'The first time you use a model it downloads once and is then cached locally for reuse.',
            'A status pill shows loading, active, ready, and error states while a model runs.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Some tools require Chrome or Edge 113+ (or Safari 26+) and WebGPU support. The first model download can be large.',
        },
      ],
    },
    {
      title: 'Text to speech',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the **AI** tab and expand **Text to Speech**, then type or paste your script.',
            'Pick an engine (see the table), then choose a voice and, where supported, speed, language, and expressive tags.',
            'Preview the result, then **Save and Insert** to drop linked audio at the playhead, or **Save to Library**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Engine', 'Languages', 'Runs on'],
          rows: [
            ['MOSS Nano', '20 languages', 'CPU'],
            ['Supertonic 3', '31 languages', 'Local ONNX'],
          ],
        },
      ],
    },
    {
      title: 'Music',
      blocks: [
        {
          kind: 'list',
          items: [
            'Music comes from the **Generate** tab: cloud models, or YuE2, MiniMax Music3 and ACE-Step Studio when one of them runs on this computer.',
            'A song made in a studio stays in its library, and its audio lands in VideoSOS media.',
          ],
        },
      ],
    },
    {
      title: 'Transcription',
      blocks: [
        {
          kind: 'list',
          items: [
            'Transcription lives in the Media library and Transcript workflow, separate from the AI tab.',
            '**Parakeet Ultra** (int8) is the default engine and covers 25 European languages, as in Dub Studio.',
            'Other languages, or a browser without WebGPU, go to **Whisper Large v3 Turbo** (int8).',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A transcript powers captions, transcript search, and filler-word removal — generate one early.',
        },
      ],
    },
    {
      title: 'Manage models and runtimes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **Storage** settings to manage Local AI.',
            'Use **Local AI Model Cache** to inspect or clear downloaded models — useful if a download is corrupt.',
            'Use **Unload Local Models** to release runtimes and free memory.',
            'Long jobs can be cancelled if you no longer need the result.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
