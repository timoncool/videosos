"use client";

import { createFalClient } from "@fal-ai/client";

export const fal = createFalClient({
  credentials: () =>
    typeof window !== "undefined"
      ? (localStorage?.getItem("falKey") as string)
      : "",
});

export type InputAsset =
  | "video"
  | "image"
  | "audio"
  | {
      type: "video" | "image" | "audio";
      key: string;
    };

export type ApiInfo = {
  endpointId: string;
  label: string;
  description: string;
  cost: string;
  popularity: number;
  inferenceTime?: string;
  inputMap?: Record<string, string>;
  inputAsset?: InputAsset[];
  initialInput?: Record<string, unknown>;
  cameraControl?: boolean;
  imageForFrame?: boolean;
  category: "image" | "video" | "music" | "voiceover";
  prompt?: boolean;
};

export const AVAILABLE_ENDPOINTS: ApiInfo[] = [
  {
    endpointId: "fal-ai/flux-pro/kontext",
    label: "FLUX.1 Kontext [pro]",
    description:
      "Professional image generation with context-aware editing capabilities",
    cost: "$0.04/image",
    popularity: 5,
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/flux/dev",
    label: "FLUX.1 [dev]",
    description:
      "High-quality image generation model optimized for creative workflows",
    cost: "$0.025/megapixel",
    popularity: 5,
    category: "image",
  },
  {
    endpointId: "fal-ai/ideogram/v3",
    label: "Ideogram V3 (Text)",
    description:
      "Advanced text-to-image model with superior text rendering capabilities",
    cost: "$0.08/image",
    popularity: 5,
    category: "image",
  },
  {
    endpointId: "fal-ai/ideogram/v3/edit",
    label: "Ideogram V3 (Image)",
    description: "Image-to-image transformation with text rendering excellence",
    cost: "$0.08/image",
    popularity: 5,
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/recraft/v3/text-to-image",
    label: "Recraft V3",
    description: "Professional design-focused image generation",
    cost: "$0.0125/image",
    popularity: 5,
    category: "image",
  },
  {
    endpointId: "fal-ai/nano-banana",
    label: "Nano Banana",
    description: "Fast image editing with mask support",
    cost: "$0.03/image",
    popularity: 4,
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/stable-diffusion-v35-large",
    label: "Stable Diffusion 3.5 Large",
    description: "Latest Stable Diffusion with enhanced quality and control",
    cost: "$0.03/megapixel",
    popularity: 4,
    category: "image",
  },
  {
    endpointId: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell]",
    description: "Ultra-fast image generation model",
    cost: "$0.003/megapixel",
    popularity: 4,
    category: "image",
  },
  {
    endpointId: "fal-ai/imagen4/preview",
    label: "Imagen 4",
    description: "Google's latest image generation model",
    cost: "~$0.05/image",
    popularity: 4,
    category: "image",
  },
  {
    endpointId: "fal-ai/flux-pro/v1.1-ultra",
    label: "Flux Pro 1.1 Ultra",
    description: "Ultra high quality image generation",
    cost: "$0.06/image",
    popularity: 4,
    category: "image",
    inputMap: {
      image_url: "prompt",
    },
    inputAsset: ["image"],
    initialInput: {
      aspect_ratio: "16:9",
      raw: true,
    },
  },
  {
    endpointId: "fal-ai/hunyuan-image/v3/text-to-image",
    label: "Hunyuan Image 3.0",
    description: "Advanced image generation with style control",
    cost: "$0.1/megapixel",
    popularity: 3,
    category: "image",
  },
  {
    endpointId: "fal-ai/topaz/upscale/image",
    label: "Topaz Image Upscale",
    description: "Professional image upscaling",
    cost: "~$0.025/megapixel",
    popularity: 3,
    category: "image",
    prompt: false,
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/wan-25-preview/text-to-image",
    label: "Wan 2.5 (Text-to-Image)",
    description: "Wan 2.5 text-to-image model",
    cost: "TBA",
    popularity: 3,
    category: "image",
  },
  {
    endpointId: "fal-ai/wan-25-preview/image-to-image",
    label: "Wan 2.5 (Image-to-Image)",
    description: "Wan 2.5 image-to-image model",
    cost: "TBA",
    popularity: 3,
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/hidream-i1-full",
    label: "HiDream-I1 Full",
    description: "High-quality image generation with style presets",
    cost: "$0.05/megapixel",
    popularity: 2,
    category: "image",
  },
  {
    endpointId: "fal-ai/qwen-image",
    label: "Qwen Image",
    description: "Multimodal image generation and editing",
    cost: "~$0.03/megapixel",
    popularity: 2,
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/veo3/fast",
    label: "Veo 3 Fast (Text)",
    description: "Ultra-fast text-to-video generation with high quality",
    cost: "$0.20/sec",
    popularity: 5,
    category: "video",
  },
  {
    endpointId: "fal-ai/veo3/fast/image-to-video",
    label: "Veo 3 Fast (Image)",
    description: "Ultra-fast image-to-video generation",
    cost: "$0.10/sec",
    popularity: 5,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    label: "Kling 2.5 Turbo Pro (Text)",
    description:
      "Top-tier text-to-video generation with unparalleled motion fluidity",
    cost: "$0.35/5sec",
    popularity: 5,
    category: "video",
  },
  {
    endpointId: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    label: "Kling 2.5 Turbo Pro (Image)",
    description: "Top-tier image-to-video generation with cinematic visuals",
    cost: "$0.35/5sec",
    popularity: 5,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/luma-dream-machine",
    label: "Luma Dream Machine",
    description: "High quality video generation with Ray2 and Flash modes",
    cost: "$0.5/video",
    popularity: 5,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/pika/v2.2/text-to-video",
    label: "Pika 2.2 (Text)",
    description: "Advanced text-to-video with camera control",
    cost: "$0.20/5sec",
    popularity: 4,
    category: "video",
  },
  {
    endpointId: "fal-ai/pika/v2.2/image-to-video",
    label: "Pika 2.2 (Image)",
    description: "Image-to-video with advanced motion control",
    cost: "$0.20/5sec",
    popularity: 4,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/veo2",
    label: "Veo 2",
    description:
      "Veo creates videos with realistic motion and high quality output, up to 4K",
    cost: "$0.50/sec",
    popularity: 4,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/kling-video/v1.5/pro/text-to-video",
    label: "Kling 1.5 Pro",
    description: "High quality video generation",
    cost: "$0.1/sec",
    popularity: 4,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    label: "MiniMax Hailuo-02 (Text)",
    description: "Standard quality text-to-video generation",
    cost: "~$0.045/sec",
    popularity: 4,
    category: "video",
  },
  {
    endpointId: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    label: "MiniMax Hailuo-02 (Image)",
    description: "Image-to-video generation with motion control",
    cost: "~$0.045/sec",
    popularity: 4,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/hunyuan-video",
    label: "Hunyuan Video",
    description: "Open-source video foundation model with superior quality",
    cost: "$0.4/video",
    popularity: 4,
    category: "video",
    inputAsset: ["image"],
    initialInput: {
      flow_shift: 7,
      embedded_guidance_scale: 6,
    },
  },
  {
    endpointId: "fal-ai/minimax/video-01-live",
    label: "Minimax Video 01 Live",
    description: "Live-style video generation",
    cost: "~$0.5/video",
    popularity: 3,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/sync-lipsync",
    label: "sync.so lipsync",
    description: "Lip sync video with audio",
    cost: "~$0.7/min",
    popularity: 3,
    category: "video",
    inputAsset: ["video", "audio"],
  },
  {
    endpointId: "fal-ai/topaz/upscale/video",
    label: "Topaz Video Upscale",
    description: "Professional video upscaling",
    cost: "~$0.1/sec",
    popularity: 3,
    category: "video",
    prompt: false,
    inputAsset: ["video"],
  },
  {
    endpointId: "fal-ai/wan-25-preview/text-to-video",
    label: "Wan 2.5 (Text)",
    description: "Wan 2.5 text-to-video model",
    cost: "TBA",
    popularity: 3,
    category: "video",
  },
  {
    endpointId: "fal-ai/wan-25-preview/image-to-video",
    label: "Wan 2.5 (Image)",
    description: "Wan 2.5 image-to-video model",
    cost: "TBA",
    popularity: 3,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/ltx-video-v095/multiconditioning",
    label: "LTX Video v0.95",
    description: "Multi-conditional video generation",
    cost: "$0.04/video",
    popularity: 2,
    category: "video",
    imageForFrame: true,
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/bytedance/omnihuman/v1.5",
    label: "OmniHuman v1.5",
    description: "Human animation from video driving",
    cost: "TBA",
    popularity: 2,
    category: "video",
    inputAsset: ["image", "audio"],
  },
  {
    endpointId: "fal-ai/kling-video/v1/standard/text-to-video",
    label: "Kling 1.0 Standard",
    description: "Standard quality video generation",
    cost: "~$0.045/sec",
    popularity: 2,
    category: "video",
    cameraControl: true,
  },
  {
    endpointId: "fal-ai/pixverse/v5/image-to-video",
    label: "PixVerse v5",
    description:
      "Generate high quality video clips from text and image prompts",
    cost: "TBA",
    popularity: 2,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/mmaudio-v2",
    label: "MMAudio V2",
    description: "Audio generation for video",
    cost: "$0.001/sec",
    popularity: 2,
    category: "video",
    inputAsset: ["video"],
  },
  {
    endpointId: "fal-ai/decart/lucy-5b/image-to-video",
    label: "Lucy-5B",
    description: "5-second I2V videos in under 5 seconds",
    cost: "TBA",
    popularity: 1,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/lynx",
    label: "Lynx",
    description: "Generate subject consistent videos from ByteDance",
    cost: "TBA",
    popularity: 1,
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/infinitalk/video-to-video",
    label: "Infinitalk",
    description: "Generates talking avatar video from image and audio",
    cost: "TBA",
    popularity: 1,
    category: "video",
    inputAsset: ["image", "audio"],
  },
  {
    endpointId: "fal-ai/stable-audio",
    label: "Stable Audio",
    description: "Generate high-quality audio from text prompts",
    cost: "~$0.005/10sec",
    popularity: 4,
    category: "music",
    initialInput: {
      seconds_total: 30,
    },
  },
  {
    endpointId: "fal-ai/minimax-music",
    label: "Minimax Music",
    description: "Music generation with mood control",
    cost: "TBA",
    popularity: 4,
    category: "music",
    inputAsset: [
      {
        type: "audio",
        key: "reference_audio_url",
      },
    ],
  },
  {
    endpointId: "mirelo-ai/sfx-v1/video-to-audio",
    label: "Mirelo SFX v1",
    description: "Generate synced sound effects for any video",
    cost: "TBA",
    popularity: 3,
    category: "music",
    inputAsset: ["video"],
  },
  {
    endpointId: "fal-ai/minimax/speech-02-hd",
    label: "MiniMax Speech-02 HD",
    description: "High-definition text-to-speech",
    cost: "$0.05/1000 chars",
    popularity: 4,
    category: "voiceover",
  },
  {
    endpointId: "fal-ai/playht/tts/v3",
    label: "PlayHT TTS v3",
    description: "High-quality voice synthesis",
    cost: "TBA",
    popularity: 4,
    category: "voiceover",
    initialInput: {
      voice: "Dexter (English (US)/American)",
    },
  },
  {
    endpointId: "fal-ai/dia-tts/voice-clone",
    label: "Dia TTS Voice Clone",
    description: "Voice cloning from sample",
    cost: "$0.04/1000 chars",
    popularity: 3,
    category: "voiceover",
    inputAsset: ["audio"],
  },
  {
    endpointId: "fal-ai/playai/tts/dialog",
    label: "PlayAI Text-to-Speech Dialog",
    description: "Generate natural-sounding multi-speaker dialogues",
    cost: "TBA",
    popularity: 3,
    category: "voiceover",
    inputMap: {
      prompt: "input",
    },
    initialInput: {
      voices: [
        {
          voice: "Jennifer (English (US)/American)",
          turn_prefix: "Speaker 1: ",
        },
        {
          voice: "Furio (English (IT)/Italian)",
          turn_prefix: "Speaker 2: ",
        },
      ],
    },
  },
  {
    endpointId: "fal-ai/chatterbox/text-to-speech",
    label: "Chatterbox TTS",
    description: "Text-to-speech with preset voices",
    cost: "TBA",
    popularity: 2,
    category: "voiceover",
  },
  {
    endpointId: "fal-ai/f5-tts",
    label: "F5 TTS",
    description: "Multilingual text-to-speech",
    cost: "TBA",
    popularity: 2,
    category: "voiceover",
    initialInput: {
      ref_audio_url:
        "https://github.com/SWivid/F5-TTS/raw/21900ba97d5020a5a70bcc9a0575dc7dec5021cb/tests/ref_audio/test_en_1_ref_short.wav",
      ref_text: "Some call me nature, others call me mother nature.",
      model_type: "F5-TTS",
      remove_silence: true,
    },
  },
];
