---
name: videosos
description: Drive VideoSOS on this computer through its MCP server - generate images, video, music, speech, sound effects and text with the person's OpenRouter, fal and Runware keys, put the results into a project and edit it on the multitrack timeline, then export a video. Use whenever the person asks for anything VideoSOS does.
---

# VideoSOS for agents

VideoSOS is a desktop video studio: a multitrack editor (a FreeCut fork) with generation of every modality
through three providers the person pays with their own keys — OpenRouter, fal and Runware. Its MCP server
listens on `http://127.0.0.1:8796/mcp` while the program runs. The person watches the window: every action
you take in it is shown to them ("Agent: edits the timeline") and written to the Activity journal.

## Start

1. `studio_status` — version, which keys are set, catalogues, running jobs, money spent today, the agents'
   daily limit, and what the window shows (`editor`).
2. No project open? `projects_list`, then `project_open` with an id — or `project_create {name, width?, height?,
   fps?}` for a new one (1920x1080 at 30 fps by default; 1080x1920 for vertical). The window must be open for the
   editor tools (`timeline_*`, `media_*`, `frame_*`, `ui_*`); generation and the catalogue work without it.
3. No key for a provider? Ask the person for one and keep it with `key_set {provider, key}`, then `key_check`.

You can do everything the window does: the person writes what they want, you carry it from the empty project to
the exported file, and they watch it happen.

## Generate

1. `models_list` with a `task`: `image`, `image_edit`, `video`, `video_edit`, `lip_sync`, `upscale`,
   `remove_background`, `music`, `speech`, `sound`, `transcribe`, `text`. Narrow with `provider` and `query`.
   Each model has the provider's price line; `status` other than `live` means it is retiring.
2. `model_form` — the fields the model takes. `key` is what you put into `values`; `role` says what a field
   means (`prompt`, `duration`, `resolution`, `aspect`, `size`, `first_frame`, `reference`, ...); a field of
   `type: media` takes files; `size` takes one of its `options` (`"1344x768"`).
3. `price_estimate` with the same values. Tell the person the price before anything costly (video, many
   runs). `null` means the provider bills only after the run.
4. `generate` with `project_id` of the open project. Files for media fields:
   - `{"media": "<id>"}` — a media item of the project (`media_list` gives ids);
   - `{"job": "<job id>", "index": 0}` — a result of an earlier generation;
   - `{"file": "C:\\path\\to\\file.png"}` — a file on this computer;
   - an `https://` URL.
   An element the person kept (`elements_list`) is named in a prompt as `@name`: its pictures go into the
   model's reference pictures by themselves. `element_save {name, media_ids}` keeps a new one — a character's
   face from a generated picture — so it stays the same in every later shot.
   `place_on_timeline: true` puts the result on the timeline once it arrives: at `place_at_seconds`, or at the
   playhead then; while it runs, the window marks where it will land. `repeat` runs it several times
   (each run is paid).
5. `job_wait` until `status` is `done` (or `failed` with `error`). A finished job lists `outputs`; with a
   project open the results are already in its library (`media_list`, tagged `generated`).

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

- `timeline_get` — tracks and clips of the open project: ids, `from`/`durationInFrames` in frames of the
  project's `fps`, `start_s`/`length_s` in seconds, media names, text.
- `timeline_edit` with `ops`, each one undoable step of the editor:
  - `{"op": "addClip", "mediaId": "...", "from": 0}` — a media item as a clip; a clip that meets another on
    its track goes after it, and with `"keepFrom": true` it stays at `from` on a track free there instead;
  - `{"op": "addText", "text": "Title", "from": 0, "durationInFrames": 90, "fontSize": 96}`;
  - `{"op": "moveItem", "id": "...", "from": 150}`, `{"op": "removeItems", "ids": ["..."]}`;
  - `{"op": "split", "id": "...", "frame": 120}`, `{"op": "trimStart", "id": "...", "amount": 15}` (positive cuts the start off),
    `{"op": "trimEnd", "id": "...", "amount": -15}` (negative cuts the end off);
  - `{"op": "addTransition", "leftClipId": "...", "rightClipId": "...", "durationInFrames": 15}`;
  - `{"op": "addKeyframe", "itemId": "...", "property": "opacity", "frame": 0, "value": 0}`;
  - `{"op": "addShape", "shape": "rectangle", "from": 0, "durationInFrames": 90, "color": "#000000"}`;
  - `{"op": "updateTrack", "id": "...", "name": "Music", "muted": false, "volume": -6}`, `{"op": "removeTrack", "id": "..."}` (empty);
  - `{"op": "addMarker", "frame": 120, "label": "Drop"}`, `updateMarker`, `removeMarker`.
  Give an op `callerId` and refer to what it created later: `{"$ref": "a#/detail/created/0/id"}` (addClip answers `created: [{id, type, trackId}]`, addText and addShape `{id}`: `a#/detail/id`).
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
- `media_import` with `path` (a file on this computer) or `url`; `url_probe` and `url_fetch` take a video by its link
  (YouTube and other sites); `media_delete {ids}` removes what is not needed.
- `media_last_frame {media_id}` puts a video's last frame into the library, to start the next shot on it;
  `media_cut {media_id, start_seconds, end_seconds}` cuts a part to send to a video edit model and put the new take
  back over the clip; `frame_save {at_seconds}` keeps a frame of the edit as a picture.
- `captions_add {media_id}` puts captions of a clip's speech on the timeline.
- `project_update {name?, width?, height?, fps?, background?}` changes the open project.
- `ui_screenshot` to see the result; `ui_read_page`, `ui_click`, `ui_type` for any control of the window.
- `ui_notify` to tell the person what you did or what you need from them; it stays in the journal.

## Plan the film where the person sees it

- `storyboard_set {script, shots: [{prompt, seconds, image_job?, video_job?}]}` writes your shot list into the
  Storyboard tab; fill in the jobs as you generate each shot's frame and clip.
- `canvas_template {template}` / `canvas_set {graph}` put a chain of nodes on the Canvas workspace; `canvas_get` reads
  it and lists the templates.
- `previs_render` above blocks a shot in 3D; `blocking_get` reads it.
- `preset_save`, `variables_set` keep prompts for the person.

## Hand the work over

- `export_video {format, quality}` renders the finished video into the exports folder and answers with its path.
- `export_fcpxml` writes the timeline for Final Cut, DaVinci Resolve or Premiere.

## The program itself

`window_settings_get` / `window_settings_set` (language, sounds, snapping, autosave, transcription defaults…),
`proxy_get` / `proxy_test` / `proxy_set`, `network_status`, `studio_paths`, `ui_open_settings {section}` to show
the person a setting, `ui_navigate {page}`, `projects_trash`, `project_restore`, `project_duplicate`,
`project_delete` (to the trash). The daily limit for agents and whether your edits wait for the person's Accept
are theirs alone: `settings_get` reads them.

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

**Voice-over.** task `speech`, the text in the `prompt`-role field, a voice from the `voice` field's options,
`place_on_timeline: true`.

**A cut.** `timeline_get`, then one `timeline_edit` with all the ops in order; check with `ui_screenshot`.

## Money

Every generation is paid from the person's account. The person sets a daily limit for agents in Settings;
`generate` is refused past it — tell the person, never work around it. `spend` reports what was spent.
