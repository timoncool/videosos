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
jobs-cancelled-not-waiting = Ожидание остановлено. Провайдер не остановил задачу, поэтому она может завершиться и быть оплачена.
jobs-cancelled-sending = Отменяю: fal попросят остановить задачу, как только он её примет.
jobs-field-required = Заполните: { $field }
jobs-field-unknown = У этой модели нет поля { $field }; её поля: { $fields }.
jobs-field-too-long = { $field }: { $count } символов, модель принимает не больше { $max }.
jobs-no-key = Нет ключа { $provider }: добавьте его в Настройках, раздел «Провайдеры».
jobs-place-needs-project = Чтобы поставить результат на таймлайн, нужен project_id — проект, открытый в окне (его называет editor_state).
jobs-place-at-invalid = place_at — момент таймлайна в секундах, от 0.
jobs-task-needed = Эта модель делает несколько задач ({ $tasks }): назовите задачу запуска.
elements-no-slot = Эта модель не принимает референсы, поэтому элементы { $elements } не отправить: опишите их словами или выберите модель с референсами.
elements-no-room = Поле «{ $field }» модели берёт не больше { $max } картинок: нет места для элементов { $elements }.
jobs-openrouter-video-link = OpenRouter принимает «{ $field }» только https-ссылкой, а не файлом с этого компьютера: выберите модель fal или Runware для этой задачи или дайте ссылку.
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
spend-agent-limit = Агенты потратили сегодня ${ $spent }; эта задача стоит около ${ $cost } и превысит дневной лимит ${ $budget }. Поднимите лимит в Настройках, раздел «Агенты».
spend-agent-limit-unknown-price = Цена этой модели известна только после запуска, поэтому агент не может её запустить, пока задан дневной лимит ${ $budget }. Выберите модель с ценой или снимите лимит в Настройках, раздел «Агенты».
spend-agent-limit-chat = Вместе с этим разговором агенты потратили сегодня ${ $spent } — это дневной лимит ${ $budget }, чат останавливается. Поднимите лимит в Настройках, раздел «Агенты».
assistant-empty = Вопрос пустой.
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
jobs-finished-after-cancel = Провайдер доделал задачу уже после отмены; результат сохранён, раз он оплачен.

hw-no-nvidia = нет NVIDIA GPU
remote-only-here = Доступ из сети меняют на компьютере, где запущен VideoSOS.
settings-proxy-not-saved = Прокси уже работает, но не сохранён: { $error }
quit-title = Закрыть VideoSOS?
quit-running = Не закончено генераций: { $count }. Уже отправленные в fal или Runware подхватятся при следующем запуске; та, что сейчас отправляется, и запрос OpenRouter пропадут, а оплата за них может пройти; генерация на этом компьютере прервётся и ничего не стоит.
quit-button-quit = Закрыть
quit-button-stay = Остаться

url-no-fetch = нет загрузки { $id }
url-stopped = остановлено
url-already-downloading = эта ссылка уже качается: { $id }
url-probe-not-json = ответ yt-dlp -J не JSON: { $error }; { $stderr }
url-interrupted = загрузка оборвалась, когда VideoSOS закрылся; скачанное лежит в её папке и докачается с места
url-not-a-link = «{ $url }» не ссылка: { $error }
url-not-http = «{ $url }» — не http(s)-ссылка
url-bad-subs-lang = «{ $lang }» — не код языка субтитров
url-cookies-not-file = { $path } — не файл cookies.txt до 1 МБ
url-cookies-empty-or-large = cookies.txt пуст или больше 1 МБ
url-thread-failed = поток загрузки не запустился: { $error }
url-cookies-gone = cookies.txt этой загрузки пропал из её папки — начните загрузку заново с cookies
url-disk-space = нужно около { $need } МБ, свободно { $free } МБ
url-no-subs = у видео нет субтитров «{ $lang }», загруженных людьми (есть: { $have })
url-no-subs-none = у видео нет субтитров «{ $lang }», загруженных людьми (есть: никаких)
url-no-media-file = yt-dlp закончил, но файла видео нет в { $path }: { $stderr }
url-subs-failed = субтитры «{ $lang }» не скачались ({ $code }): { $error }
url-ytdlp-start = запуск yt-dlp: { $error }
url-ytdlp-wait = ожидание yt-dlp: { $error }
url-still-downloading = { $id } ещё качается
url-cancelled-removed = { $id } отменена, скачанное удалено: начните новую загрузку
url-still-stopping = { $id } ещё останавливается — повторите через пару секунд
url-cancel-first = { $id } ещё качается — сначала отмените
url-no-subs-file = yt-dlp закончил без файла субтитров в { $path }: { $stderr }
url-no-parent = { $path } без родителя
url-subs-empty = в субтитрах { $path } нет ни одной реплики
url-ytdlp-missing = компонент ytdlp не скачан
url-bad-quality = качество «{ $quality }»: best, 1080, 720, 480 или audio

ytdlp-update-missing = обновление yt-dlp { $version } ({ $path }) не на месте — работает закреплённая { $pinned }
ytdlp-http-client = http-клиент: { $error }
ytdlp-tag-not-version = релиз yt-dlp с тегом «{ $tag }» — не версия
ytdlp-no-checksum = в { $url } нет { $file }
ytdlp-new-says = новый yt-dlp { $tag } называет себя «{ $said }» — остаётся { $current }
ytdlp-new-failed = новый yt-dlp { $tag } не запустился: { $error } — остаётся { $current }
ytdlp-too-large = { $url }: больше { $limit } байт
ytdlp-sha-mismatch = { $url }: SHA-256 { $got } не совпал с SHA2-256SUMS { $want }
ytdlp-exit-code = код выхода { $code }: { $stderr }
ytdlp-component-missing = компонент ytdlp (yt-dlp и deno) не скачан
ytdlp-no-ffmpeg = нет ffmpeg: ни компонента ffmpeg, ни ffmpeg.exe в PATH
ytdlp-start = запуск { $program }: { $error }
ytdlp-timeout = yt-dlp не ответил за { $seconds } с: { $stderr }
ytdlp-playlist = по ссылке плейлист или канал ({ $count } видео), а не одно видео
ytdlp-redirect-only = по ссылке нет самого видео, только ссылка дальше
ytdlp-live = эфир ({ $status })
ytdlp-thumbnail-not-image = превью не картинка ({ $mime })
ytdlp-thumbnail-too-large = превью больше 4 МБ
ytdlp-failed-silently = yt-dlp завершился с ошибкой без сообщения
url-needs-project = видео по ссылке скачивается в проект: нужен project_id, проект, открытый в окне
tools-unsupported-os = видео по ссылке скачиваются на Windows и Linux
tools-incomplete = инструмент { $tool } после загрузки неполный: { $files }
chat-too-many-turns = помощник сделал { $turns } { $turns ->
    [one] шаг
    [few] шага
   *[many] шагов
} и не закончил: попросите его продолжить
chat-empty = выберите модель и напишите сообщение
assistant-no-agent = К VideoSOS не подключён агент. Подключите его к MCP-серверу (Настройки, «Агенты») или выберите ассистентом OpenRouter.
assistant-no-answer = Агент не ответил за { $minutes } мин.

# Локальная генерация (stable-diffusion.cpp на этом компьютере)
local-price = бесплатно, на этом компьютере
local-field-prompt = Промпт
local-field-size = Размер
local-field-duration = Длительность
local-field-first-frame = Первый кадр
local-field-negative = Негативный промпт
local-field-steps = Шаги
local-field-cfg = Следование промпту (CFG)
local-field-seed = Сид
local-field-preset = Ускорение
local-field-preset-hint = Ускоритель модели от её авторов или известной лаборатории: меньше шагов — быстрее; файлы скачиваются вместе с моделью
local-field-steps-hint = Пусто — столько, на сколько обучен выбранный ускоритель
local-field-cfg-hint = Пусто — значение выбранного ускорителя
local-preset = { $name }, { $steps ->
    [one] { $steps } шаг
    [few] { $steps } шага
   *[many] { $steps } шагов
}
local-preset-full = Без ускорения, полное качество
local-unknown-preset = у { $model } нет пресета { $preset }; его пресеты: { $presets }
studio-description = { $studio }, запущенная на этом компьютере: песня делается в ней и остаётся в её библиотеке, сюда приходит копия. Настройки — её собственные, как в самой студии.
studio-offline = { $studio } не запущена: откройте её, чтобы делать песни отсюда
studio-no-job = { $studio } не начала песню
studio-cancelled = { $studio }: песня отменена
studio-no-song = { $studio } закончила без файла песни
local-engine-missing = движок генерации для { $device } не установлен: установите его в Настройках, «Локальные модели»
local-unsupported = локальная генерация пока недоступна на этой системе
local-unknown = нет локальной модели или движка { $what }
local-install-busy = уже идёт другая загрузка локальной модели; дождитесь её окончания
local-model-missing = { $model } не скачана: скачайте её в Настройках, «Локальные модели»
local-ffmpeg-missing = для локального видео нужен ffmpeg: скачайте модель ещё раз, он придёт вместе с ней
local-no-prompt = пустой промпт
local-bad-size = такой размер эта модель не делает
local-not-loaded = модель не удержалась в памяти
local-no-frames = модель не вернула кадров
local-bad-frame = первый кадр не похож на картинку, которую VideoSOS может прочитать
local-too-large = { $url }: больше ожидаемых { $size } байт
local-sha-mismatch = { $url }: SHA-256 { $got } не совпал с закреплённым { $want }
