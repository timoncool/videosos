<div align="center">

<img src="docs/brand/icon.svg" width="88" alt="Логотип VideoSOS"/>

# VideoSOS 2

**Десктопная AI-видеостудия: генерируйте картинки, видео, музыку, озвучку, звуки и тексты лучшими моделями OpenRouter, fal и Runware или бесплатно на своей видеокарте, планируйте фильм на раскадровке, узловом холсте и в 3D-блокинге и монтируйте всё на настоящем многодорожечном таймлайне в готовый ролик. Одна нативная программа (Rust + Tauri) для Windows, Linux и macOS, ваши ключи, ваши файлы на вашем диске и MCP-сервер, чтобы ИИ-агент собирал видео вместе с вами.**

[![License](https://img.shields.io/github/license/timoncool/videosos?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/timoncool/videosos?style=flat-square)](https://github.com/timoncool/videosos/stargazers)
[![Latest release](https://img.shields.io/github/v/release/timoncool/videosos?style=flat-square)](https://github.com/timoncool/videosos/releases)
[![Downloads](https://img.shields.io/github/downloads/timoncool/videosos/total?style=flat-square)](https://github.com/timoncool/videosos/releases)
[![Last commit](https://img.shields.io/github/last-commit/timoncool/videosos?style=flat-square)](https://github.com/timoncool/videosos/commits)

[English](README.md) · **Русский** · [中文](README.zh.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md)

### 🌐 [Сайт со всеми экранами →](https://timoncool.github.io/videosos/ru.html)

![VideoSOS 2 — генерация и монтаж в одном окне](docs/screenshots/editor-ru.webp)

</div>

## Что это

**VideoSOS 2** соединяет AI-генерацию и видеомонтаж в одном окне. Слева выбираете, что сделать — картинку,
правку картинки, видео из текста или из кадра, говорящую голову с липсинком, апскейл, удаление фона, музыку,
озвучку, звуки, расшифровку или сценарий, — и модель **OpenRouter, fal или Runware**. Форма строится по описанию
самой модели, поэтому в ней все настройки, которые модель принимает, а цена видна **до** нажатия «Создать».
Результат попадает в медиатеку проекта и, если нужно, сразу на таймлайн в позицию плейхеда.

Редактор — полноценный NLE: много видео- и аудиодорожек, подрезка со сдвигом и без, переходы, ключевые кадры с
графиком Безье, маски, режимы наложения, цветокоррекция со скопами, текст и фигуры, субтитры и быстрый экспорт в
MP4, WebM, MOV или MKV на видеокарте — или FCPXML для Final Cut, DaVinci Resolve и Premiere. Громкость экспорта по желанию приводится к −14, −16 или −23 LUFS, а субтитры из расшифровки показываются целиком, по словам или караоке.

VideoSOS 1 был веб-приложением в браузере. **Вторая версия — нативная десктопная программа**: сервер на Rust,
проекты и генерации лежат обычными файлами на диске, задачи переживают перезапуск, и никакого нашего аккаунта — вы
платите провайдерам напрямую своими ключами. Окно говорит на десяти языках.

## Генерируйте всё

| Задача | Что получаете | Провайдеры |
|---|---|---|
| Картинка | из текста | OpenRouter, fal, Runware |
| Правка картинки | по референсам или маске | OpenRouter, fal, Runware |
| Видео | из текста, с первого кадра, с первого и последнего, по референсам | OpenRouter, fal, Runware |
| Правка видео | видео в видео, продление, смена стиля | OpenRouter, fal, Runware |
| Липсинк | лицо говорит вашим аудио | fal, Runware |
| Апскейл | картинки и видео в большем разрешении | fal, Runware, OpenRouter (видео) |
| Убрать фон | вырезка с прозрачностью | fal, Runware |
| Музыка | песни и саундтреки | fal, Runware |
| Озвучка | речь десятками голосов на многих языках | OpenRouter, fal, Runware |
| Звуки | шумы и эффекты из текста или по видео | fal, Runware |
| Расшифровка | речь в текст | OpenRouter, fal |
| Текст | сценарии, промпты, идеи — любая LLM OpenRouter | OpenRouter |

- **Живые каталоги.** Модели читаются у самих провайдеров — больше тысячи, новые сверху, с тем, в чём каждая
  сильна, её ценой и обычным временем на вашем компьютере; избранные сверху, уходящие помечены.
- **Цена до запуска.** Ставки за секунду, разрешение, звук и входные картинки считаются по форме; после запуска
  записывается счёт самого провайдера. В Настройках, раздел «Провайдеры», видно, сколько потрачено сегодня
  и всего.
- **Сравнение моделей за один запуск.** Тот же промпт уходит ещё в одну-две модели, результаты стоят рядом.
- **Файлы на вход.** Перетащите картинку, клип или звук из медиатеки — или результат прошлой генерации — в слот:
  первый кадр, последний кадр, референсы, видео для липсинка. **«Продолжить с последнего кадра»** начинает
  следующий клип там, где закончился предыдущий.
- **Элементы.** Персонаж, предмет или место под именем со своими картинками: `@имя` в промпте отправляет его
  картинки модели референсами, и то же лицо возвращается из шота в шот.
- **Промпты с помощью.** Пресеты, `{{переменные}}`, которые заполняются при отправке, улучшение промпта языковой
  моделью, промпт по картинке и проверка длины по лимиту модели до оплаты.
- **Никогда не дважды.** Задача сохраняется до отправки; после перезапуска отправленная задача дожидается, а не
  отправляется заново. Результаты скачиваются сразу, пока ссылки провайдеров живы, и называются и помечаются по
  промпту.
- **Видео по ссылке.** Ссылка YouTube, любого сайта, который знает yt-dlp, или прямая ссылка на файл попадает в
  медиатеку с прогрессом, отменой и докачкой.
- **Генерация без конца.** Запуски повторяются с новыми сидами, пока вы их не остановите или один не упадёт.
- **Сколько потратил ключ.** Проверка ключа показывает расход и лимит OpenRouter и баланс Runware.

## Генерация на этом компьютере

Без ключа и без счёта: провайдер **«Локально»** стоит рядом с облачными (пока на Windows).

| Модель | Что делает | Ускорители |
|---|---|---|
| Qwen-Image 2.1 | картинки | Turbo 8 шагов, LightX2V Lightning 4, Viggle Turbo 6 |
| MiniMax-H3 | видео со своим звуком, по промпту или от первого кадра | LightX2V Turbo 8 и 4 шага |
| LTX-2.5 | видео со звуком, два прохода с апскейлером Lightricks ×2 | дистиллированная, 8 шагов |

- **stable-diffusion.cpp** запускает их на CUDA, Vulkan или процессоре; «Авто» выбирает видеокарту. Используются
  только квантованные веса (GGUF Q4, int8).
- **Настройки → Локальные модели** скачивают каждую модель и её движок один раз, с закреплённой версией, проверкой
  SHA-256 и докачкой. Файл, который уже есть у другой программы автора, берётся у неё (жёсткая ссылка на том же
  диске), а не скачивается, и в строке модели написано, откуда она взята.
- **Музыкальные студии автора.** Пока открыта [YuE2 Studio](https://github.com/timoncool/YuE2-Studio), [MiniMax Music3 Studio](https://github.com/timoncool/MiniMax-Music3-Studio) или [ACE-Step Studio](https://github.com/timoncool/ACE-Step-Studio), она появляется в «Музыке» со своей формой;
  песню делает сама студия, а её файл попадает в медиатеку со своими тегами.
- **Speech Studio.** Пока открыта Speech Studio, каждый её движок на этом компьютере (Qwen3-TTS, Supertonic 3, Drama 3,
  Higgs Audio) появляется в «Озвучке» с голосами и языками движка; текст озвучивает сама студия, файл попадает в медиатеку.
- **Свои модели окна** работают в самом окне: Parakeet Ultra (int8) и Whisper Large v3 Turbo (Q8) для расшифровки,
  Gemma 4 E4B для описания сцен и проверки склеек.

## Планируйте фильм

| | |
|---|---|
| ![Раскадровка](docs/screenshots/storyboard-ru.webp) | **Раскадровка.** Языковая модель делит сценарий на шоты; каждому шоту картиночная модель делает кадр, а видеомодель — клип, который начинается с этого кадра, и клипы встают на таймлайн один за другим. Дешёвые кадры утверждаются до платного видео. |
| ![Узловой холст](docs/screenshots/canvas-ru.webp) | **Узловой холст.** Текст, картинки, видео и генерации — узлы, связанные тем, что передают: промпт в картинку, картинку в видео. **Шаблоны workflow** ставят готовую цепочку на холст одним нажатием (кадр в видео, сравнение моделей, предметная съёмка, говорящая голова и другие); холст сохраняется файлом workflow, чтобы передать его. |
| ![3D-блокинг](docs/screenshots/blocking-ru.webp) | **3D-блокинг.** Опишите шот — модель промптов соберёт его из болванок, стоящих и сидящих людей, их перемещений и пути камеры. Посмотрите через камеру, сверху или вокруг, затем отдайте кадр видеомодели первым кадром или запишите движение камеры — до того, как хоть цент уйдёт на видео. |
| ![HTML-графика](docs/screenshots/graphics-ru.webp) | **HTML-графика.** Титры, плашки, счётчики и значки на HTML и CSS с живым превью, превращённые в клип с прозрачностью, который ложится поверх видео у плейхеда. |

Прямо на таймлайне: запуск, поставленный на таймлайн, рисуется там, где ляжет, пока идёт, а **часть любого клипа
можно сгенерировать заново** — отрезок вырезается, уходит в модель правки видео, и новый дубль ложится поверх.

## Для ИИ-агентов

Пока VideoSOS открыт, он отвечает по MCP на `http://127.0.0.1:8796/mcp`. Агент — Claude Code, Claude Desktop,
Cursor или Codex — делает то же, что окно: выбирает модели и читает их настройки, считает цену, генерирует, ждёт
результат, читает и правит таймлайн открытого проекта (каждая правка — шаг с отменой, который видно в окне),
разводит шот в 3D, делает HTML-графику, импортирует медиа, двигает плейхед, снимает картинку окна и экспортирует
видео. Каждое действие подписывается в окне и пишется в журнал событий.

```bash
claude mcp add --transport http videosos http://127.0.0.1:8796/mcp
```

Другие клиенты: `{ "mcpServers": { "videosos": { "type": "streamable-http", "url": "http://127.0.0.1:8796/mcp" } } }`.
Сервер отдаёт руководство как ресурс `videosos://skill` (промпт `videosos`) — тот же текст, что
[docs/mcp-skill.md](docs/mcp-skill.md).

- **Точки отката.** Таймлайн сохраняется перед каждой правкой агента; кнопка «Точки отката» рядом с отменой и
  повтором возвращает любую. Агент может отрепетировать правку (`dry_run`) и увидеть результат, ничего не трогая.
- **Предложения.** Когда в Настройках, раздел «Агенты», включено «Правки агента — после моего
  «Принять»», правка агента показывается простыми словами и применяется только после «Принять».
- **Лимит расходов.** Генерации платные: в том же разделе задаётся дневной лимит агентов, сверх которого `generate`
  отказывает. Подключиться могут только агенты на этом компьютере и окно самой программы; ключи провайдеров им
  никогда не показываются.
- **Чат в окне.** Вкладка «Чат» запускает выбранную модель OpenRouter с теми же инструментами — шаг за шагом, с ценой
  каждого шага и кнопкой «Стоп».
- **Подключённый агент как ассистент окна**, как в YuE2 Studio: если в «Настройки → Агенты» выбран агент MCP,
  улучшение промпта, промпт по картинке, раскадровка, блокинг и чат уходят агенту — без ключа и без оплаты. Гайды
  по промптам отдаются ресурсами `videosos://guide/prompt`, `picture` и `storyboard`.

## Скриншоты

Монтаж с панелью генерации, узловой холст с настоящей цепочкой, раскадровка, 3D-блокинг и HTML-графика — все экраны
на восьми языках есть на [сайте](https://timoncool.github.io/videosos/ru.html).

| | |
|---|---|
| ![Монтаж](docs/screenshots/editor-ru.webp) | ![Холст](docs/screenshots/canvas-ru.webp) |
| ![Раскадровка](docs/screenshots/storyboard-ru.webp) | ![3D-блокинг](docs/screenshots/blocking-ru.webp) |

## Быстрый старт

1. Скачайте из [последнего релиза](https://github.com/timoncool/videosos/releases/latest):
   `VideoSOS_<версия>_x64-setup.exe` (или `.msi`, или портативный `VideoSOS-<версия>-portable-windows-x64.zip`) для
   Windows, `.AppImage` или `.deb` для Linux, `.dmg` для macOS на Apple Silicon.
2. Создайте проект, откройте вкладку **Генерация** слева и вставьте ключ
   [OpenRouter](https://openrouter.ai/settings/keys), [fal](https://fal.ai/dashboard/keys) или
   [Runware](https://my.runware.ai/keys), когда программа попросит. Для начала хватит одного провайдера.
3. Выберите задачу и модель, напишите, что нужно, нажмите **Создать**.

Что и когда менялось — в [CHANGELOG.md](CHANGELOG.md), и кнопка с искрами наверху окна показывает это. Правила для
участников и агентов, пишущих код: [AGENTS.md](AGENTS.md).

## Требования

- **Windows** 10/11 x64 с Microsoft Edge WebView2 (установщик поставит, если его нет).
- **Linux** x86-64 (экспериментально): `.deb` или AppImage, WebKitGTK и GStreamer из системы.
- **macOS** 13 и новее на Apple Silicon (экспериментально).
- Видеокарта с WebGPU (любая свежая NVIDIA, AMD или Intel) для превью и быстрого экспорта.
- Интернет для облачной генерации; локальная генерация, монтаж и экспорт работают без него. Локальные
  видеомодели проверены на карте с 24 ГБ.

В Настройках, раздел «Сеть», есть прокси для провайдеров и загрузок и **«Доступ из сети»**: по умолчанию выключен;
включённый, он открывает тот же интерфейс в браузере на другом компьютере или телефоне по ключу доступа, а всё
работает здесь.

## Что программа скачивает

В программе есть всё, что нужно для монтажа и облачной генерации. Остальное скачивается, только когда вы об этом
просите, оттуда, где оно опубликовано, и каждый файл перед использованием сверяется с закреплёнными размером и
SHA-256: yt-dlp, Deno и ffmpeg — при первом импорте видео по ссылке (потом yt-dlp обновляется сам раз в день), движок
stable-diffusion.cpp и локальные модели — когда вы скачиваете их в «Настройки → Локальные модели». На Linux
инструменты в Linux-сборках; на macOS импорт по ссылке пока недоступен; локальная генерация пока только на Windows.

Свои модели окна скачиваются с Hugging Face при первом использовании их функции и хранятся в кэше окна (очистка —
«Настройки → Хранилище»): Parakeet Ultra int8 и Whisper Large v3 Turbo Q8 для расшифровки, Gemma 4 E4B для описания
сцен, CLIP, MiniLM и CLAP для поиска и слов-паразитов, RIFE для интерполяции кадров.

<!-- downloads:start -->
| Инструмент | Зачем | Файл (прямая ссылка) | Размер | Куда |
|---|---|---|---|---|
| yt-dlp + Deno | импорт видео по ссылке | [yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe) | 17.8 MB | `data\tools\yt-dlp\` (как есть) |
|  |  | [deno-x86_64-pc-windows-msvc.zip](https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip) | 42.6 MB | `data\tools\yt-dlp\` (распакованным) |
| ffmpeg | склейка картинки и звука видео по ссылке | [ffmpeg-N-126342-gf88b741dbf-win64-gpl.zip](https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-N-126342-gf88b741dbf-win64-gpl.zip) | 170.7 MB | `data\tools\ffmpeg\` (ffmpeg.exe и ffprobe.exe из архива) |
| stable-diffusion.cpp CUDA 12 | локальная генерация на картах NVIDIA | [sd-master-1d0a58a-bin-win-cuda12-x64.zip](https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-cuda12-x64.zip)<br>[cudart-sd-bin-win-cu12-x64.zip](https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/cudart-sd-bin-win-cu12-x64.zip) | 901.5 MB | `data\tools\sd\cuda12\` (распакованным) |
| stable-diffusion.cpp Vulkan | локальная генерация на других картах | [sd-master-1d0a58a-bin-win-vulkan-x64.zip](https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-vulkan-x64.zip) | 30.2 MB | `data\tools\sd\vulkan\` (распакованным) |
| stable-diffusion.cpp CPU | локальная генерация без видеокарты | [sd-master-1d0a58a-bin-win-cpu-x64.zip](https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-cpu-x64.zip) | 17.6 MB | `data\tools\sd\cpu\` (распакованным) |
| Qwen-Image 2.1 | картинки на этом компьютере, по желанию | [Qwen3VL-8B-Instruct-Q4_K_M.gguf](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/f982a07559d4a2f6c8744d840bf6fccab30eea96/Qwen3VL-8B-Instruct-Q4_K_M.gguf) → `data\models\qwen-image-2.1\Qwen3VL-8B-Instruct-Q4_K_M.gguf`<br>[qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/a8342359c61979b06a8dafb1a47991fe1f30e994/vae/qwen_image_2.1_vae_bf16.safetensors) → `data\models\qwen-image-2.1\qwen_image_2.1_vae_bf16.safetensors`<br>[qwen-image-2.1-turbo-Q4_K_M.gguf](https://huggingface.co/unsloth/Qwen-Image-2.1-Turbo-GGUF/resolve/5d1f9f759ea877ae556cda88dbec958b62ad3809/qwen-image-2.1-turbo-Q4_K_M.gguf) → `data\models\qwen-image-2.1\qwen-image-2.1-turbo-Q4_K_M.gguf`<br>[pytorch_lora_weights.safetensors](https://huggingface.co/lightx2v/Qwen-Image-2.1-Lightning/resolve/6b0a1176327c01522a44276c5da67331a025b6fc/pytorch_lora_weights.safetensors) → `data\models\qwen-image-2.1\loras\qwen-image-2.1-lightning-4step.safetensors`<br>[Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors](https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/009a44a895ef85f7e643c80fdca9543795248867/Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors) → `data\models\qwen-image-2.1\loras\qwen-image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors`<br>[qwen-image-2.1-Q4_K_M.gguf](https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF/resolve/2c31ccd392b367a6637841a143813320a02dff55/qwen-image-2.1-Q4_K_M.gguf) → `data\models\qwen-image-2.1\qwen-image-2.1-Q4_K_M.gguf` | 15.5 GB | как есть, по пути после стрелки |
| MiniMax-H3 | видео со звуком на этом компьютере, по желанию | [minimax_h3_fl2va_pruned-Q4_K.gguf](https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/minimax_h3_fl2va_pruned-Q4_K.gguf) → `data\models\minimax-h3\minimax_h3_fl2va_pruned-Q4_K.gguf`<br>[qwen3vl_32b_minimax_h3-Q4_K_M.gguf](https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/qwen3vl_32b_minimax_h3-Q4_K_M.gguf) → `data\models\minimax-h3\qwen3vl_32b_minimax_h3-Q4_K_M.gguf`<br>[minimax_h3_video_vae_fp16.safetensors](https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/vae/minimax_h3_video_vae_fp16.safetensors) → `data\models\minimax-h3\minimax_h3_video_vae_fp16.safetensors`<br>[minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/vae/minimax_h3_audio_vae_fp32.safetensors) → `data\models\minimax-h3\minimax_h3_audio_vae_fp32.safetensors`<br>[minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors](https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors) → `data\models\minimax-h3\loras\minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`<br>[minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors](https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors) → `data\models\minimax-h3\loras\minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors` | 39.4 GB | как есть, по пути после стрелки |
| LTX-2.5 | видео со звуком на этом компьютере, по желанию | [ltx-2.5-22b-distilled-Q4_K_M.gguf](https://huggingface.co/unsloth/LTX-2.5-GGUF/resolve/6eae90030f7f15460a0ecf9ab16445d676b2bbb6/distilled/ltx-2.5-22b-distilled-Q4_K_M.gguf) → `data\models\ltx-2.5\ltx-2.5-22b-distilled-Q4_K_M.gguf`<br>[gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors](https://huggingface.co/PulpCut/LTX-2.5-INT8-ConvRot-safetensors/resolve/7597fb305b4cab9e7ff2c1d1e9551279c2932f0f/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors) → `data\models\ltx-2.5\gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`<br>[ltx-2.5-video-vae-conv-bf16.safetensors](https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/vae/ltx-2.5-video-vae-conv-bf16.safetensors) → `data\models\ltx-2.5\ltx-2.5-video-vae-conv-bf16.safetensors`<br>[ltx-2.5-audio-vae-bf16.safetensors](https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/vae/ltx-2.5-audio-vae-bf16.safetensors) → `data\models\ltx-2.5\ltx-2.5-audio-vae-bf16.safetensors`<br>[ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors](https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors) → `data\models\ltx-2.5\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` | 31.8 GB | как есть, по пути после стрелки |
<!-- downloads:end -->

## Где ваши файлы

На Windows всё лежит рядом с программой (или в `%LOCALAPPDATA%\VideoSOS`, если в её папку нельзя писать); на Linux —
в `~/.local/share/videosos` (`$XDG_DATA_HOME`), на macOS — в `~/Library/Application Support/VideoSOS`.
`data\workspace` — проекты, медиа, миниатюры и экспорт; `data\generations` — файлы всех генераций;
`secrets` — ключи провайдеров; `data\videosos.db` — история генераций. Удаление программы их оставляет, если не
отметить «Удалить данные приложения».

## Проблемы и решения

**Установщик останавливается на WebView2.** Окно работает на Microsoft Edge WebView2, и установщик скачивает его, если
в Windows его нет. На заблокированном соединении это не удаётся: поставьте WebView2 автономным установщиком Microsoft,
[Evergreen Standalone x64](https://go.microsoft.com/fwlink/p/?LinkId=2124701), и запустите установщик VideoSOS снова.

**Генерация упала.** Карточка говорит, что это был за сбой; «Текст ошибки» показывает слова самого провайдера, а
пропавший или отклонённый ключ открывает раздел «Провайдеры». Отправленная задача сама не отправляется
повторно: нажмите «Ещё раз» на её карточке, когда захотите новую попытку.

**Видео по ссылке останавливается на «подтвердите, что вы не бот».** Сайту нужен браузер с входом: выгрузите
`cookies.txt` из браузера, где вы вошли на сайт, и добавьте его в окне ссылки («Добавить cookies.txt»).

**Правка видео OpenRouter не берёт файл с этого компьютера.** OpenRouter принимает исходное видео только ссылкой
`https`; для локального файла возьмите модель правки видео fal или Runware либо видео, добавленное по ссылке.

**Превью или экспорт медленные или не стартуют.** Оба работают на WebGPU и видеокодере видеокарты. Обновите драйвер;
если карта не может закодировать выбранные настройки, окно экспорта скажет об этом — выберите другой кодек или
контейнер.

## Анонимная статистика и новости

На экране первого запуска есть переключатель **Отправлять анонимную статистику**; он же — в Настройках, раздел
«Приватность». Пока он включён, программа раз в день отправляет: случайный id установки, версию, ОС и язык
окна, сколько генераций завершилось или упало по задачам и на каких моделях. Никогда — промпты, файлы, ключи или
что-то личное. `DO_NOT_TRACK=1` или `STUDIO_TELEMETRY=0` выключает это полностью.

## Как устроено

- `crates/vs-providers` — OpenRouter, fal и Runware, приведённые к одному контракту: каталог, форма по JSON-схеме
  модели, правило цены, задачи, которые заканчиваются файлами. Задачи Runware проверяются по схеме модели до
  отправки, так что неверная настройка ничего не стоит.
- `crates/vs-server` — axum на 127.0.0.1: рабочая папка редактора на диске, очередь задач в SQLite, ключи, расходы,
  точки отката, импорт по ссылке, MCP-сервер и мост к окну.
- `frontend` — окно редактора: форк [FreeCut](https://github.com/walterlow/freecut) (MIT) как git subtree, с
  хранилищем, переведённым на сервер, и добавленными панелью генерации, раскадровкой, холстом, 3D-блокингом,
  HTML-графикой, настройками и мостом агента.
- `desktop` — оболочка Tauri: один процесс, сервер внутри, обновления с релизов GitHub.

### Сборка из исходников

```bash
git clone https://github.com/timoncool/videosos.git
cd videosos

npm --prefix frontend ci && npm --prefix frontend run build   # 1) окно
npm --prefix desktop ci && npm --prefix desktop run build     # 2) программа с сервером внутри
```

Нужны Node 20+ и Rust (версия закреплена в `rust-toolchain.toml`; на Windows — MSVC). Программа появится в
`desktop/src-tauri/target/release` и найдёт окно в репозитории. `cargo run -p vs-server` запускает один сервер — для
браузера на `http://127.0.0.1:8796`. Установщики и пакеты собирают `scripts/build-release.ps1` (Windows),
`scripts/build-release-linux.sh` в Docker (Linux) и `scripts/build-release-macos.sh` (macOS).

### Linux и macOS (экспериментально)

`.deb`, AppImage и `.dmg` собираются из того же кода. Сервер и окно проверены на Linux через браузер — проект создан,
сохранён и экспортирован на диск Linux, — но автор работает на Windows и не запускал окна программы на настоящем
Linux или Mac. **Если вы живёте на Linux или macOS, будет здорово, если вы их отполируете и пришлёте исправления
пулреквестом.** Сборка macOS подписана ad-hoc и не нотаризована, поэтому первый запуск macOS попросит разрешить в
Системных настройках, «Конфиденциальность и безопасность».

## Ещё портативные AI-программы

| Проект | Что это |
|--------|----------|
| [Dub Studio](https://github.com/timoncool/dub-studio) | Офлайн-дубляж видео с клонированием голоса |
| [YuE2 Studio](https://github.com/timoncool/YuE2-Studio) | Генератор песен с редактируемой партитурой |
| [MiniMax Music3 Studio](https://github.com/timoncool/MiniMax-Music3-Studio) | Локальная и облачная музыкальная студия |
| [ACE-Step Studio](https://github.com/timoncool/ACE-Step-Studio) | Музыкальная студия — песни, вокал, каверы, клипы |
| [Higgs Ultimate](https://github.com/timoncool/Higgs-Ultimate) | Нативный синтез речи и клонирование голоса |

## Авторы

- **Nerual Dreming** — [Telegram](https://t.me/nerual_dreming) | [neuro-cartel.com](https://neuro-cartel.com) | основатель [ArtGeneration.me](https://artgeneration.me)
- **Нейро-Софт** — [Telegram](https://t.me/neuroport) | портативные AI-программы

## Благодарности

- **[FreeCut](https://github.com/walterlow/freecut)** Уолтера Лоу — редактор, на котором построено окно (MIT).
- **[OpenRouter](https://openrouter.ai)**, **[fal](https://fal.ai)** и **[Runware](https://runware.ai)** — провайдеры и
  авторы моделей за ними.
- **[mediabunny](https://github.com/Vanilagy/mediabunny)**, **[three.js](https://threejs.org)**,
  **[React Flow](https://reactflow.dev)**, **[modern-screenshot](https://github.com/qq15725/modern-screenshot)**,
  **[Tauri](https://tauri.app)**, **[axum](https://github.com/tokio-rs/axum)**,
  **[jsonschema](https://github.com/Stranger6667/jsonschema)**, **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**,
  **[FFmpeg](https://ffmpeg.org)**, **[lucide](https://lucide.dev)**.
- Идеи взяты у LTX Studio (раскадровка), Weave и Flora (холст и шаблоны), AIMovieStudio (превиз), WeftCut
  (моушн-графика, точки отката), OpenChatCut (предложения), Kling (элементы) и Descript (FCPXML).
- VideoSOS 1 начинался как форк **[fal AI Video Starter Kit](https://github.com/fal-ai-community/video-starter-kit)**.

## Поддержать автора

Я делаю открытый софт и исследую ИИ — почти всё, что я создаю, доступно бесплатно. Донаты помогают делать и
исследовать больше.

**[Все способы поддержки](DONATE.ru.md)** | **[dalink.to/nerual_dreming](https://dalink.to/nerual_dreming)** | **[boosty.to/neuro_art](https://boosty.to/neuro_art)**

- **BTC:** `1E7dHL22RpyhJGVpcvKdbyZgksSYkYeEBC`
- **ETH (ERC20):** `0xb5db65adf478983186d4897ba92fe2c25c594a0c`
- **USDT (TRC20):** `TQST9Lp2TjK6FiVkn4fwfGUee7NmkxEE7C`

## История звёзд

<a href="https://github.com/timoncool/videosos/stargazers">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="docs/stars-dark.svg" />
   <source media="(prefers-color-scheme: light)" srcset="docs/stars-light.svg" />
   <img alt="График звёзд" src="docs/stars-light.svg" />
 </picture>
</a>

## Лицензия

Код — [MIT](LICENSE); окно редактора основано на FreeCut (MIT). То, что вы генерируете, подчиняется условиям
провайдера и модели, которыми вы пользовались, — прочитайте их перед публикацией или продажей.
