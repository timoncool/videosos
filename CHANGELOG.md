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
- **Workflow templates, as Weave's**: the canvas puts a ready chain in one go (frame to video, comparing picture models, a prompt writer, a product shot, a talking head, music and sound), with the models chosen in the panel and the prompts in the interface's language; a canvas is saved as a workflow file to pass on and opened onto any canvas (the chain, the models and the prompts travel; this computer's files and the results do not).
- **3D blocking, as AIMovieStudio's previs**: a sidebar tab where the shot is described in words and the prompt model builds it from stand-in shapes, standing and seated people, their moves and the camera's path (or the scene is written as JSON); it is seen through the camera, from above with the camera's path, or turned around, played over its seconds, and its frame goes into a video's first frame or a picture's reference, or the camera's whole move is recorded as a video. Agents block shots with `previs_render`.
- **HTML graphics, as WeftCut's Motifs**: a sidebar tab where titles, lower thirds, counters and badges are written in HTML and CSS (from four templates or by hand), previewed live and made into a clip with transparency (VP9 in WebM) that lands over the video at the playhead; the clips made keep their code to change and make again. Agents make them with `motion_render`. Nothing is sent anywhere.
- **Node canvas, as Weave's and Flora's**: a Canvas workspace beside Edit, Color and Motion where text, pictures and videos (dropped from the library or another node's result) and generations are nodes joined by what they pass on: text into a model's prompt, files into its slots by meaning; a generation node shows its price, runs through the same queue and history, shows its result and puts it on the timeline. Each project's canvas is kept on the server.
- **Agents' edits as proposals, as OpenChatCut's**: with Settings, Agents, "Agents' timeline edits wait for me" on, an agent's edit is rehearsed and shown in a card with what will change, in plain words, and applies only after Accept; Decline (or no answer) tells the agent nothing changed.
- **Checkpoints and rehearsals for agents, as WeftCut's**: the timeline is kept before every agent's edit; the Checkpoints button beside undo and redo lists them, brings the timeline back to any (as one step undo takes back) and keeps one on purpose; agents list and restore them, and rehearse an edit with `dry_run` without changing anything.
- **FCPXML for Final Cut, DaVinci and Premiere**: Export, FCPXML hands the timeline over to a finishing editor, as Descript does: every clip at its frame on its track's lane, the source start of each video, still pictures, texts as titles and the files where they lie; what FCPXML has no counterpart for (shapes, a changed speed) is listed after the save.
- **Storyboard, as LTX Studio's**: a sidebar tab where a language model splits a script into shots, each shot gets a frame from a chosen picture model and a clip from a chosen video model that starts on that frame, and the clips land one after another on the timeline from the playhead; shot lengths follow the model's own durations, the frame matches the project's aspect, @elements keep a character the same from shot to shot, and both runs show their price first.
- **Elements, as Kling's**: a character, an object or a place kept under a name with its pictures; "@name" in the prompt sends its pictures in the model's reference pictures, in every model of a batch too, and says when a model has no room for them.
- **Regenerate a part of a clip**: a video clip's menu on the timeline cuts the part it shows from its file in the window, puts it into the library and into Edit video as the source, and moves the playhead to the clip, so the new take lands over it with Put on the timeline.
- **Generation placeholder on the timeline**: a run put on the timeline is drawn where it will land, with its model and progress, while it runs; the result lands at that moment, on a free track when the spot is taken, instead of after what is in the way. Agents can name the moment (`place_at_seconds`) and keep a clip at its time (`keepFrom`).
- **Compare models in one run**: the same prompt goes to up to two more models of the task, each with its price, and the results stand side by side in the history.
- **Prompt presets and variables**: keep a prompt under a name and put it into any form; `{{subject}}` in a prompt gets its own field and is filled in when the job is sent.
- **Prompt from the picture**: a model that sees the form's picture writes the prompt that would make it.
- **A prompt is checked against its model** before it is sent: the counter shows the model's limit, and Create
  waits until the text fits.
- **The generation panel remembers your choices for every window**: the task, the models and what you typed.
- **History sorting** by newest, oldest, most or least expensive, and sounds when a generation or an export ends.
- **About**: the author's other programs, crypto addresses with copy buttons and the support tiers.
- **Closing while a generation is unfinished asks first.**
- **Generation on this computer, free**: a Local provider beside OpenRouter, fal and Runware runs Qwen-Image 2.1
  (pictures), MiniMax-H3 and LTX-2.5 (video with sound) through stable-diffusion.cpp on CUDA, Vulkan or the
  processor. Settings, Local models downloads each model and its engine once, pinned and checked by SHA-256, with
  resume; each model has its accelerators as presets (4, 6 and 8 steps); a failed run is named by the engine's own
  first error. Agents have the same through `local_*` tools and the `local` provider.
- **The author's music studios on this computer** (YuE2, MiniMax Music3, ACE-Step) appear in Music while they are
  open: the form is the studio's own, the song is made by the studio and its file lands in the library with its
  tags.
- **Model files taken from the author's other programs**: a weight file another program already has is linked in
  (on the same drive) or copied instead of downloaded, after its SHA-256 matches, and the model's row says where it
  came from.
- **Generate without end**, as YuE2 Studio's songs: the runs go again with new seeds until stopped or a run fails.
- **Export loudness**: the mix can be brought to -14, -16 or -23 LUFS under a -1 dBTP true-peak limiter; off unless
  picked.
- **Captions word by word**: a caption is shown whole, word by word as spoken, or as karaoke with the spoken word
  lit.
- **What a key has spent**: the key check shows OpenRouter's spend and limit, Runware's balance, and says when fal
  does not tell it.
- **The window's assistant can be the connected agent**, as in YuE2 Studio: improving a prompt, a prompt from a
  picture, a storyboard, a blocking and the chat go to the agent connected over MCP, with no OpenRouter key and no
  charge.
- **Agents run the whole work**: projects, the library, frames as pictures, captions and subtitles
  (`subtitles_export`), tracks and markers, settings, keys and proxy, `generate_file` from a model to a file in one
  call, `studio_wait` for long work, `providers_log`, and the writing guides as MCP resources.
- **Tablets, phones and Safari**: below 1024 px the library and properties open over the preview, the top bar
  takes two rows, clips and the playhead are dragged by finger and pen, and the editor opens in Safari.
- **Report a problem** opens GitHub's bug, idea and question forms with the version, the graphics card and the
  system filled in.
- **Linux (.deb, AppImage) and macOS (.dmg) builds.**
- **The window in ten languages**: German, Spanish, French, Japanese, Korean, Brazilian Portuguese, Turkish and
  Chinese join English and Russian, effects, transitions and their parameters included.

### Changed

- **The timeline shows its clips whole**: it opens at 36% of the window, and the video tracks with their clip names are in view by default instead of half of the height going to empty sound tracks; switches that are on (snapping, linked selection, the sidebar's tab) are a tinted background with the accent icon, not a solid block; the new project's frame shapes are neutral outlines.
- **VideoSOS's own colours**: a neutral graphite console as in the family's studios, an AI-violet signature gradient on the main actions (Export, Generate, New project, the storyboard's clips), light violet for what is on, a spotlight gold for the playhead and the preview's handles, timeline clips coloured by kind (video indigo, sound emerald, pictures blue, text pink, shapes green), contrast to WCAG AA throughout; the icon takes the same gradient and the browser tab shows it instead of FreeCut's scissors.
- **The studios' type**: Onest and JetBrains Mono, as in the author's other studios.
- **Settings window as in the studios**: sections with hints, every row with what it does, Done and Reset.
- **The projects page opens with a start block**: what VideoSOS does, New project and Import.
- **The generation panel scrolls as one column**: every field is in view before you spend, Create stays at the
  bottom, the history follows below.
- **A failed generation says what kind of failure it was** in your language, with the provider's own text under
  Error text and a button to the keys when one is missing.
- **Prices, sizes and times in your language**, in the model picker, the generation form and the export dialog.
- **The window's own models as in the studios, only quantized**: speech is recognised by Parakeet Ultra (int8) with
  Whisper Large v3 Turbo (Q8) for other languages, scene captions and cut checks use Gemma 4 E4B; Kokoro, MusicGen,
  LFM, MOSS Nano, Supertonic and the small Whisper models are gone with the AI tab, and speech is made in Generate,
  Speech (a text clip's menu opens it with its text). Settings, Storage clears their leftover files.
- **Anonymous statistics as the author's programs count them**: the features used by name, model downloads ready
  or failed, the seconds of video made on this computer's card and the card's class; Privacy lists all of it.
- **No web version on Vercel**: VideoSOS 2 is a desktop program; the old web version stays in the legacy-v1 branch.

### Fixed

- **A generated video is shown by its first frame** in a canvas node and in a form's file slot, instead of its number.
- **Several results finishing together all land on the timeline**: a library load that ends after a newer one no longer overwrites it, and an import puts its own files into the library before placing them.
- **A result put on a new track is in view**: the timeline scrolls its tracks to it.
- **Choosing another model keeps what the form held**: the prompt, the pictures and the video put in through "Use as" go to the new model's fields of the same meaning, where it has nothing of its own yet.
- **OpenRouter video editing models take their source video**: FLUX Video Edit and Aleph show a source video field and send it as OpenRouter's video reference; a file of this computer, which OpenRouter does not take, is refused before the run with a word to pick a fal or Runware model.
- **A result put on the timeline is seen**: when its moment is taken, it lands on a free track above what is there (or a new one at the top), not under it.
- **Agents' trim operations are described as they work**: `trimStart` and `trimEnd` take `amount`.
- **A video's last frame is named by its prompt**: "Continue from the last frame" puts the frame into the library as "<prompt>, last frame", as every other result is named.
- **Generation form labels name their fields**: a screen reader, a click on the label and an agent reading the page reach the prompt, the selects and the switches by their names.
- **An agent's import of a file on this computer** works again.
- **A command an agent sends to a window that closes** fails at once instead of waiting five minutes.
- **Every icon-only button has a name** that screen readers and agents read.
- **Narrow windows** keep the top bar, the canvas buttons and the meters in view.
- **Transcription in the window reads speech**: Parakeet gave empty text and Whisper garbage on the graphics card;
  both run on the processor with up to eight threads.
- **Scene captions wait for Gemma to load** instead of giving up after 30 seconds while the model is prepared.
- **The sound outputs are listed in the program**: the list waited for a microphone permission the window never
  asked for, so it stayed empty.
- **Agents open the window's menus and lists** (Export, a select's options) with a click, and read the options of an
  open list.
- **A playhead dragged quickly or along the ruler** follows the pointer.
- **A studio's song keeps its own title and tags.**

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
