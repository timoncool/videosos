# VideoSOS - Open-Source AI-Powered Video Editor

[![GitHub stars](https://img.shields.io/github/stars/timoncool/videosos?style=social)](https://github.com/timoncool/videosos/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/timoncool/videosos?style=social)](https://github.com/timoncool/videosos/network/members)
[![GitHub issues](https://img.shields.io/github/issues/timoncool/videosos)](https://github.com/timoncool/videosos/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Remotion](https://img.shields.io/badge/Remotion-latest-blue)](https://remotion.dev)

A powerful, browser-based AI video editor built for creators. Create stunning videos with 100+ AI models and advanced timeline editing.

**[🚀 Try the Live Demo](https://videosos.vercel.app/)** | [🇷🇺 Русская версия README](./README.ru.md)

## Demo Video

See VideoSOS in action:

![Demo Video](./Demo.mp4)

## Screenshots

### Landing Page
![VideoSOS Landing Page](./public/screenshot-landing.png)

### Video Editor
![VideoSOS Video Editor](./public/screenshot-app.png)

---

## Key Features

### 🤖 Dual AI Provider Support
Access 100+ state-of-the-art AI models through both **fal.ai** and **Runware.ai**. Generate images with FLUX and Ideogram V3, create videos with Veo 3 and Kling, compose music with Stable Audio, and produce natural voiceovers. Switch between providers seamlessly or use both simultaneously for maximum flexibility.

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
