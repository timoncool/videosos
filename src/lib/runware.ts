"use client";

import { Runware } from "@runware/sdk-js";

let runwareClient: InstanceType<typeof Runware> | null = null;

export const getRunwareClient = (): InstanceType<typeof Runware> | null => {
  const apiKey =
    typeof window !== "undefined" ? localStorage.getItem("runwareKey") : null;

  if (!apiKey) {
    return null;
  }

  if (runwareClient) {
    return runwareClient;
  }

  runwareClient = new Runware({ apiKey });
  return runwareClient;
};

export const resetRunwareClient = () => {
  runwareClient = null;
};
