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
  outputFormats: Array<"JPG" | "JPEG" | "PNG" | "WEBP">;
  outputType: boolean;
  dimensionRule: "multiples_of_64" | "fixed_set";
  availableDimensions?: Array<{ width: number; height: number; label: string }>;
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
    negativePrompt: false,
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
    outputFormats: ["PNG", "JPEG", "WEBP"],
    outputType: true,
    dimensionRule: "fixed_set",
    availableDimensions: [
      { width: 1024, height: 1024, label: "1:1 (Square)" },
      { width: 1408, height: 768, label: "16:9 (Landscape)" },
      { width: 768, height: 1408, label: "9:16 (Portrait)" },
      { width: 1280, height: 896, label: "4:3 (Landscape)" },
      { width: 896, height: 1280, label: "3:4 (Portrait)" },
    ],
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
    outputFormats: ["PNG", "JPEG", "WEBP"],
    outputType: true,
    dimensionRule: "fixed_set",
    availableDimensions: [
      { width: 1024, height: 1024, label: "1:1 (Square)" },
      { width: 1248, height: 832, label: "3:2 (Classic Landscape)" },
      { width: 832, height: 1248, label: "2:3 (Classic Portrait)" },
    ],
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
    outputFormats: ["PNG", "JPEG", "WEBP"],
    outputType: true,
    dimensionRule: "fixed_set",
    availableDimensions: [
      { width: 1024, height: 1024, label: "1:1 (Square)" },
      { width: 1536, height: 1024, label: "3:2 (Landscape)" },
      { width: 1024, height: 1536, label: "2:3 (Portrait)" },
    ],
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
    steps: { supported: true, min: 1, max: 100, default: 20 },
    cfgScale: { supported: true, min: 0, max: 50, default: 2.5 },
    dimensionRule: "multiples_of_64",
  },

  sdxl: {
    ...DEFAULT_CAPABILITIES,
    steps: { supported: true, min: 1, max: 50, default: 20 },
    cfgScale: { supported: true, min: 0, max: 50, default: 7.5 },
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
    outputFormats: ["PNG", "JPEG", "WEBP"],
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

    if (modelNumber === "107" || modelNumber === "111") {
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
  } else if (
    capabilities.dimensionRule === "fixed_set" &&
    capabilities.availableDimensions
  ) {
    const requestedRatio = width / height;
    let closestMatch = capabilities.availableDimensions[0];
    let smallestDiff = Math.abs(
      closestMatch.width / closestMatch.height - requestedRatio,
    );

    for (const dim of capabilities.availableDimensions) {
      const diff = Math.abs(dim.width / dim.height - requestedRatio);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestMatch = dim;
      }
    }

    width = closestMatch.width;
    height = closestMatch.height;
  }

  let outputFormat = (input.outputFormat || "PNG") as string;
  if (outputFormat === "JPG") {
    outputFormat = "JPEG";
  }
  if (
    capabilities.outputFormats &&
    !capabilities.outputFormats.includes(
      outputFormat as "JPG" | "JPEG" | "PNG" | "WEBP",
    )
  ) {
    outputFormat = "PNG"; // Safe default
  }

  const outputType = input.outputType ?? ["URL"];
  const payload: Record<string, unknown> = {
    positivePrompt: input.prompt || "",
    model: endpointId,
    height,
    width,
    numberResults: capabilities.numberResults ? input.numberResults || 1 : 1,
    outputType: Array.isArray(outputType) ? outputType : [outputType],
    outputFormat: outputFormat as "PNG" | "JPEG" | "WEBP",
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

  if (capabilities.outputQuality && input.outputQuality !== undefined) {
    payload.outputQuality = input.outputQuality;
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
