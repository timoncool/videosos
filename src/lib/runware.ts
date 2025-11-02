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

  // File/Blob need to be uploaded to Runware to get UUID
  if (isFile(value) || isBlob(value)) {
    if (!runware || typeof runware.imageUpload !== "function") {
      console.warn(
        "Runware client not available or imageUpload not supported, returning File/Blob as-is",
      );
      return value;
    }

    const cacheKeyForBlob = isBlob(value)
      ? `blob-${value.size}-${value.type}`
      : `file-${(value as File).name}`;

    if (runwareUploadCache.has(cacheKeyForBlob)) {
      console.log("[DEBUG] Using cached Runware upload UUID:", cacheKeyForBlob);
      return runwareUploadCache.get(cacheKeyForBlob) as string;
    }

    try {
      console.log(
        "[DEBUG] Uploading File/Blob to Runware:",
        isFile(value) ? (value as File).name : "blob",
      );

      // SDK might accept File/Blob directly, or we might need to convert to base64
      // Try passing directly first
      const uploaded = await runware.imageUpload({ image: value as any });
      const uploadedUuid =
        uploaded?.imageUUID || uploaded?.imageURL || (value as any);

      console.log("[DEBUG] Runware upload result:", uploadedUuid);
      runwareUploadCache.set(cacheKeyForBlob, uploadedUuid);
      return uploadedUuid;
    } catch (error) {
      console.error("Failed to upload File/Blob to Runware:", error);
      // Fallback: return as-is and let Runware SDK handle it
      return value;
    }
  }

  return value;
};
