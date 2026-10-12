## service: the port and who holds it
service-bad-port = { $value }: не номер порта (ожидается 1..65535)
service-exe-path = путь к exe сервиса: { $error }
service-request-not-sent = соединение принято, но запрос не ушёл: { $error }
service-no-health-answer = соединение принято, ответа на /health нет: { $error }
service-not-http = ответ не по HTTP
service-health-status = HTTP-сервер, /health ответил { $code }
service-health-not-videosos = HTTP-сервер, /health ответил не телом VideoSOS
service-health-not-json = HTTP-сервер, /health ответил не JSON
service-health-no-fields = /health называет себя { $app }, но без полей сервиса: { $error }
service-other-app = другое приложение ({ $app })
service-health-no-app = HTTP-сервер, /health без имени приложения
service-port-reserved = система не отдаёт порт, хотя соединений на нём никто не принимает (возможно, он в зарезервированном диапазоне Windows: { $command })
service-port-videosos = на нём VideoSOS { $version } ({ $executable })
service-port-other = его занял другой процесс: { $what }
service-port-busy = Порт 127.0.0.1:{ $port } занят уже { $seconds } с: { $who }. Ошибка: { $error }.

## jobs
jobs-variants = { $count ->
    [one] { $count } вариант
    [few] { $count } варианта
   *[many] { $count } вариантов
}
