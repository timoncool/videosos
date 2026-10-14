# Changelog

What changed, newest first. Dates are release dates. Every change a user can see is written here in the commit that
makes it, and the release notes on GitHub are taken from the release's section.

## Unreleased — 2.1.0

### Added

- **Chat with an assistant in the window.** A Chat tab where an OpenRouter model of your choice works VideoSOS with
  the same tools an MCP agent has: it reads the timeline, generates, edits and exports while you see each step, its
  cost and a Stop button. Its changes go into the journal and its generations count against the agents' daily limit.
- **Videos by their links.** The media library's link button takes a YouTube link (or any site yt-dlp knows, or a
  direct file): it shows the video's title, length and qualities, downloads it with its progress, cancel and resume,
  and puts it into the project's library. yt-dlp, deno and ffmpeg are downloaded on first use, pinned and checked by
  SHA-256; yt-dlp updates itself once a day. Agents have the same through `url_*` tools.
- **One top bar over every screen**, as in the author's studios: the name and version, the editor's modes and
  buttons, the last event in the middle (a click opens the journal), New, news, help, settings and language.
- **Activity journal**: what agents changed, in the window's language, and every message the window showed, kept
  across restarts. An agent's action is captioned under the top bar; an agent can write to you with `ui_notify`.
- **News and changes in the window.** The sparkle button opens the news of VideoSOS and the author's other programs,
  and this changelog; short notes from the author appear as a strip across the top of the window.
- **Resource monitor**: the graphics card, its memory, temperature and power, and the memory of the program.
- **Files panel**: every file saved in the session, with a way to it in the file manager.
- **Share** a generation's file or a finished export through the system's share sheet, or a line about it to
  Telegram, X, VK, WhatsApp or Reddit.
- **Sound output**: choose the device the preview plays through (Settings, General).
- **Model picker as a catalogue**: what each model is good at, its price, its typical time on this computer, and
  favourite models pinned to the top.
- **Each generation card's details**: the model, every value it was asked with, the time it took.
- **Results named and tagged by their prompt**: a picture carries the prompt and the model in its metadata (Windows
  shows them as its title and comment), a video or a sound in its tags, and the library item has the same title.
- **Compare models in one run**: the same prompt goes to up to two more models of the task, each with its price, and the results stand side by side in the history.
- **Prompt presets and variables**: keep a prompt under a name and put it into any form; `{{subject}}` in a prompt gets its own field and is filled in when the job is sent.
- **Prompt from the picture**: a model that sees the form's picture writes the prompt that would make it.
- **A prompt is checked against its model** before it is sent: the counter shows the model's limit, and Create
  waits until the text fits.
- **The generation panel remembers your choices for every window**: the task, the models and what you typed.
- **History sorting** by newest, oldest, most or least expensive, and sounds when a generation or an export ends.
- **About**: the author's other programs, crypto addresses with copy buttons and the support tiers.
- **Closing while a generation is unfinished asks first.**
- **Linux (.deb, AppImage) and macOS (.dmg) builds.**
- **The window in ten languages**: German, Spanish, French, Japanese, Korean, Brazilian Portuguese, Turkish and
  Chinese join English and Russian, effects, transitions and their parameters included.

### Changed

- **Own accent colour**: the teal of the VideoSOS icon; Onest and JetBrains Mono, the design of the author's studios.
- **Settings window as in the studios**: sections with hints, every row with what it does, Done and Reset.
- **The projects page opens with a start block**: what VideoSOS does, New project and Import.
- **The generation panel scrolls as one column**: every field is in view before you spend, Create stays at the
  bottom, the history follows below.
- **A failed generation says what kind of failure it was** in your language, with the provider's own text under
  Error text and a button to the keys when one is missing.
- **Prices, sizes and times in your language**, in the model picker, the generation form and the export dialog.

### Fixed

- **An agent's import of a file on this computer** works again.
- **A command an agent sends to a window that closes** fails at once instead of waiting five minutes.
- **Every icon-only button has a name** that screen readers and agents read.
- **Narrow windows** keep the top bar, the canvas buttons and the meters in view.

## 2026-10-12 — 2.0.0

### Added

- **One window for generation and editing.** A Generate tab beside the media library: images, image edits, video
  from text or frames, video edits, lip sync, upscale, background removal, music, voice, sound effects, transcripts
  and text, through OpenRouter, fal and Runware with your own keys.
- **Live model catalogues** of the three providers, newest first, with their prices; forms drawn from each model's
  own schema; the price shown before a run and the provider's bill recorded after.
- **Jobs that survive a restart** and are never sent twice; results downloaded to disk at once and imported into the
  project's library, optionally straight onto the timeline at the playhead.
- **A full multitrack editor** (based on FreeCut): trims, transitions, keyframes, masks, color, text, captions and a
  hardware-accelerated export to MP4, WebM, MOV and MKV, saved where you choose.
- **MCP server** at `http://127.0.0.1:8796/mcp` with 37 tools: an agent generates, edits the open project's timeline
  with undo, imports media, exports, and sees the window; a daily spending limit for agents.
- **Projects on your disk**: the workspace, generations and history live beside the program.
- **Russian and English** interface (and eight more languages of the editor).
- Updates from GitHub releases, an installer in English and Russian, a portable zip.
