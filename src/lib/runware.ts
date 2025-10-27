"use client";

import { Runware } from "@runware/sdk-js";

type RunwareClient = InstanceType<typeof Runware>;

let runwareClient: RunwareClient | null = null;
let initializationPromise: Promise<RunwareClient> | null = null;
const runwareUploadCache = new Map<string, string>();

const guessExtensionFromMime = (mime: string) => {
  if (!mime) return undefined;
  const [, subtype] = mime.split("/");
  if (!subtype) return undefined;
  return subtype.split(";")[0] || undefined;
};

export const getRunwareClient = async (): Promise<RunwareClient | null> => {
  const apiKey =
    typeof window !== "undefined" ? localStorage.getItem("runwareKey") : null;

  if (!apiKey) {
    return null;
  }

  if (runwareClient) {
    return runwareClient;
  }

  if (!initializationPromise) {
    initializationPromise = Runware.initialize({
      apiKey,
      timeoutDuration: 180000, // 3 minutes to handle video generation
    });
  }

  runwareClient = await initializationPromise;
  return runwareClient;
};

export const resetRunwareClient = () => {
  runwareClient = null;
  initializationPromise = null;
};

export type RunwareAssetValue = string | Blob | File;

const isFile = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

const isBlob = (value: unknown): value is Blob =>
  typeof Blob !== "undefined" && value instanceof Blob;

const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//.test(value);

type PrepareRunwareAssetParams = {
  value: RunwareAssetValue;
  runware?: RunwareClient | null;
  cacheKey?: string;
  uploadHttpAssets?: boolean;
};

export const prepareRunwareImageAsset = async ({
  value,
  runware,
  cacheKey,
  uploadHttpAssets = false,
}: PrepareRunwareAssetParams): Promise<RunwareAssetValue> => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "string") {
    if (!uploadHttpAssets || !isHttpUrl(value) || !runware) {
      return value;
    }

    if (runwareUploadCache.has(value)) {
      return runwareUploadCache.get(value) as string;
    }

    if (typeof runware.imageUpload !== "function") {
      runwareUploadCache.set(value, value);
      return value;
    }

    try {
      const uploaded = await runware.imageUpload({ image: value });
      const uploadedUrl = uploaded?.imageURL || value;
      runwareUploadCache.set(value, uploadedUrl);
      return uploadedUrl;
    } catch (error) {
      console.warn("Failed to upload HTTP asset to Runware", error);
      runwareUploadCache.set(value, value);
      return value;
    }
  }

  if (isFile(value)) {
    return value;
  }

  if (isBlob(value)) {
    const type = value.type || "application/octet-stream";
    const extension = guessExtensionFromMime(type);
    const nameBase = cacheKey ? `runware-${cacheKey}` : "runware-asset";
    const fileName = extension ? `${nameBase}.${extension}` : nameBase;

    try {
      return new File([value], fileName, { type });
    } catch (error) {
      console.warn("Failed to convert blob to File for Runware", error);
      return value;
    }
  }

  return value;
};
