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

    Закройте программу, которая его держит, или задайте другой порт переменной окружения { $env } (например, { $env }={ $other_port }).

## jobs
jobs-variants = { $count ->
    [one] { $count } вариант
    [few] { $count } варианта
   *[many] { $count } вариантов
}
jobs-interrupted-sending = Программа закрылась, пока задача отправлялась; повторно она не отправлена, чтобы не заплатить дважды. Запустите её снова, если результат не пришёл.
jobs-busy = Провайдер сейчас занят: { $reason }. Запустите снова через минуту.
jobs-too-many-files = { $field }: не больше { $max } файлов.
jobs-bad-media = Это не медиа рабочей папки: { $media }
jobs-media-not-in-workspace = Файла медиа { $media } нет в рабочей папке. Импортируйте его с копированием и попробуйте снова.
jobs-no-such-output = Нет такого результата задачи { $job }
jobs-lost-contact = Провайдер перестал отвечать по этой задаче: { $reason }
jobs-too-long = Провайдер работает над задачей больше трёх часов; её больше не ждём.
jobs-download-failed = Результат не скачался: { $reason }
jobs-cancelled = Отменено.
jobs-cancelled-not-waiting = Ожидание остановлено. Этот провайдер не умеет отменять задачи, поэтому она может завершиться и быть оплачена.
jobs-field-required = Заполните: { $field }
jobs-not-found = Нет задачи { $job }
jobs-still-running = Задача ещё идёт; сначала отмените её.

## catalogue and keys
catalog-empty = Провайдер вернул пустой каталог.
catalog-unknown-model = У { $provider } в каталоге нет модели { $model }.
catalog-no-schema = У модели нет описания, из которого строится форма.
catalog-unknown-provider = Неизвестный провайдер: { $provider }
keys-env-wins = Задана переменная окружения { $variable }, она важнее; уберите её, чтобы хранить ключ здесь.
keys-one-line = Ключ — одна строка.
settings-bad-budget = Дневной лимит — число от 0 до 10000.
spend-agent-limit = Агенты потратили сегодня ${ $spent }; эта задача стоит около ${ $cost } и превысит дневной лимит ${ $budget }. Поднимите лимит в Настройках, раздел «Провайдеры».
spend-agent-limit-reached = Агенты исчерпали сегодняшний лимит ${ $budget }.
catalog-partial = Часть каталога не прочиталась: { $failures }. Прочитанные модели в списке; обновите, чтобы попробовать снова.

## the desktop shell
shell-server-failed = Сервер VideoSOS не запустился: { $error }
shell-server-stopped = Сервер VideoSOS остановился сразу после запуска.
shell-server-crashed = Поток сервера VideoSOS упал при запуске.
shell-server-silent = Сервер VideoSOS не ответил на 127.0.0.1:{ $port } за 30 с.
update-title = Обновление VideoSOS
update-install-now = Вышел VideoSOS { $version }. Установить сейчас? Программа перезапустится, когда закончит.
update-open-page = Вышел VideoSOS { $version }. Открыть страницу релиза, чтобы скачать его?
update-button-install = Установить
update-button-open = Открыть страницу
update-button-later = Позже
update-open-failed = Страница релиза не открылась: { $error }. Откройте { $url } в браузере.
update-failed = Обновление не установилось: { $error }

## exports
exports-dialog-title = Сохранить видео
exports-no-folder = Папки файла { $path } нет.
exports-no-file = Файла { $path } нет.
