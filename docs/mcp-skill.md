---
name: videosos
description: Drive VideoSOS on this computer through its MCP server - generate images, video, music, speech, sound effects and text with the person's OpenRouter, fal and Runware keys (or free on this computer's card and through the author's studios that are open), put the results into a project and edit it on the multitrack timeline - cuts, ripple deletes, joins, freeze frames, titles, captions in Dub Studio's looks, transitions, keyframes, motion graphics, 3D blocking, a voice-over from the microphone - then export a video or FCPXML. Use whenever the person asks for anything VideoSOS does.
---

# VideoSOS for agents

VideoSOS is a desktop video studio: a multitrack editor (a FreeCut fork) with generation of every modality
through three providers the person pays with their own keys — OpenRouter, fal and Runware. Its MCP server
listens on `http://127.0.0.1:8796/mcp` while the program runs. Every tool runs the same code as a control of the
window. The person watches the window: every action you take in it is shown to them ("Agent: edits the timeline")
and written to the Activity journal.

## If VideoSOS is not running yet

1. It is a desktop program for Windows (Linux and macOS builds are experimental). If it is not installed, download
   the installer or the portable archive from https://github.com/timoncool/videosos/releases/latest.
2. Start it. The MCP server is up as soon as its window is. Nothing else to install - no npx, no bridge.
3. Connect (below), then call `studio_status`. No key for a provider? Ask the person for one (`key_set`).

## Connect

```bash
claude mcp add --transport http videosos http://127.0.0.1:8796/mcp
```

Other clients: `{ "mcpServers": { "videosos": { "type": "streamable-http", "url": "http://127.0.0.1:8796/mcp" } } }`.

The server also serves this skill (resource `videosos://skill`, prompt `videosos`), the writing guides
(`videosos://guide/prompt`, `videosos://guide/picture`, `videosos://guide/storyboard`) and the prompts `make_video`
(a film from an idea, from nothing to the file) and `write_prompt` (a model's prompt from a task). It speaks MCP
`2026-07-28` (stateless) and the handshake revisions through `initialize`. Only agents on this computer and the
program's own window may connect. The person sees the connection in Settings, Agents.

## You are the language model

You think, write and plan yourself: prompts, scripts, shot lists, 3D scenes, HTML graphics, captions' wording. Never
start a paid `text` generation to do your own thinking, and never give `previs_render` words for another model to
build a scene from — write the scene. What is paid is media: pictures, video, sound and voices from the providers.
How to write a model's prompt, a prompt from a picture and a storyboard is in the guides above.

**When the person made you VideoSOS's assistant** (Settings, Agents, Assistant "Agent (MCP)"), the window asks you
what it would ask a model: Improve prompt, Prompt from the picture, the storyboard's split, the 3D blocking and the
Chat tab's messages. Keep `assistant_requests_wait` running while the person works; answer each request with
`assistant_request_answer` in the form its `answer_form` or instructions ask. A request's pictures come with the
answer of `assistant_requests_wait`, and its `files` name them on this computer. A chat message is the person
writing to you: do what it asks with the tools, then answer in words; until you answer, the chat shows each tool you
call as a step. `studio_status` shows `assistant` and `assistant_requests_waiting`.

## Start

1. `studio_status` — version, which keys are set, catalogues, running jobs, money spent today, the agents'
   daily limit, and what the window shows (`editor`; `editor_state` tells the open project, tab and playhead).
2. No project open? `projects_list`, then `project_open` with an id — or `project_create {name, width?, height?,
   fps?}` for a new one (1920x1080 at 30 fps by default; 1080x1920 for vertical). The window must be open for the
   editor tools (`timeline_*`, `media_*`, `frame_*`, `ui_*`); generation and the catalogue work without it.
3. No key for a provider? Ask the person for one and keep it with `key_set {provider, key}`, then `key_check`
   (it also tells what the key has spent and has left); `keys_status` lists which are set.

You can do everything the window does: the person writes what they want, you carry it from the empty project to
the exported file, and they watch it happen.

## Generate

1. `models_list` with a `task`: `image`, `image_edit`, `video`, `video_edit`, `lip_sync`, `upscale`,
   `remove_background`, `music`, `speech`, `sound`, `transcribe`, `text`. Narrow with `provider` and `query`.
   Each model has the provider's price line; `status` other than `live` means it is retiring. `catalog_refresh`
   reads the providers' catalogues again.
2. `model_form` — the fields the model takes. `key` is what you put into `values`; `role` says what a field
   means (`prompt`, `duration`, `resolution`, `aspect`, `size`, `first_frame`, `reference`, `voice`, ...); a field
   of `type: media` takes files; `size` takes one of its `options` (`"1344x768"`).
3. `price_estimate` with the same values. Tell the person the price before anything costly (video, many
   runs). `null` means the provider bills only after the run.
4. `generate` with `project_id` of the open project. Files for media fields:
   - `{"media": "<id>"}` — a media item of the project (`media_list` gives ids);
   - `{"job": "<job id>", "index": 0}` — a result of an earlier generation;
   - `{"file": "C:\\path\\to\\file.png"}` — a file on this computer;
   - an `https://` URL.
   A keyframe list (a media field with `at`) pins each file where it should stand: `{"media": "<id>", "at": 3.5}`
   — the second when `at.unit` is `second` (up to `at.max`), the frame number when it is `frame` (-1 the last).
   Files without `at` are spaced by the model: one is the first frame, two the first and the last.
   An element the person kept (`elements_list`) is named in a prompt as `@name`: its pictures go into the
   model's reference pictures by themselves. `element_save {name, media_ids}` keeps a new one — a character's
   face from a generated picture — so it stays the same in every later shot; `element_delete` drops one.
   `place_on_timeline: true` puts the result on the timeline once it arrives: at `place_at_seconds`, or at the
   playhead then; while it runs, the window marks where it will land. A voice-over placed so has the silence
   before and after its speech trimmed off. `repeat` runs it several times (each run is paid).
5. `job_wait` until `status` is `done` (or `failed` with `error`). A finished job lists `outputs`; with a
   project open the results are already in its library (`media_list`, tagged `generated`). `jobs_list` lists the
   runs, `job_get` one, `job_retry` asks again, `job_delete` removes one from the history.

**One file, one call.** `generate_file` takes a model and its values and answers with the files on this computer
(`out_dir` copies them where you need them), without a project: the same request made again is the same job, not
paid twice.

**Long work answers before a minute.** A command of the window that is still running then (an export, captions,
a cut, a render) answers `{"done": false, "work_id": ...}`: call `studio_wait` with that `work_id` until it gives
the command's own answer. `studio_wait` with `job_id` waits for a generation, and with neither for everything;
`studio_status` lists `window_work` still running.

**Takes.** Runs of one request (the same model and values, the seed aside) are takes of each other: `job_like` marks
the best one, and the `timeline_edit` op `replaceMedia` puts another take's media item in a clip's place, keeping the
clip's start and length.

**On this computer, free.** Provider `local`: MiniMax-H3 and LTX-2.5 (task `video`, with sound) run on the person's
graphics card through stable-diffusion.cpp; pictures come only from OpenRouter, fal and Runware. The author's music
studios (YuE2, MiniMax Music3, ACE-Step) appear in task `music` and Speech Studio's engines in task `speech` while
they are open; a Speech Studio engine's form lists its own voices and the studio's library, and each run is a new
take unless you give `seed`. `local_status` says which models and engine builds are downloaded and the device in
use; `local_install {what}` downloads a model (tens of GB — ask the person first) or an engine build,
`local_remove {model}` deletes one, `local_device` picks auto, cuda, vulkan or cpu, and `local_unload` frees the
card's memory when you are done. A model's `preset` field picks its accelerator (fewer steps). Local runs cost
nothing and go one at a time; a studio's work is made by the studio and lands in the library.

Text and transcription jobs end in text (`outputs[].text`). A job that was sent is never sent twice: after a
restart of the program it is followed, not repeated. `job_cancel` stops fal jobs; OpenRouter and Runware
cannot cancel, the program only stops waiting.

## See what you made

You cannot hear or watch the window, so look at results before you use them:
- `media_frame {media_id, at_seconds?}` — a picture of the library, or a video's frame, as an image;
- `frame_get {at_seconds?}` — the edit itself at a moment, every layer as the preview shows it;
- `transcribe {media_id}` / `transcript_get` — what is said in a video or sound, with word times (free, on this
  computer);
- `ui_screenshot` — the whole window.

## Edit

- `timeline_get` — tracks (with `syncLock`) and clips of the open project: ids, `from`/`durationInFrames` in frames
  of the project's `fps`, `start_s`/`length_s` in seconds, media names, text, and `linked`: clips with the same
  value move and cut together (a video and its sound).
- `timeline_edit` with `ops`, each one undoable step of the editor; the tool's schema lists every op with its fields:
  - `{"op": "addClip", "mediaId": "...", "from": 0}` — a media item as a clip; a clip that meets another on
    its track goes after it, and with `"keepFrom": true` it stays at `from` on a track free there instead;
  - `{"op": "addText", "text": "Title", "from": 0, "durationInFrames": 90, "fontSize": 96}`;
  - `{"op": "moveItem", "id": "...", "from": 150}`, `{"op": "removeItems", "ids": ["..."]}`;
  - `{"op": "rippleDelete", "ids": ["..."]}` — removes and closes the gap: the clips after them on their tracks move
    up, and every track with `syncLock` on loses the same stretch of time, as Ctrl+Delete does (`updateTrack` with
    `"syncLock": false` keeps a track still);
  - `{"op": "split", "id": "...", "frame": 120}`, `{"op": "join", "ids": ["...", "..."]}` (pieces of one clip that
    touch end to end), `{"op": "trimStart", "id": "...", "amount": 15}` (positive cuts the start off),
    `{"op": "trimEnd", "id": "...", "amount": -15}` (negative cuts the end off);
  - `{"op": "duplicate", "ids": ["..."], "from": 300}` — copies, past what is in the way, with their keyframes;
  - `{"op": "link", "ids": ["<video>", "<sound>"]}`, `{"op": "unlink", "ids": ["..."]}`;
  - `{"op": "addTransition", "leftClipId": "...", "rightClipId": "...", "durationInFrames": 15}`;
  - `{"op": "addKeyframe", "itemId": "...", "property": "opacity", "frame": 0, "value": 0}`;
  - `{"op": "addShape", "shape": "rectangle", "from": 0, "durationInFrames": 90, "color": "#000000"}`;
  - `{"op": "updateItem", "id": "...", "updates": {"speed": 2}}` — any field: speed, volume (dB), fades, text, colour,
    the in-point (`sourceStart`, a slip);
  - `{"op": "updateTrack", "id": "...", "name": "Music", "muted": false, "volume": -6}`, `{"op": "removeTrack", "id": "..."}` (empty);
  - `{"op": "addMarker", "frame": 120, "label": "Drop"}`, `updateMarker`, `removeMarker`.
  Give an op `callerId` and refer to what it created later: `{"$ref": "a#/detail/created/0/id"}` (addClip answers `created: [{id, type, trackId}]`, addText and addShape `{id}`: `a#/detail/id`).
- `freeze_frame {clip_id, seconds}` holds a video clip's frame there as a still before the rest plays.
- `timeline_undo` / `timeline_redo`, `playhead_seek`, `playback`, `editor_tab`.
- `motion_render {html, seconds?, name?}` makes HTML and CSS motion graphics (titles, lower thirds, counters,
  badges) into a transparent clip at the playhead; CSS animations only, no scripts. Free.
- `previs_render {scene | description, fresh?, output?, time_seconds?, name?}` blocks a shot in 3D before paying for it:
  stand-in shapes, standing and seated people, their moves and the camera's path. Write the scene yourself (its form
  is in the tool's description) or give words for the prompt model (about two cents; `fresh` for a new shot instead
  of changing the current one). `output: frame` puts the camera's picture into the library for a video model's first
  frame or an image model's reference, `video` the camera's whole move as an MP4, `scene` only shows it in the
  Blocking tab. The answer carries the scene to change and send again.
- Rehearse a many-step edit first: `timeline_edit` with `"dry_run": true` answers with what the ops would make and
  leaves the timeline as it was.
- When the person has asked to accept agents' edits, `timeline_edit` waits while they read what will change; a
  declined edit answers with an error and changes nothing: ask them what they want instead.
- Before every `timeline_edit` the window keeps a checkpoint of the timeline; `checkpoint_list {project_id}` lists
  them, `checkpoint_restore {id}` goes back to one (the person can undo it), `checkpoint_create {label}` keeps one on
  purpose before a risky series.
- `media_import` with `path` (a file on this computer) or `url`; `media_delete {ids}` removes what is not needed.
- `media_last_frame {media_id}` puts a video's last frame into the library, to start the next shot on it;
  `media_cut {media_id, start_seconds, end_seconds}` cuts a part to send to a video edit model and put the new take
  back over the clip; `frame_save {at_seconds}` keeps a frame of the edit as a picture.
- Captions: `captions_add {media_id, reveal?, highlight?}` puts captions of a clip's speech on the timeline, in the
  look `window_settings_set` `defaultCaptionStylePresetId` names (`window_settings_get` lists `caption_presets`: the
  editor's own and Dub Studio's 26 looks); `subtitles_export` writes them as SRT, VTT, TXT or JSON.
- A voice-over from the person's microphone: only the person turns the microphone on, with their own click on the
  timeline's record button (an agent's `ui_click` on it, or on the microphone picker, is refused). Ask them to press
  it; `mic_record_status` shows what is recording, `mic_record_stop` puts the take on the timeline,
  `mic_record_cancel` drops it.
- `project_update {name?, width?, height?, fps?, background?}` changes the open project; `project_get` reads one.
- `ui_screenshot` to see the result; `ui_read_page`, `ui_click`, `ui_type`, `ui_select`, `ui_press_key`, `ui_scroll`
  for any control of the window. They work in the window the person turned to last; with several open (a browser
  tab on VideoSOS's address is one too) `windows_watch` lists them and what they are sent, `window_focus {window}`
  picks one, and `window_command_drop {id}` gives up a command a window does not answer.
- `ui_notify` to tell the person what you did or what you need from them; it stays in the journal.

## Plan the film where the person sees it

- `storyboard_set {script, shots: [{prompt, seconds, image_job?, video_job?}]}` writes your shot list into the
  Storyboard tab (`storyboard_get` reads it); fill in the jobs as you generate each shot's frame and clip.
- `canvas_template {template}` / `canvas_set {graph}` put a chain of nodes on the Canvas workspace; `canvas_get` reads
  it and lists the templates.
- `previs_render` above blocks a shot in 3D; `blocking_get` reads it.
- `presets_list`, `preset_save`, `preset_delete`, `variables_set` keep prompts for the person.

## Hand the work over

- `export_video {format, quality, loudness_lufs?}` renders the finished video into the exports folder and answers
  with its path; `loudness_lufs` evens the sound out to a target (left out, the sound is not touched).
- `export_fcpxml` writes the timeline for Final Cut, DaVinci Resolve or Premiere: clips, titles, markers, gain and
  fades; `left` names what it has no place for (transitions between connected clips, speed changes, shapes,
  effects).

## Videos by their links

`url_tool_status` says whether the link tool (yt-dlp with deno, and ffmpeg) is installed; `url_tool_install`
installs it, `url_tool_update` takes a newer yt-dlp. `url_probe {url}` reads a video's title, length and qualities,
`url_fetch` downloads one into the project's library (`url_fetches_list`, `url_fetch_cancel`, `url_fetch_resume`,
`url_fetch_delete`).

## The program itself

`window_settings_get` / `window_settings_set`: language, sounds and their voice, the sound output the preview plays
through, snapping, autosave, undo depth, transcription defaults, the captions' look. `proxy_get` / `proxy_test` /
`proxy_set`, `network_status`, `studio_paths`, `ui_open_settings {section}` to show the person a setting,
`ui_navigate {page}`, `projects_trash`, `project_restore`, `project_duplicate`, `project_delete` (to the trash).
`studio_capabilities` says what can be made now and with which keys, `studio_system` shows the graphics card and
memory, `studio_open_data_folder {folder}` opens a folder for the person, `assistant_set` makes you (or OpenRouter)
the window's assistant, `activity_list` reads the journal (`journal_delete {id}` removes a line, `journal_clear` empties it), `key_delete` removes a key. The daily limit for agents and
whether your edits wait for the person's Accept are theirs alone: `settings_get` reads them.

## Recipes

**A short film from a brief, from nothing to the file.** `project_create` → `storyboard_set` with the shots →
for each shot `generate` a frame (`image`), `media_frame` to check it, `element_save` the hero's face from the
first good frame and name `@hero` in later prompts → `generate` a clip from each frame (`video`, the frame as its
first frame, `place_on_timeline: true` at the shot's moment) → `job_wait`, `media_frame` to check → voice-over
(`speech`), music (`music`), `motion_render` for the title → `frame_get` at a few moments to check the edit →
`export_video`. Tell the person the total price before the paid runs.

**A shot from a picture.** `generate` an image (task `image`), `job_wait`, then `generate` a video with the
image as its first frame: `values: {"positivePrompt": "...", "inputs.frameImages": [{"job": "<image job>",
"index": 0}]}` for Runware, `"frame_first"` for OpenRouter, `"image_url"` for fal — read the model's form.

**Shots end to end.** A generated clip often runs a frame or two longer than asked, so clips placed at 0, 4 and 8 s
overlap and land on separate tracks. `timeline_get`, then `moveItem` each next clip to the previous clip's end on one
track (its sound goes with it). A transition needs spare frames beyond the cut, which a clip used whole has not:
`trimEnd` the left clip by `-15` and `trimStart` the right one by `15`, butt them again, then `addTransition` of 15
frames — or fade with `addKeyframe` on `opacity`.

**Take out a bad stretch.** `split` the clip at both ends of it, then `rippleDelete` the piece between: what follows
moves up on every track with sync lock. Changed your mind: `timeline_undo`, or `join` the pieces back.

**Voice-over.** task `speech`, the text in the `prompt`-role field, a voice from the `voice` field's options,
`place_on_timeline: true` — or the person's own voice: they press record, `mic_record_stop` puts the take down.

**Captions in a look.** `window_settings_set {"defaultCaptionStylePresetId": "dub-hormozi"}` (any id of
`caption_presets`), then `captions_add {media_id, reveal: "karaoke"}`.

**A cut.** `timeline_get`, then one `timeline_edit` with all the ops in order; check with `ui_screenshot`.

## Money

Every generation is paid from the person's account. The person sets a daily limit for agents in Settings;
`generate` is refused past it — tell the person, never work around it. `spend` reports what was spent.

## When something fails

A failed job says why in `error` and `error_code` (`job_get`). When that is not enough, `providers_log` shows what
was asked of the providers and what came back, `ui_console` the window's own errors, and `ui_screenshot` what the
person sees. Report what you found; never retry a paid job blindly.

## Tools by area

- **studio**: `studio_status`, `studio_wait`, `studio_system`, `studio_capabilities`, `studio_paths`,
  `studio_open_data_folder`, `editor_state`, `activity_list`, `journal_delete`, `journal_clear`.
- **keys and providers**: `keys_status`, `key_set`, `key_check`, `key_delete`, `catalog_refresh`, `providers_log`,
  `proxy_get`, `proxy_set`, `proxy_test`, `network_status`.
- **models and generation**: `models_list`, `model_form`, `price_estimate`, `generate`, `generate_file`,
  `jobs_list`, `job_get`, `job_wait`, `job_cancel`, `job_retry`, `job_delete`, `job_like`, `spend`.
- **on this computer**: `local_status`, `local_install`, `local_remove`, `local_device`, `local_unload`.
- **projects**: `projects_list`, `project_get`, `project_create`, `project_open`, `project_update`,
  `project_duplicate`, `project_delete`, `projects_trash`, `project_restore`.
- **media**: `media_list`, `media_import`, `media_delete`, `media_frame`, `media_last_frame`, `media_cut`.
- **videos by link**: `url_tool_status`, `url_tool_install`, `url_tool_update`, `url_probe`, `url_fetch`,
  `url_fetches_list`, `url_fetch_cancel`, `url_fetch_resume`, `url_fetch_delete`.
- **timeline**: `timeline_get`, `timeline_edit`, `timeline_undo`, `timeline_redo`, `freeze_frame`, `playhead_seek`,
  `playback`, `frame_get`, `frame_save`, `checkpoint_list`, `checkpoint_create`, `checkpoint_restore`.
- **speech and captions**: `transcribe`, `transcript_get`, `captions_add`, `subtitles_export`, `mic_record_status`,
  `mic_record_stop`, `mic_record_cancel`.
- **planning**: `storyboard_get`, `storyboard_set`, `canvas_get`, `canvas_set`, `canvas_template`, `previs_render`,
  `blocking_get`, `motion_render`, `elements_list`, `element_save`, `element_delete`, `presets_list`, `preset_save`,
  `preset_delete`, `variables_set`.
- **export**: `export_video`, `export_fcpxml`.
- **the assistant**: `assistant_set`, `assistant_requests_wait`, `assistant_request_answer`.
- **settings**: `settings_get`, `window_settings_get`, `window_settings_set`.
- **the window**: `editor_tab`, `ui_screenshot`, `ui_read_page`, `ui_click`, `ui_type`, `ui_select`, `ui_press_key`,
  `ui_scroll`, `ui_navigate`, `ui_open_settings`, `ui_notify`, `ui_console`, `windows_watch`, `window_focus`,
  `window_command_drop`.
