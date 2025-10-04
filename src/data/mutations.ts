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
  const endpoint = allEndpoints.find(e => e.endpointId === endpointId);
  const provider = endpoint?.provider || 'fal';
  
  return useMutation({
    mutationFn: async () => {
      console.log('[DEBUG] useJobCreator called with endpointId:', endpointId);
      console.log('[DEBUG] provider determined as:', provider);
      
      if (provider === 'fal') {
        console.log('[DEBUG] FAL - submitting with endpointId:', endpointId);
        const result = await fal.queue.submit(endpointId, { input });
        console.log('[DEBUG] FAL submit result:', result);
        return result;
      } else {
        const runware = getRunwareClient();
        if (!runware) {
          throw new Error("Runware API key not configured");
        }
        
        const taskUUID = crypto.randomUUID();
        
        if (mediaType === 'image') {
          const response = await runware.requestImages({
            positivePrompt: input.prompt || '',
            model: endpointId,
            numberResults: 1,
            customTaskUUID: taskUUID,
            ...input,
          });
          
          return {
            taskUUID,
            data: response,
          };
        } else if (mediaType === 'video') {
          const response = await runware.videoInference({
            positivePrompt: input.prompt || '',
            model: endpointId,
            customTaskUUID: taskUUID,
            ...input,
          });
          
          return {
            taskUUID,
            data: response,
          };
        } else if (mediaType === 'music' || mediaType === 'voiceover') {
          const response = await runware.audioInference({
            positivePrompt: input.prompt || '',
            model: endpointId,
            duration: input.duration || 30,
            customTaskUUID: taskUUID,
            deliveryMethod: 'async',
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
      if (provider === 'fal') {
        console.log('[DEBUG] FAL onSuccess data:', data);
        console.log('[DEBUG] FAL request_id:', data.request_id);
        await db.media.create({
          projectId,
          createdAt: Date.now(),
          mediaType,
          kind: "generated",
          provider: 'fal',
          endpointId,
          requestId: data.request_id,
          status: "pending",
          input,
        });
      } else {
        await db.media.create({
          projectId,
          createdAt: Date.now(),
          mediaType,
          kind: "generated",
          provider: 'runware',
          endpointId,
          taskUUID: data.taskUUID,
          status: "pending",
          input,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectMediaItems(projectId),
      });
    },
  });
};
