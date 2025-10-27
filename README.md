# VideoSOS - Open-Source AI Video Editor with 100+ Models

[![GitHub stars](https://img.shields.io/github/stars/timoncool/videosos?style=social)](https://github.com/timoncool/videosos/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/timoncool/videosos?style=social)](https://github.com/timoncool/videosos/network/members)
[![GitHub issues](https://img.shields.io/github/issues/timoncool/videosos)](https://github.com/timoncool/videosos/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Remotion](https://img.shields.io/badge/Remotion-latest-blue)](https://remotion.dev)

Create professional videos with AI in your browser. Free, open-source video editor featuring Google Veo 3.1, FLUX, Gemini 2.5 Flash, Imagen 4, and 100+ top AI models for text-to-video, image-to-video, text-to-image generation, image editing, music composition, and voiceover creation. No uploads, complete privacy, advanced timeline editing.

**[🚀 Try the Live Demo](https://videosos.vercel.app/)** | [🇷🇺 Русская версия README](./README.ru.md)

## Screenshots

### Landing Page
![VideoSOS Landing Page](./public/screenshot-landing.png)

### Video Editor
![VideoSOS Video Editor](./public/screenshot-app.png)

---

## Key Features

### 🤖 100+ Top AI Models from lmarena.ai Leaderboard

Access the best AI models ranked by millions of users on lmarena.ai. VideoSOS integrates with **fal.ai** and **Runware.ai** to bring you cutting-edge AI generation capabilities:

- **🎬 Video Generation**: Text-to-video and image-to-video with state-of-the-art models including Google Veo 3.1, Kling 2.5, and Hailuo-02
- **🎨 Image Generation**: Text-to-image with cutting-edge models including Gemini 2.5 Flash, Imagen 4.0, FLUX.1 Pro, and Ideogram V3
- **✏️ Image Editing**: AI-powered photo editing with leading models including the #1 ranked Gemini 2.5 Flash Edit (8.6M votes)
- **🎵 Audio Generation**: Music composition with Stable Audio and natural voiceovers with multiple voices

Switch between providers seamlessly or use both simultaneously for maximum flexibility. [See complete model list below](#supported-ai-models).

### 🔒 100% Privacy-First Architecture
Everything runs locally in your browser. Your projects, media, and API keys are stored in IndexedDB on your device. No uploads, no tracking, no data collection.

### 🎬 Timeline Editor
Advanced multi-track video editing with drag-and-drop functionality, precise keyframe control, audio waveform visualization, and real-time preview. Support for multiple aspect ratios (16:9, 9:16, 1:1) perfect for social media platforms.

### 🎨 Multi-Modal Content Generation
Create complete video projects with AI-generated images, videos, background music, and voiceovers. Advanced features include camera movement controls, video upscaling with Topaz, and automatic lip-sync for voiceovers.

### ⚡ Client-Side Video Processing
Powered by **FFmpeg.wasm** and **Remotion** for high-quality video rendering entirely in the browser. No server uploads, no waiting in queues. Export videos with proper audio mixing and precise timing control.

### 🌍 International & Accessible
Full internationalization support (English/Russian) with keyboard shortcuts for power users. Intuitive UI designed for both beginners and professionals.

## Supported AI Models

VideoSOS features 100+ AI models from the top rankings on [lmarena.ai](https://lmarena.ai/), the largest AI model leaderboard with millions of user votes. All models are available through dual provider support for maximum reliability.

### Complete Model List by Category

#### Text-to-Video Models
| Model | Provider | Description | Votes |
|-------|----------|-------------|-------|
| Veo 3.1 | FAL, Runware | Google's latest video model with native audio | NEW |
| Veo 3.1 Fast | FAL, Runware | Faster version of Veo 3.1 | NEW |
| Veo 3 | FAL, Runware | Cinematic video with synchronized audio | 1.3M |
| Veo 3 Fast | FAL | Fast cinematic video generation | 1.3M |
| Kling 2.5 | FAL, Runware | High-quality video synthesis | 1.6K |
| Hailuo-02 | FAL, Runware | Advanced video generation | 10K |

#### Image-to-Video Models
| Model | Provider | Description | Votes |
|-------|----------|-------------|-------|
| Veo 3.1 Image-to-Video | FAL | Animate images with Veo 3.1 | NEW |
| Veo 3.1 Fast Image-to-Video | FAL | Fast image animation | NEW |
| Veo 3 Image-to-Video | FAL, Runware | Animate static images | 1.3M |
| Veo 3 Fast Image-to-Video | FAL, Runware | Fast image animation | 1.3M |

#### Text-to-Image Models
| Model | Provider | Description | Votes |
|-------|----------|-------------|-------|
| Gemini 2.5 Flash Image | FAL, Runware | Ultra-fast image generation | 448K |
| Imagen 4.0 Ultra | FAL, Runware | Google's highest quality image model | 448K |
| Imagen 4.0 Preview Fast | FAL, Runware | Fast high-quality images | 447K |
| Hunyuan Image 3.0 | FAL, Runware | State-of-the-art image synthesis | 14K |
| Seedream 4.0 | FAL, Runware | High-resolution image generation | 33K |
| Seedream 3.0 | FAL, Runware | Quality image synthesis | 37K |
| GPT Image 1 | FAL, Runware | OpenAI's image model | 205K |
| FLUX.1 Pro | FAL, Runware | Professional image generation | Popular |
| Ideogram V3 | FAL, Runware | Text rendering in images | Popular |

#### Image Editing Models
| Model | Provider | Description | Votes |
|-------|----------|-------------|-------|
| Gemini 2.5 Flash Edit | FAL, Runware | #1 image editing model | 8.6M |
| FLUX.1 Kontext Pro | FAL, Runware | Context-aware editing | 5.4M |
| FLUX.1 Kontext Dev | FAL, Runware | Developer-friendly editing | 3.0M |
| FLUX.1 Kontext Max | FAL, Runware | Maximum quality editing | 339K |
| Qwen Image Edit | FAL, Runware | Intelligent image modification | 829K |
| Reve v1 Edit | FAL | Advanced editing capabilities | 2.8K |
| Seedream 4.0 Edit | FAL, Runware | High-quality transformations | 219K |
| GPT Image 1 Edit | FAL, Runware | OpenAI image editing | 2.1M |

### AI Providers

VideoSOS supports multiple AI providers simultaneously:

- **[fal.ai](https://fal.ai)** - Comprehensive AI model infrastructure with 50+ models for image, video, and audio generation
- **[Runware.ai](https://runware.ai)** - High-performance AI inference platform with 100+ models including FLUX, Google Imagen, Ideogram, Kling, and more

You can use either provider independently or both simultaneously. Simply add your API keys in the Settings dialog (click the gear icon in the app).

#### Getting API Keys

- **FAL API Key**: Get it from [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)
- **Runware API Key**: Sign up at [runware.ai](https://runware.ai) and get your key from the dashboard

Both API keys are stored locally in your browser and never sent to our servers.

### Tech Stack

- [fal.ai](https://fal.ai) - AI model infrastructure
- [Runware.ai](https://runware.ai) - High-performance AI inference platform
- [Next.js](https://nextjs.org) - React framework
- [Remotion](https://remotion.dev) - Video processing and composition
- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) - Client-side video processing
- [IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API) - Browser-based storage
- [next-intl](https://next-intl-docs.vercel.app/) - Internationalization
- [Vercel](https://vercel.com) - Deployment platform

### Quick Start

1. Clone the repository:

```bash
git clone https://github.com/timoncool/videosos
cd videosos
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

### Running with Docker

If you have Docker installed, you can run the project in a container:

1. Clone the repository:

```bash
git clone https://github.com/timoncool/videosos
cd videosos
```

2. Start services with Docker Compose:

```bash
docker compose up -d
```

3. Open [http://localhost:3000](http://localhost:3000) to see the application.

To stop services:

```bash
docker compose down
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=timoncool/videosos&type=Date)](https://star-history.com/#timoncool/videosos&Date)

## Roadmap

We're actively working on making VideoSOS even better! Here are the features and improvements we're planning:

### Timeline Enhancements
- **Segment Reordering** - Drag segments freely on the timeline to reorder them (currently they only bump into adjacent segments)
- **Click-to-Seek** - Click anywhere on the timeline to move the playhead cursor (currently only arrow keys work)
- **Volume Control** - Interactive volume adjustment with visual horizontal line controls for audio segments
- **Waveform Display** - Stretch audio waveforms to match full segment length on timeline

### Editing Features
- **Segment Duplication** - Ctrl+Drag to create copies of segments (standard video editor workflow)
- **Lip-sync Integration** - New Lip-sync tab with FAL lip-sync models (video + audio input)

### Generation Workflow
- **Persistent Sidebar** - Keep generation sidebar open after submission to queue multiple generations
- **Runware Status** - Show generation status in sidebar like FAL (currently locks until complete)
- **Keyboard Shortcuts** - Ctrl+Enter to submit generations
- **Advanced Parameters** - Expose additional model parameters (steps, resolution, guidance, etc.) where available

### Technical Improvements
- **Model Verification** - Verify and fix all models across all providers (some currently not working)
- **Server-side Rendering** - Optional server-side FFMPEG for faster video export (FFMPEG API integration)

Want to contribute? Pick an item from the roadmap and submit a PR! See our [Contributing Guide](CONTRIBUTING.md) for details.

## Contributing

We welcome contributions from developers of all skill levels! Whether you're fixing bugs, adding features, improving documentation, or sharing ideas, your help makes VideoSOS better for everyone.

**How to contribute:**
1. ⭐ Star this repository to show your support
2. 🐛 Report bugs or suggest features in [Issues](https://github.com/timoncool/videosos/issues)
3. 🔧 Submit pull requests - see our [Contributing Guide](CONTRIBUTING.md)
4. 📖 Improve documentation
5. 💬 Join discussions and help other users

Every contribution counts, no matter how small! Let's build the best open-source AI video editor together.

### Credits

Assembled by [Nerual Dreming](https://t.me/nerual_dreming) - founder of [ArtGeneration.me](https://artgeneration.me/), tech blogger, and neuro-evangelist.

This project was built with [Devin](https://app.devin.ai/invite/fdc44857a73c4afea4c0763e67c7a2d2), the AI software engineer. Experience autonomous coding with Devin's free trial.

This project is a fork of the original [AI Video Starter Kit](https://github.com/fal-ai-community/video-starter-kit) from the fal.ai community.

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
