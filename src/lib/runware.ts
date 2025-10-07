"use client";

import { Runware } from "@runware/sdk-js";

let runwareClient: InstanceType<typeof Runware> | null = null;
let initializationPromise: Promise<InstanceType<typeof Runware>> | null = null;

export const getRunwareClient = async (): Promise<InstanceType<
  typeof Runware
> | null> => {
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
