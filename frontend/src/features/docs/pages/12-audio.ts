import type { DocPageContent } from '../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Audio Editing',
  description:
    'Record a voiceover, adjust clip gain and fades, pitch, per-clip EQ, the mixer and meters, and silence and filler-word cleanup.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Adjust a clip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Select a clip and open the **Audio** tab in Properties.',
        },
        {
          kind: 'table',
          headers: ['Control', 'Range'],
          rows: [
            ['Gain', '-60 dB to +12 dB (−60 dB effectively mutes the clip)'],
            ['Fade In / Fade Out', '0 to 5 seconds each'],
            ['Pitch', 'Semi Tones and Cents, independent of speed'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'You can also drag the volume line and fade handles directly on the clip in the timeline, and **Gain** can be keyframed to rise or fall over a clip.',
        },
      ],
    },
    {
      title: 'Pitch and tone',
      blocks: [
        {
          kind: 'list',
          items: [
            'The **Pitch** controls shift pitch without changing clip speed. To change speed instead, use **Speed** on the Video tab.',
            'The **Equalizer** section gives each clip a curve editor for tonal shaping.',
          ],
        },
      ],
    },
    {
      title: 'Mixer and meters',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the audio **Meters** to watch stereo levels and catch clipping while you play.',
            'Use the **Mixer** to balance levels across the project.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Monitor volume in the preview affects local playback only and never changes the exported mix.',
        },
      ],
    },
    {
      title: 'Record a voiceover',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The **Record voiceover** (microphone) button in the timeline toolbar records narration in time with your project. Capture runs **while the timeline plays**, and the finished take lands on a new audio track anchored to the playhead position where you started.',
        },
        {
          kind: 'steps',
          items: [
            'Move the playhead to where the voiceover should begin.',
            'Click the **microphone** button — the timeline starts playing and recording begins.',
            'Use **Pause recording** to stop the playhead and mic together, **Resume recording** to continue, and **Stop and save** to finish and drop the clip onto a new audio track.',
            'Click **Cancel recording** (the ✕) to discard the take without adding anything.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Open **Microphone settings** (the ▾ next to the button) to choose an input device and tune capture. The level meter there is live, so you can check your mic before recording.',
        },
        {
          kind: 'table',
          headers: ['Setting', 'What it does'],
          rows: [
            ['Noise suppression', 'Reduces steady background noise. On by default.'],
            ['Auto gain', 'Keeps your voice at a consistent level. On by default.'],
            [
              'Mute timeline while recording',
              'Silences the timeline monitor so speaker audio does not bleed into the mic. On by default.',
            ],
            [
              'Sync offset',
              'Nudges the recorded clip earlier or later to compensate for input latency (up to ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use headphones so your project audio is never captured by the mic — then you can turn **Mute timeline while recording** off to hear the mix as you narrate.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Seeking is disabled while recording, and pressing `Space` or reaching the end of the timeline finishes the take. This keeps the recording locked to the playhead so it can never drift out of sync.',
        },
      ],
    },
    {
      title: 'Clean up dialogue',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Remove Silence** finds silent ranges and cuts them; the **Minimum Silence** setting controls how long a gap must be, and the dialog estimates how much will be removed.',
            '**Remove Filler Words** detects words like um and uh from the transcript and audio and removes them.',
            'Both tools show the ranges they will remove so you can preview before applying the edit.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A transcript improves filler-word detection, so generate one first for the best results.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
