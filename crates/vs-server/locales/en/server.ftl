## service: the port and who holds it
service-bad-port = { $value }: not a port number (1..65535 expected)
service-exe-path = the service exe path: { $error }
service-request-not-sent = the connection was accepted, but the request was not sent: { $error }
service-no-health-answer = the connection was accepted, but /health did not answer: { $error }
service-not-http = the answer is not HTTP
service-health-status = an HTTP server; /health answered { $code }
service-health-not-videosos = an HTTP server; /health did not answer with a VideoSOS body
service-health-not-json = an HTTP server; /health did not answer with JSON
service-health-no-fields = /health calls itself { $app }, but without the service fields: { $error }
service-other-app = another application ({ $app })
service-health-no-app = an HTTP server; /health without an application name
service-port-reserved = the system does not give out the port, though nobody accepts connections on it (it may be in a range Windows reserves: { $command })
service-port-videosos = VideoSOS { $version } is on it ({ $executable })
service-port-other = another process holds it: { $what }
service-port-busy = Port 127.0.0.1:{ $port } has been busy for { $seconds } s: { $who }. Error: { $error }.

    Close the program that holds it, or set another port with the { $env } environment variable (for example { $env }={ $other_port }).

## jobs
jobs-variants = { $count ->
    [one] { $count } variant
   *[other] { $count } variants
}
jobs-interrupted-sending = The program closed while this job was being sent; it was not sent again so it is not paid twice. Start it again if it did not arrive.
jobs-busy = The provider is busy right now: { $reason }. Start it again in a minute.
jobs-too-many-files = { $field } takes at most { $max } files.
jobs-bad-media = Not a media item of the workspace: { $media }
jobs-media-not-in-workspace = The file of media { $media } is not in the workspace folder. Import it with a copy, then try again.
jobs-no-such-output = No such result of job { $job }
jobs-lost-contact = The provider stopped answering about this job: { $reason }
jobs-too-long = The provider has worked on this job for over three hours; it is no longer awaited.
jobs-download-failed = The result could not be downloaded: { $reason }
jobs-cancelled = Cancelled.
jobs-cancelled-not-waiting = Stopped waiting. The provider did not stop the job, so it may still finish and be charged.
jobs-field-required = Fill in: { $field }
jobs-field-too-long = { $field } is { $count } characters long; the model takes at most { $max }.
jobs-no-key = No { $provider } key: add it in Settings, Providers.
jobs-place-needs-project = Placing on the timeline needs project_id: the project open in the window (editor_state names it).
jobs-place-at-invalid = place_at is a moment of the timeline in seconds, 0 or more.
jobs-openrouter-video-link = OpenRouter takes { $field } only as an https link, not as a file of this computer: choose a fal or Runware model of this task, or give a link.
jobs-not-found = No job { $job }
jobs-still-running = The job is still running; cancel it first.

## catalogue and keys
catalog-empty = The provider answered with an empty catalogue.
catalog-unknown-model = { $provider } has no model { $model } in the catalogue.
catalog-no-schema = The model has no description to build its form from.
catalog-unknown-provider = Unknown provider: { $provider }
keys-env-wins = The environment variable { $variable } is set and takes priority; unset it to store a key here.
keys-one-line = A key is one line.
settings-bad-budget = The daily limit is a number from 0 to 10000.
spend-agent-limit = Agents have spent ${ $spent } today; this job would cost about ${ $cost } and pass the daily limit of ${ $budget }. Raise the limit in Settings, Agents.
spend-agent-limit-unknown-price = This model's price is known only after the run, so an agent cannot start it while the daily limit of ${ $budget } is set. Pick a model with a price, or clear the limit in Settings, Agents.
catalog-partial = Part of the catalogue was not read: { $failures }. The models read are listed; refresh to try again.

## the desktop shell
shell-server-failed = The VideoSOS server did not start: { $error }
shell-server-stopped = The VideoSOS server stopped right after it started.
shell-server-crashed = The VideoSOS server thread crashed while starting.
shell-server-silent = The VideoSOS server did not answer on 127.0.0.1:{ $port } within 30 s.
update-title = VideoSOS update
update-install-now = VideoSOS { $version } is out. Install it now? The program restarts when it is done.
update-open-page = VideoSOS { $version } is out. Open the release page to download it?
update-button-install = Install
update-button-open = Open the page
update-button-later = Later
update-open-failed = The release page did not open: { $error }. Open { $url } in a browser.
update-failed = The update did not install: { $error }

## exports
exports-dialog-title = Save the video
exports-no-folder = The folder of { $path } is not there.
exports-no-file = There is no file { $path }.
jobs-finished-after-cancel = The provider finished the job after it was cancelled; the result is kept, since it was billed.

hw-no-nvidia = no NVIDIA GPU
remote-only-here = Access from the network is changed on the computer VideoSOS runs on.
settings-proxy-not-saved = The proxy is in use but was not saved: { $error }
quit-title = Quit VideoSOS?
quit-running = { $count } generation(s) are not finished. One already sent to fal or Runware is picked up at the next start; one being sent, or an OpenRouter request, is lost and may still be paid.
quit-button-quit = Quit
quit-button-stay = Stay

url-no-fetch = there is no download { $id }
url-stopped = stopped
url-already-downloading = this link is already downloading: { $id }
url-probe-not-json = the yt-dlp -J answer is not JSON: { $error }; { $stderr }
url-interrupted = the download stopped when VideoSOS closed; what was fetched is in its folder and resumes from there
url-not-a-link = “{ $url }” is not a link: { $error }
url-not-http = “{ $url }” is not an http(s) link
url-bad-subs-lang = “{ $lang }” is not a subtitle language code
url-cookies-not-file = { $path } is not a cookies.txt file of up to 1 MB
url-cookies-empty-or-large = cookies.txt is empty or larger than 1 MB
url-thread-failed = the download thread did not start: { $error }
url-cookies-gone = this download’s cookies.txt is gone from its folder; start the download again with cookies
url-disk-space = about { $need } MB is needed, { $free } MB is free
url-no-subs = the video has no human-made “{ $lang }” subtitles (there are: { $have })
url-no-subs-none = the video has no human-made “{ $lang }” subtitles (there are none at all)
url-no-media-file = yt-dlp finished, but there is no video file in { $path }: { $stderr }
url-subs-failed = the “{ $lang }” subtitles did not download ({ $code }): { $error }
url-ytdlp-start = starting yt-dlp: { $error }
url-ytdlp-wait = waiting for yt-dlp: { $error }
url-still-downloading = { $id } is still downloading
url-cancelled-removed = { $id } was cancelled and what was fetched is removed: start a new download
url-still-stopping = { $id } is still stopping; try again in a couple of seconds
url-cancel-first = { $id } is still downloading; cancel it first
url-no-subs-file = yt-dlp finished without a subtitle file in { $path }: { $stderr }
url-no-parent = { $path } has no parent folder
url-subs-empty = the subtitles { $path } have no lines at all
url-ytdlp-missing = the ytdlp component is not downloaded
url-bad-quality = quality “{ $quality }”: best, 1080, 720, 480 or audio

ytdlp-update-missing = the yt-dlp update { $version } ({ $path }) is missing; the pinned { $pinned } runs
ytdlp-http-client = HTTP client: { $error }
ytdlp-tag-not-version = the yt-dlp release tagged “{ $tag }” is not a version
ytdlp-no-checksum = { $url } has no { $file }
ytdlp-new-says = the new yt-dlp { $tag } calls itself “{ $said }”; { $current } stays
ytdlp-new-failed = the new yt-dlp { $tag } did not start: { $error }; { $current } stays
ytdlp-too-large = { $url }: more than { $limit } bytes
ytdlp-sha-mismatch = { $url }: SHA-256 { $got } does not match SHA2-256SUMS { $want }
ytdlp-exit-code = exit code { $code }: { $stderr }
ytdlp-component-missing = the ytdlp component (yt-dlp and deno) is not downloaded
ytdlp-no-ffmpeg = no ffmpeg: neither the ffmpeg component nor ffmpeg.exe in PATH
ytdlp-start = starting { $program }: { $error }
ytdlp-timeout = yt-dlp did not answer in { $seconds } s: { $stderr }
ytdlp-playlist = the link is a playlist or a channel ({ $count } { $count ->
    [one] video
   *[other] videos
}), not a single video
ytdlp-redirect-only = the link has no video itself, only a link onward
ytdlp-live = a live stream ({ $status })
ytdlp-thumbnail-not-image = the thumbnail is not an image ({ $mime })
ytdlp-thumbnail-too-large = the thumbnail is larger than 4 MB
ytdlp-failed-silently = yt-dlp failed without a message
url-needs-project = a link is downloaded into a project: give project_id, the project open in the window
tools-unsupported-os = links are downloaded on Windows and Linux
tools-incomplete = the { $tool } tool is not whole after its download: { $files }
chat-too-many-turns = the assistant took { $turns } steps without finishing; ask it to go on
chat-empty = choose a model and write a message
