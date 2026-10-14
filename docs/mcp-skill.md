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
2. No project open? `projects_list`, then `project_open` with an id. The window must be open for the editor
   tools (`timeline_*`, `media_*`, `ui_*`); generation and the catalogue work without it.

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
   `place_on_timeline: true` puts the result on the timeline once it arrives: at `place_at_seconds`, or at the
   playhead then; while it runs, the window marks where it will land. `repeat` runs it several times
   (each run is paid).
5. `job_wait` until `status` is `done` (or `failed` with `error`). A finished job lists `outputs`; with a
   project open the results are already in its library (`media_list`, tagged `generated`).

Text and transcription jobs end in text (`outputs[].text`). A job that was sent is never sent twice: after a
restart of the program it is followed, not repeated. `job_cancel` stops fal jobs; OpenRouter and Runware
cannot cancel, the program only stops waiting.

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
  - `{"op": "addKeyframe", "itemId": "...", "property": "opacity", "frame": 0, "value": 0}`.
  Give an op `callerId` and refer to what it created later: `{"$ref": "a#/detail/created/0"}`.
- `timeline_undo` / `timeline_redo`, `playhead_seek`, `playback`, `editor_tab`.
- `media_import` with `path` (a file on this computer) or `url`.
- `ui_screenshot` to see the result; `ui_read_page`, `ui_click`, `ui_type` for any control of the window.
- `ui_notify` to tell the person what you did or what you need from them; it stays in the journal.

## Recipes

**A shot from a picture.** `generate` an image (task `image`), `job_wait`, then `generate` a video with the
image as its first frame: `values: {"positivePrompt": "...", "inputs.frameImages": [{"job": "<image job>",
"index": 0}]}` for Runware, `"frame_first"` for OpenRouter, `"image_url"` for fal — read the model's form.

**Voice-over.** task `speech`, the text in the `prompt`-role field, a voice from the `voice` field's options,
`place_on_timeline: true`.

**A cut.** `timeline_get`, then one `timeline_edit` with all the ops in order; check with `ui_screenshot`.

## Money

Every generation is paid from the person's account. The person sets a daily limit for agents in Settings;
`generate` is refused past it — tell the person, never work around it. `spend` reports what was spent.
