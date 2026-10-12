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

## jobs
jobs-variants = { $count ->
    [one] { $count } variant
   *[other] { $count } variants
}
