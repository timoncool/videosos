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
jobs-cancelled-not-waiting = Stopped waiting. This provider cannot cancel a job, so it may still finish and be charged.
jobs-field-required = Fill in: { $field }
jobs-place-needs-project = Placing on the timeline needs project_id: the project open in the window (editor_state names it).
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
spend-agent-limit = Agents have spent ${ $spent } today; this job would cost about ${ $cost } and pass the daily limit of ${ $budget }. Raise the limit in Settings, Providers.
spend-agent-limit-reached = Agents have reached today's limit of ${ $budget }.
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
