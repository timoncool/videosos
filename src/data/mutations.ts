import { AVAILABLE_ENDPOINTS, fal } from "@/lib/fal";
import { getRunwareClient, prepareRunwareImageAsset } from "@/lib/runware";
import { RUNWARE_ENDPOINTS } from "@/lib/runware-models";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { db } from "./db";
import { queryKeys } from "./queries";
import type { VideoProject } from "./schema";

export const useProjectDeleter = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => db.projects.delete(projectId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
};

export const useProjectUpdater = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (project: Partial<VideoProject>) =>
      db.projects.update(projectId, project),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
};

export const useProjectCreator = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (project: Omit<VideoProject, "id">) =>
      db.projects.create(project),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
};

type JobCreatorParams = {
  projectId: string;
  endpointId: string;
  mediaType: "video" | "image" | "voiceover" | "music";
  input: Record<string, any>;
};

export const useJobCreator = ({
  projectId,
  endpointId,
  mediaType,
  input,
}: JobCreatorParams) => {
  const queryClient = useQueryClient();
  const lastSubmittedFalInputRef = useRef<Record<string, unknown>>(input);

  const serializeForLog = (value: unknown) => {
    const replacer = (_: string, data: unknown) => {
      if (typeof File !== "undefined" && data instanceof File) {
        return {
          name: data.name,
          size: data.size,
          type: data.type,
        };
      }

      if (
        typeof Blob !== "undefined" &&
        data instanceof Blob &&
        !(typeof File !== "undefined" && data instanceof File)
      ) {
        return {
          size: data.size,
          type: data.type,
        };
      }

      return data;
    };

    try {
      return JSON.stringify(value, replacer, 2);
    } catch (error) {
      console.error("[DEBUG] Failed to serialize value for logging:", error);
      return String(value);
    }
  };

  const uploadValueIfNeeded = async (
    key: string,
    value: unknown,
  ): Promise<unknown> => {
    if (value === undefined || value === null) {
      return value;
    }

    if (Array.isArray(value)) {
      return Promise.all(
        value.map((item, index) =>
          uploadValueIfNeeded(`${key}[${index}]`, item),
        ),
      );
    }

    if (typeof value === "string" && value.startsWith("blob:")) {
      console.log(
        `[DEBUG] Uploading blob URL for key ${key} to fal.ai storage`,
      );
      try {
        const response = await fetch(value);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch blob URL (${response.status} ${response.statusText})`,
          );
        }

        const blob = await response.blob();
        const uploadedUrl = await fal.storage.upload(blob);
        console.log(
          `[DEBUG] Uploaded blob URL for key ${key} to fal.ai storage:`,
          uploadedUrl,
        );
        return uploadedUrl;
      } catch (error) {
        console.error(
          `[DEBUG] Failed to upload blob URL for key ${key} to fal.ai storage:`,
          error,
        );
        throw error;
      }
    }

    const isFile = typeof File !== "undefined" && value instanceof File;
    const isBlob =
      !isFile && typeof Blob !== "undefined" && value instanceof Blob;

    if (isFile || isBlob) {
      console.log(
        `[DEBUG] Uploading ${isFile ? "file" : "blob"} for key ${key} to fal.ai storage`,
      );
      try {
        const uploadedUrl = await fal.storage.upload(value as Blob);
        console.log(
          `[DEBUG] Uploaded ${isFile ? "file" : "blob"} for key ${key}:`,
          uploadedUrl,
        );
        return uploadedUrl;
      } catch (error) {
        console.error(
          `[DEBUG] Failed to upload ${isFile ? "file" : "blob"} for key ${key} to fal.ai storage:`,
          error,
        );
        throw error;
      }
    }

    return value;
  };

  const prepareFalInput = async (
    rawInput: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const entries = await Promise.all(
      Object.entries(rawInput).map(async ([key, value]) => {
        const resolvedValue = await uploadValueIfNeeded(key, value);
        return [key, resolvedValue] as const;
      }),
    );

    return entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});
  };

  const allEndpoints = [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS];
  const endpoint = allEndpoints.find((e) => e.endpointId === endpointId);
  const provider = endpoint?.provider || "fal";

  return useMutation({
    mutationFn: async () => {
      console.log("[DEBUG] useJobCreator called with endpointId:", endpointId);
      console.log("[DEBUG] provider determined as:", provider);

      if (provider === "fal") {
        console.log("[DEBUG] FAL - submitting with endpointId:", endpointId);
        console.log("[DEBUG] FAL - input payload:", serializeForLog(input));
        const preparedInput = await prepareFalInput(input);
        lastSubmittedFalInputRef.current = preparedInput;
        console.log(
          "[DEBUG] FAL - prepared input payload:",
          serializeForLog(preparedInput),
        );
        try {
          const result = await fal.queue.submit(endpointId, {
            input: preparedInput,
          });
          console.log("[DEBUG] FAL submit result:", result);
          return { ...result, __input: preparedInput };
        } catch (error: any) {
          console.error("[DEBUG] FAL submit ERROR:", error);
          console.error("[DEBUG] FAL submit ERROR message:", error?.message);
          console.error("[DEBUG] FAL submit ERROR status:", error?.status);
          console.error("[DEBUG] FAL submit ERROR body:", error?.body);
          console.error("[DEBUG] FAL submit ERROR response:", error?.response);
          throw error;
        }
      }
      const runware = await getRunwareClient();
      if (!runware) {
        throw new Error("Runware API key not configured");
      }

      const taskUUID = crypto.randomUUID();

      if (mediaType === "image") {
        const isIdeogram = endpointId.startsWith("ideogram:");

        const imageParams: any = {
          positivePrompt: input.prompt || "",
          model: endpointId,
          height: input.height || 1024,
          width: input.width || 1024,
          numberResults: input.numberResults || 1,
          outputType: "URL" as const,
          outputFormat: (input.outputFormat || "JPG") as "JPG" | "PNG" | "WEBP",
          includeCost:
            input.includeCost !== undefined ? input.includeCost : true,
        };

        if (!isIdeogram) {
          imageParams.checkNSFW =
            input.checkNSFW !== undefined ? input.checkNSFW : true;
          imageParams.CFGScale = input.CFGScale || 3.5;
          imageParams.outputQuality = input.outputQuality || 85;

          if (input.steps !== undefined) {
            imageParams.steps = input.steps;
          }
        }

        const runwareSeedImageKeys = [
          "seedImage",
          "inputImage",
          "image",
          "image_url",
        ];

        for (const key of runwareSeedImageKeys) {
          const candidate = input[key];
          if (!candidate) {
            continue;
          }

          if (typeof candidate === "string") {
            imageParams.seedImage = candidate;
            break;
          }

          if (typeof File !== "undefined" && candidate instanceof File) {
            imageParams.seedImage = candidate;
            break;
          }

          if (typeof Blob !== "undefined" && candidate instanceof Blob) {
            imageParams.seedImage = await prepareRunwareImageAsset({
              value: candidate,
              runware,
              cacheKey: key,
            });
            break;
          }
        }

        console.log("[DEBUG] Runware requestImages - endpointId:", endpointId);
        console.log(
          "[DEBUG] Runware requestImages - params:",
          JSON.stringify(imageParams, null, 2),
        );

        try {
          const response = await runware.requestImages(imageParams);
          console.log(
            "[DEBUG] Runware requestImages - SUCCESS:",
            JSON.stringify(response, null, 2),
          );

          return {
            taskUUID,
            data: response,
          };
        } catch (error) {
          console.error("[DEBUG] Runware requestImages - ERROR:", error);
          console.error(
            "[DEBUG] Runware requestImages - ERROR message:",
            (error as any)?.message,
          );
          console.error(
            "[DEBUG] Runware requestImages - ERROR response:",
            (error as any)?.response,
          );
          console.error(
            "[DEBUG] Runware requestImages - ERROR response data:",
            (error as any)?.response?.data,
          );
          console.error(
            "[DEBUG] Runware requestImages - ERROR response status:",
            (error as any)?.response?.status,
          );
          console.error(
            "[DEBUG] Runware requestImages - ERROR stringified:",
            JSON.stringify(error, null, 2),
          );
          throw error;
        }
      }
      if (mediaType === "video") {
        const runware = await getRunwareClient();
        if (!runware) {
          throw new Error("Runware API key not configured");
        }

        const defaultDuration = endpointId.startsWith("minimax:") ? 6 : 5;
        const videoParams: any = {
          positivePrompt: input.positivePrompt || input.prompt || "",
          model: endpointId,
          duration: input.duration || defaultDuration,
          fps: input.fps || 24,
          height: input.height || 1080,
          width: input.width || 1920,
        };

        if (input.inputImage) {
          videoParams.inputImage = input.inputImage;
        }

        console.log(
          "[DEBUG] Calling runware.videoInference with:",
          videoParams,
        );

        try {
          const response = await runware.videoInference(videoParams);
          console.log("[DEBUG] videoInference response:", response);

          return {
            taskUUID,
            data: response,
          };
        } catch (error) {
          console.error("[DEBUG] videoInference ERROR:", error);
          throw error;
        }
      } else if (mediaType === "music" || mediaType === "voiceover") {
        const runware = await getRunwareClient();
        if (!runware) {
          throw new Error("Runware API key not configured");
        }

        const audioParams = {
          positivePrompt: input.prompt || "",
          model: endpointId,
          duration: input.duration || 30,
          outputFormat: "MP3" as const,
          outputType: "URL" as const,
          audioSettings: {
            bitrate: 128,
            sampleRate: 44100,
          },
        };

        console.log(
          "[DEBUG] Calling runware.audioInference with:",
          audioParams,
        );

        try {
          const response = await runware.audioInference(audioParams);
          console.log("[DEBUG] audioInference response:", response);
          console.log(
            "[DEBUG] audioInference response stringified:",
            JSON.stringify(response, null, 2),
          );

          return {
            taskUUID,
            data: response,
          };
        } catch (error) {
          console.error("[DEBUG] audioInference ERROR:", error);
          console.error(
            "[DEBUG] audioInference ERROR message:",
            (error as any)?.message,
          );
          console.error(
            "[DEBUG] audioInference ERROR stack:",
            (error as any)?.stack,
          );
          console.error(
            "[DEBUG] audioInference ERROR stringified:",
            JSON.stringify(error, null, 2),
          );
          throw error;
        }
      }

      throw new Error(`Unsupported media type: ${mediaType}`);
    },
    onSuccess: async (data: {
      taskUUID?: string;
      data?: unknown;
      request_id?: string;
      __input?: Record<string, unknown>;
    }) => {
      if (provider === "fal") {
        console.log("[DEBUG] FAL onSuccess data:", data);
        console.log("[DEBUG] FAL request_id:", data.request_id);
        const storedInput =
          data.__input ?? lastSubmittedFalInputRef.current ?? input;
        await db.media.create({
          projectId,
          createdAt: Date.now(),
          mediaType,
          kind: "generated",
          provider: "fal",
          endpointId,
          requestId: data.request_id,
          status: "pending",
          input: storedInput,
        });
      } else if (provider === "runware") {
        console.log(
          "[DEBUG] Runware onSuccess - full data:",
          JSON.stringify(data, null, 2),
        );
        const result = (data as any).data?.[0];
        const isCompleted =
          result &&
          (result.imageURL ||
            result.videoURL ||
            result.audioURL ||
            result.audioDataURI ||
            result.audioBase64Data);

        if (isCompleted) {
          console.log("[DEBUG] Runware task completed immediately:", result);
          await db.media.create({
            projectId,
            createdAt: Date.now(),
            mediaType,
            kind: "generated",
            provider: "runware",
            endpointId,
            taskUUID: result.taskUUID || data.taskUUID,
            status: "completed",
            output: result,
            input,
          });
        } else {
          console.log("[DEBUG] Runware task pending, taskUUID:", data.taskUUID);
          await db.media.create({
            projectId,
            createdAt: Date.now(),
            mediaType,
            kind: "generated",
            provider: "runware",
            endpointId,
            taskUUID: data.taskUUID,
            status: "pending",
            input,
          });
        }
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectMediaItems(projectId),
      });
    },
  });
};
