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
    endpointId: "fal-ai/flux/dev",
    label: "Flux Dev",
    description: "Generate a video from a text prompt",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/flux/schnell",
    label: "Flux Schnell",
    description: "Generate a video from a text prompt",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/flux-pro/v1.1-ultra",
    label: "Flux Pro 1.1 Ultra",
    description: "Generate a video from a text prompt",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/stable-diffusion-v35-large",
    label: "Stable Diffusion 3.5 Large",
    description: "Image quality, typography, complex prompt understanding",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/minimax/video-01-live",
    label: "Minimax Video 01 Live",
    description: "High quality video, realistic motion and physics",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/hunyuan-video",
    label: "Hunyuan",
    description: "High visual quality, motion diversity and text alignment",
    cost: "",
    category: "video",
  },
  {
    endpointId: "fal-ai/kling-video/v1.5/pro",
    label: "Kling 1.5 Pro",
    description: "High quality video",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/kling-video/v1/standard/text-to-video",
    label: "Kling 1.0 Standard",
    description: "High quality video",
    cost: "",
    category: "video",
    inputAsset: [],
    cameraControl: true,
  },
  {
    endpointId: "fal-ai/luma-dream-machine",
    label: "Luma Dream Machine 1.5",
    description: "High quality video",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/minimax-music",
    label: "Minimax Music",
    description:
      "Advanced AI techniques to create high-quality, diverse musical compositions",
    cost: "",
    category: "music",
    inputAsset: [
      {
        type: "audio",
        key: "reference_audio_url",
      },
    ],
  },
  {
    endpointId: "fal-ai/mmaudio-v2",
    label: "MMAudio V2",
    description:
      "MMAudio generates synchronized audio given video and/or text inputs. It can be combined with video models to get videos with audio.",
    cost: "",
    inputAsset: ["video"],
    category: "video",
  },
  {
    endpointId: "fal-ai/sync-lipsync",
    label: "sync.so -- lipsync 1.8.0",
    description:
      "Generate realistic lipsync animations from audio using advanced algorithms for high-quality synchronization.",
    cost: "",
    inputAsset: ["video", "audio"],
    category: "video",
  },
  {
    endpointId: "fal-ai/stable-audio",
    label: "Stable Audio",
    description: "Stable Diffusion music creation with high-quality tracks",
    cost: "",
    category: "music",
  },
  {
    endpointId: "fal-ai/playht/tts/v3",
    label: "PlayHT TTS v3",
    description: "Fluent and faithful speech with flow matching",
    cost: "",
    category: "voiceover",
    initialInput: {
      voice: "Dexter (English (US)/American)",
    },
  },
  {
    endpointId: "fal-ai/playai/tts/dialog",
    label: "PlayAI Text-to-Speech Dialog",
    description:
      "Generate natural-sounding multi-speaker dialogues. Perfect for expressive outputs, storytelling, games, animations, and interactive media.",
    cost: "",
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
    endpointId: "fal-ai/f5-tts",
    label: "F5 TTS",
    description: "Fluent and faithful speech with flow matching",
    cost: "",
    category: "voiceover",
    initialInput: {
      ref_audio_url:
        "https://github.com/SWivid/F5-TTS/raw/21900ba97d5020a5a70bcc9a0575dc7dec5021cb/tests/ref_audio/test_en_1_ref_short.wav",
      ref_text: "Some call me nature, others call me mother nature.",
      model_type: "F5-TTS",
      remove_silence: true,
    },
  },
  {
    endpointId: "fal-ai/veo2",
    label: "Veo 2",
    description:
      "Veo creates videos with realistic motion and high quality output, up to 4K.",
    cost: "",
    category: "video",
  },
  {
    endpointId: "fal-ai/ltx-video-v095/multiconditioning",
    label: "LTX Video v0.95 Multiconditioning",
    description: "Generate videos from prompts,images using LTX Video-0.9.5",
    cost: "",
    imageForFrame: true,
    category: "video",
  },
  {
    endpointId: "fal-ai/topaz/upscale/video",
    label: "Topaz Video Upscale",
    description:
      "Professional-grade video upscaling using Topaz technology. Enhance your videos with high-quality upscaling.",
    cost: "",
    category: "video",
    prompt: false,
    inputAsset: ["video"],
  },
  {
    endpointId: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    label: "Kling 2.5 Turbo Pro (Text)",
    description:
      "Top-tier text-to-video generation with unparalleled motion fluidity, cinematic visuals, and exceptional prompt precision",
    cost: "",
    category: "video",
  },
  {
    endpointId: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    label: "Kling 2.5 Turbo Pro (Image)",
    description:
      "Top-tier image-to-video generation with unparalleled motion fluidity and cinematic visuals",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/decart/lucy-5b/image-to-video",
    label: "Lucy-5B",
    description:
      "5-second I2V videos in under 5 seconds, achieving >1x RTF end-to-end",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    label: "MiniMax Hailuo-02 Standard",
    description:
      "Advanced image-to-video generation with 768p and 512p resolutions",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/pixverse/v5/image-to-video",
    label: "PixVerse v5",
    description:
      "Generate high quality video clips from text and image prompts",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/wan-25-preview/text-to-video",
    label: "Wan 2.5 (Text)",
    description: "Wan 2.5 text-to-video model",
    cost: "",
    category: "video",
  },
  {
    endpointId: "fal-ai/wan-25-preview/image-to-video",
    label: "Wan 2.5 (Image)",
    description: "Wan 2.5 image-to-video model",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/lynx",
    label: "Lynx",
    description: "Generate subject consistent videos from ByteDance",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/bytedance/omnihuman/v1.5",
    label: "OmniHuman v1.5",
    description:
      "Generates video using an image of a human figure paired with an audio file with vivid emotions and movements",
    cost: "",
    category: "video",
    inputAsset: ["image", "audio"],
  },
  {
    endpointId: "fal-ai/infinitalk/video-to-video",
    label: "Infinitalk",
    description:
      "Generates talking avatar video from image and audio with natural facial expressions and lip-sync",
    cost: "",
    category: "video",
    inputAsset: ["image", "audio"],
  },
  {
    endpointId: "fal-ai/hunyuan-image/v3/text-to-image",
    label: "Hunyuan Image 3.0",
    description:
      "State-of-the-art image generation with effective visual content messaging",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/imagen4/preview",
    label: "Imagen 4",
    description: "Google's highest quality image generation model",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/recraft/v3/text-to-image",
    label: "Recraft V3",
    description:
      "SOTA image generation with long text rendering, vector art, and brand style capabilities",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/hidream-i1-full",
    label: "HiDream-I1 Full",
    description:
      "17B parameter open-source model achieving state-of-the-art image generation quality",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/qwen-image",
    label: "Qwen Image",
    description:
      "Advanced text rendering and precise image editing capabilities",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/wan-25-preview/text-to-image",
    label: "Wan 2.5 (Text-to-Image)",
    description: "Wan 2.5 text-to-image model",
    cost: "",
    category: "image",
  },
  {
    endpointId: "fal-ai/wan-25-preview/image-to-image",
    label: "Wan 2.5 (Image-to-Image)",
    description: "Wan 2.5 image-to-image model",
    cost: "",
    category: "image",
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/topaz/upscale/image",
    label: "Topaz Image Upscale",
    description: "Professional-grade image upscaling using Topaz technology",
    cost: "",
    category: "image",
    prompt: false,
    inputAsset: ["image"],
  },
  {
    endpointId: "fal-ai/chatterbox/text-to-speech",
    label: "Chatterbox TTS",
    description:
      "High-quality text-to-speech for memes, videos, games, and AI agents",
    cost: "",
    category: "voiceover",
  },
  {
    endpointId: "fal-ai/minimax/speech-02-hd",
    label: "MiniMax Speech-02 HD",
    description:
      "High-quality text-to-speech with advanced AI techniques and different voices",
    cost: "",
    category: "voiceover",
  },
  {
    endpointId: "fal-ai/dia-tts/voice-clone",
    label: "Dia TTS Voice Clone",
    description:
      "Clone dialog voices from sample audio and generate dialogs from text prompts",
    cost: "",
    category: "voiceover",
    inputAsset: ["audio"],
  },
  {
    endpointId: "mirelo-ai/sfx-v1/video-to-audio",
    label: "Mirelo SFX v1",
    description: "Generate synced sound effects for any video",
    cost: "",
    category: "music",
    inputAsset: ["video"],
  },
];
