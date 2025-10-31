export type ModelCapabilities = {
  prompt: "required" | "optional" | "not_supported";
  negativePrompt: boolean;
  seed: boolean;
  seedImage: boolean;
  maskImage: boolean;
  outpainting: boolean;
  steps: { supported: boolean; min?: number; max?: number; default?: number };
  cfgScale: {
    supported: boolean;
    min?: number;
    max?: number;
    default?: number;
  };
  scheduler: boolean;
  clipSkip: boolean;
  checkNSFW: boolean;
  numberResults: boolean;
  outputQuality: boolean;
  outputFormats: Array<"JPG" | "PNG" | "WEBP">;
  outputType: boolean;
  dimensionRule: "multiples_of_64" | "fixed_set";
};

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  prompt: "required",
  negativePrompt: true,
  seed: true,
  seedImage: true,
  maskImage: true,
  outpainting: false,
  steps: { supported: true, min: 1, max: 50, default: 20 },
  cfgScale: { supported: true, min: 1, max: 20, default: 3.5 },
  scheduler: true,
  clipSkip: true,
  checkNSFW: true,
  numberResults: true,
  outputQuality: true,
  outputFormats: ["JPG", "PNG", "WEBP"],
  outputType: true,
  dimensionRule: "multiples_of_64",
};

export const FAMILY_CAPABILITIES: Record<string, ModelCapabilities> = {
  google: {
    prompt: "required",
    negativePrompt: true,
    seed: true,
    seedImage: false,
    maskImage: false,
    outpainting: false,
    steps: { supported: false },
    cfgScale: { supported: false },
    scheduler: false,
    clipSkip: false,
    checkNSFW: false,
    numberResults: true,
    outputQuality: false,
    outputFormats: ["JPG", "PNG", "WEBP"],
    outputType: true,
    dimensionRule: "multiples_of_64",
  },

  ideogram: {
    prompt: "required",
    negativePrompt: false,
    seed: true,
    seedImage: true,
    maskImage: true,
    outpainting: false,
    steps: { supported: false },
    cfgScale: { supported: false },
    scheduler: false,
    clipSkip: false,
    checkNSFW: false,
    numberResults: true,
    outputQuality: false,
    outputFormats: ["JPG", "PNG", "WEBP"],
    outputType: true,
    dimensionRule: "multiples_of_64",
  },

  openai: {
    prompt: "required",
    negativePrompt: false,
    seed: false,
    seedImage: true,
    maskImage: true,
    outpainting: false,
    steps: { supported: false },
    cfgScale: { supported: false },
    scheduler: false,
    clipSkip: false,
    checkNSFW: false,
    numberResults: true,
    outputQuality: false,
    outputFormats: ["JPG", "PNG", "WEBP"],
    outputType: true,
    dimensionRule: "multiples_of_64",
  },

  flux: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 3.5 },
  },

  "flux-pro": {
    prompt: "required",
    negativePrompt: true,
    seed: true,
    seedImage: false,
    maskImage: false,
    outpainting: false,
    steps: { supported: false },
    cfgScale: { supported: false },
    scheduler: false,
    clipSkip: false,
    checkNSFW: false,
    numberResults: true,
    outputQuality: false,
    outputFormats: ["PNG", "WEBP", "JPG"],
    outputType: true,
    dimensionRule: "multiples_of_64",
  },

  "qwen-image": {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 3.5 },
  },

  sdxl: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 7 },
  },

  bytedance: {
    prompt: "required",
    negativePrompt: true,
    seed: true,
    seedImage: true,
    maskImage: true,
    outpainting: false,
    steps: { supported: false },
    cfgScale: { supported: false },
    scheduler: false,
    clipSkip: false,
    checkNSFW: true,
    numberResults: true,
    outputQuality: true,
    outputFormats: ["JPG", "PNG", "WEBP"],
    outputType: true,
    dimensionRule: "multiples_of_64",
  },

  klingai: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 7 },
  },

  bria: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 7 },
  },

  sourceful: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 7 },
  },

  vidu: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 1, max: 20, default: 7 },
  },
};

export function getEndpointFamily(endpointId: string): string {
  const prefix = endpointId.split(":")[0];

  if (prefix === "runware") {
    const modelNumber = endpointId.split(":")[1]?.split("@")[0];

    if (modelNumber === "108") {
      return "qwen-image";
    }

    if (modelNumber === "107" || modelNumber === "109") {
      return "flux";
    }

    return "sdxl";
  }

  const familyMap: Record<string, string> = {
    google: "google",
    ideogram: "ideogram",
    openai: "openai",
    bfl: "flux-pro",
    bytedance: "bytedance",
    klingai: "klingai",
    bria: "bria",
    sourceful: "sourceful",
    vidu: "vidu",
    rundiffusion: "sdxl",
    civitai: "sdxl",
  };

  return familyMap[prefix] || "sdxl"; // Default to SDXL-like capabilities
}

export function getModelCapabilities(endpointId: string): ModelCapabilities {
  const family = getEndpointFamily(endpointId);
  return FAMILY_CAPABILITIES[family] || DEFAULT_CAPABILITIES;
}

export function buildRunwarePayload(
  endpointId: string,
  input: Record<string, unknown>,
  mediaType: "image" | "video",
): Record<string, unknown> {
  const capabilities = getModelCapabilities(endpointId);

  if (capabilities.prompt === "required") {
    const prompt = input.prompt as string;
    if (!prompt || prompt.trim() === "") {
      throw new Error("Prompt is required for this model");
    }
  }

  const roundToMultipleOf64 = (value: number): number => {
    return Math.round(value / 64) * 64;
  };

  let width = (input.width as number) || 1024;
  let height = (input.height as number) || 1024;

  if (capabilities.dimensionRule === "multiples_of_64") {
    width = roundToMultipleOf64(width);
    height = roundToMultipleOf64(height);
  }

  const payload: Record<string, unknown> = {
    positivePrompt: input.prompt || "",
    model: endpointId,
    height,
    width,
    numberResults: capabilities.numberResults ? input.numberResults || 1 : 1,
    outputType: "URL" as const,
    outputFormat: (input.outputFormat || "JPG") as "JPG" | "PNG" | "WEBP",
    includeCost: input.includeCost !== undefined ? input.includeCost : true,
  };

  if (capabilities.negativePrompt && input.negativePrompt) {
    payload.negativePrompt = input.negativePrompt;
  }

  if (capabilities.seed && input.seed !== undefined) {
    payload.seed = input.seed;
  }

  if (capabilities.checkNSFW) {
    payload.checkNSFW = input.checkNSFW !== undefined ? input.checkNSFW : true;
  }

  if (capabilities.cfgScale.supported) {
    payload.CFGScale = input.CFGScale || capabilities.cfgScale.default || 3.5;
  }

  if (capabilities.outputQuality) {
    payload.outputQuality =
      input.outputQuality || (mediaType === "video" ? 99 : 85);
  }

  if (capabilities.steps.supported && input.steps !== undefined) {
    payload.steps = input.steps;
  }

  if (capabilities.scheduler && input.scheduler) {
    payload.scheduler = input.scheduler;
  }

  if (capabilities.clipSkip && input.clipSkip !== undefined) {
    payload.clipSkip = input.clipSkip;
  }

  if (capabilities.seedImage && input.seedImage) {
    payload.seedImage = input.seedImage;
  }

  if (capabilities.maskImage && input.maskImage) {
    payload.maskImage = input.maskImage;
  }

  return payload;
}
