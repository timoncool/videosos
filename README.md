# VideoSOS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Remotion](https://img.shields.io/badge/Remotion-latest-blue)](https://remotion.dev)

A powerful, open-source AI video editor built for creators. This is an enhanced fork of the original AI Video Starter Kit by the fal.ai community, redesigned to run entirely in the browser.

[🇷🇺 Русская версия README](./README.ru.md)

## Screenshots

### Landing Page
![VideoSOS Landing Page](./public/screenshot-landing.png)

### Video Editor
![VideoSOS Video Editor](./public/screenshot-app.png)

---

## Key Features

✅ **Dual AI Provider Support**: Use both fal.ai and Runware.ai simultaneously with 100+ AI models  
✅ **Fully Autonomous Operation**: No server dependencies, everything runs in your browser  
✅ **Local-First Architecture**: IndexedDB storage for complete privacy and offline capability  
✅ **Local Video Processing**: FFmpeg.wasm for client-side video assembly and processing  
✅ **Multi-Modal Content**: Generate and edit images, videos, music, and voiceovers  
✅ **Advanced Timeline**: Professional drag-and-drop editing with multiple tracks  
✅ **Video Thumbnails**: Automatic thumbnail generation for all video content  
✅ **Internationalization**: Full support for English and Russian languages  
✅ **Camera Controls**: Advanced camera movement controls for video generation  
✅ **Keyboard Shortcuts**: Efficient workflow with comprehensive keyboard shortcuts  
✅ **Aspect Ratio Options**: Flexible aspect ratios for different social media platforms  
✅ **Audio Waveforms**: Visual audio waveform rendering on timeline  
✅ **State-of-the-Art Models**: Latest AI models including Veo 2, LTX Video, FLUX, Ideogram V3, Kling, and more  
✅ **Video Upscaling**: Topaz-powered video enhancement and upscaling  
✅ **Lip-Sync Support**: Automatic lip-sync capabilities for voiceovers  
✅ **Professional Export**: High-quality video export with proper audio handling

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

### Contributing

Contributions are welcome! See the [Contributing Guide](CONTRIBUTING.md) for more information on how to get started.

### Credits

Assembled by [Nerual Dreming](https://t.me/nerual_dreming) - founder of [ArtGeneration.me](https://artgeneration.me/), tech blogger, and neuro-evangelist.

This project is a fork of the original [AI Video Starter Kit](https://github.com/fal-ai-community/video-starter-kit) from the fal.ai community.

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
