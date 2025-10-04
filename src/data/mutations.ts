import { fal, AVAILABLE_ENDPOINTS } from "@/lib/fal";
import { RUNWARE_ENDPOINTS } from "@/lib/runware-models";
import { getRunwareClient } from "@/lib/runware";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "./db";
import { queryKeys } from "./queries";
import type { VideoProject } from "./schema";

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

  const allEndpoints = [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS];
  const endpoint = allEndpoints.find((e) => e.endpointId === endpointId);
  const provider = endpoint?.provider || "fal";

  return useMutation({
    mutationFn: async () => {
      console.log("[DEBUG] useJobCreator called with endpointId:", endpointId);
      console.log("[DEBUG] provider determined as:", provider);

      if (provider === "fal") {
        console.log("[DEBUG] FAL - submitting with endpointId:", endpointId);
        const result = await fal.queue.submit(endpointId, { input });
        console.log("[DEBUG] FAL submit result:", result);
        return result;
      } else {
        const runware = getRunwareClient();
        if (!runware) {
          throw new Error("Runware API key not configured");
        }

        const taskUUID = crypto.randomUUID();

        if (mediaType === "image") {
          const response = await runware.requestImages({
            positivePrompt: input.prompt || "",
            model: endpointId,
            height: input.height || 1024,
            width: input.width || 1024,
            numberResults: input.numberResults || 1,
            outputType: input.outputType || ["URL", "dataURI"],
            outputFormat: input.outputFormat || "JPEG",
            checkNSFW: input.checkNSFW !== undefined ? input.checkNSFW : true,
            CFGScale: input.CFGScale || 3.5,
            steps: input.steps || 28,
            scheduler: input.scheduler || "Default",
            includeCost:
              input.includeCost !== undefined ? input.includeCost : true,
            outputQuality: input.outputQuality || 85,
            ...input,
          });

          return {
            taskUUID,
            data: response,
          };
        } else if (mediaType === "video") {
          const response = await runware.videoInference({
            positivePrompt: input.prompt || "",
            model: endpointId,
            customTaskUUID: taskUUID,
            ...input,
          });

          return {
            taskUUID,
            data: response,
          };
        } else if (mediaType === "music" || mediaType === "voiceover") {
          const response = await runware.audioInference({
            positivePrompt: input.prompt || "",
            model: endpointId,
            duration: input.duration || 30,
            customTaskUUID: taskUUID,
            deliveryMethod: "async",
            ...input,
          });

          return {
            taskUUID,
            data: response,
          };
        }

        throw new Error(`Unsupported media type: ${mediaType}`);
      }
    },
    onSuccess: async (data: any) => {
      if (provider === "fal") {
        console.log("[DEBUG] FAL onSuccess data:", data);
        console.log("[DEBUG] FAL request_id:", data.request_id);
        await db.media.create({
          projectId,
          createdAt: Date.now(),
          mediaType,
          kind: "generated",
          provider: "fal",
          endpointId,
          requestId: data.request_id,
          status: "pending",
          input,
        });
      } else if (provider === "runware") {
        if (
          data.data &&
          Array.isArray(data.data) &&
          data.data[0] &&
          data.data[0].imageURL
        ) {
          console.log(
            "[DEBUG] Runware image completed immediately:",
            data.data[0],
          );
          await db.media.create({
            projectId,
            createdAt: Date.now(),
            mediaType,
            kind: "generated",
            provider: "runware",
            endpointId,
            taskUUID: data.data[0].taskUUID,
            status: "completed",
            output: data.data[0],
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
