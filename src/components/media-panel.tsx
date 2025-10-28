"use client";

import { db } from "@/data/db";
import { queryKeys } from "@/data/queries";
import type { MediaItem } from "@/data/schema";
import { useProjectId, useVideoProjectStore } from "@/data/store";
import { useToast } from "@/hooks/use-toast";
import { fal } from "@/lib/fal";
import { extractVideoThumbnail, getMediaMetadata } from "@/lib/ffmpeg";
import { getRunwareClient } from "@/lib/runware";
import { cn, resolveMediaUrl, trackIcons } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  CircleXIcon,
  GripVerticalIcon,
  HourglassIcon,
  ImageIcon,
  MicIcon,
  MusicIcon,
  VideoIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type DragEventHandler,
  Fragment,
  type HTMLAttributes,
  createElement,
} from "react";
import { Badge } from "./ui/badge";
import { LoadingIcon } from "./ui/icons";

type MediaItemRowProps = {
  data: MediaItem;
  onOpen: (data: MediaItem) => void;
  draggable?: boolean;
} & HTMLAttributes<HTMLDivElement>;

type GeneratedMediaItem = Extract<MediaItem, { kind: "generated" }>;

export function MediaItemRow({
  data,
  className,
  onOpen,
  draggable = true,
  ...props
}: MediaItemRowProps) {
  const t = useTranslations("app.toast");
  const isDone = data.status === "completed";
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { toast } = useToast();
  useQuery({
    queryKey: queryKeys.projectMedia(projectId, data.id),
    queryFn: async () => {
      if (data.kind === "uploaded") return null;

      const provider = data.provider || "fal";
      console.log(
        "[DEBUG] Polling - provider:",
        provider,
        "requestId:",
        data.requestId,
        "taskUUID:",
        data.taskUUID,
      );
      console.log("[DEBUG] Polling - endpointId:", data.endpointId);

      if (provider === "fal") {
        if (!data.requestId) {
          console.error("[DEBUG] requestId is missing for FAL job!", data);
          throw new Error("requestId is required for fal provider");
        }
        const queueStatus = await fal.queue.status(data.endpointId, {
          requestId: data.requestId,
        });
        if (queueStatus.status === "IN_PROGRESS") {
          await db.media.update(data.id, {
            ...data,
            status: "running",
          });
          await queryClient.invalidateQueries({
            queryKey: queryKeys.projectMediaItems(data.projectId),
          });
        }
        let media: Partial<MediaItem> = {};

        if (queueStatus.status === "COMPLETED") {
          try {
            if (!data.requestId) {
              throw new Error("Request ID is missing");
            }
            const result = await fal.queue.result(data.endpointId, {
              requestId: data.requestId,
            });
            media = {
              ...data,
              output: result.data,
              status: "completed",
            };

            await db.media.update(data.id, media);

            toast({
              title: t("generationCompleted"),
              description: t("generationCompletedDesc", {
                mediaType: data.mediaType,
              }),
            });
          } catch {
            await db.media.update(data.id, {
              ...data,
              status: "failed",
            });
            toast({
              title: t("generationFailed"),
              description: t("generationFailedDesc", {
                mediaType: data.mediaType,
              }),
            });
          } finally {
            await queryClient.invalidateQueries({
              queryKey: queryKeys.projectMediaItems(data.projectId),
            });
          }

          if (media.mediaType !== "image") {
            const mediaMetadata = await getMediaMetadata(media as MediaItem);

            let thumbnailUrl = null;
            if (media.mediaType === "video") {
              const videoUrl = resolveMediaUrl(media as MediaItem);
              if (videoUrl) {
                thumbnailUrl = await extractVideoThumbnail(videoUrl);
              }
            }

            await db.media.update(data.id, {
              ...media,
              metadata: {
                ...(mediaMetadata?.media || {}),
                start_frame_url: media.output?.start_frame_url,
                end_frame_url: media.output?.end_frame_url,
                thumbnail_url: thumbnailUrl,
              },
            });

            await queryClient.invalidateQueries({
              queryKey: queryKeys.projectMediaItems(data.projectId),
            });
          }
        }
      } else {
        console.log("[DEBUG] Runware item - checking for thumbnail generation");

        if (data.kind !== "generated") {
          return null;
        }

        let currentData: GeneratedMediaItem = data;

        if (data.status !== "completed") {
          if (!data.taskUUID) {
            console.error("[DEBUG] taskUUID is missing for Runware job!", data);
            throw new Error("taskUUID is required for runware provider");
          }

          const runware = await getRunwareClient();

          if (!runware) {
            console.error("[DEBUG] Runware client is not initialized");
            return null;
          }

          const response = await runware.getResponse({
            taskUUID: data.taskUUID,
          });

          const result = Array.isArray((response as any)?.data)
            ? (response as any).data[0]
            : (response as any)?.data || response;

          console.log("[DEBUG] Runware getResponse result:", result);

          if (!result) {
            return null;
          }

          if (result.error || result.status === "failed") {
            await db.media.update(data.id, {
              ...data,
              status: "failed",
            });

            toast({
              title: t("generationFailed"),
              description: t("generationFailedDesc", {
                mediaType: data.mediaType,
              }),
            });

            await queryClient.invalidateQueries({
              queryKey: queryKeys.projectMediaItems(data.projectId),
            });

            return null;
          }

          const hasOutput = Boolean(
            result.imageURL ||
              result.videoURL ||
              result.audioURL ||
              result.audioDataURI ||
              result.audioBase64Data,
          );

          if (!hasOutput && result.status !== "completed") {
            if (data.status !== "running") {
              await db.media.update(data.id, {
                ...data,
                status: "running",
              });

              await queryClient.invalidateQueries({
                queryKey: queryKeys.projectMediaItems(data.projectId),
              });
            }

            return null;
          }

          currentData = {
            ...data,
            output: result,
            status: "completed",
          } as GeneratedMediaItem;

          await db.media.update(data.id, currentData);

          toast({
            title: t("generationCompleted"),
            description: t("generationCompletedDesc", {
              mediaType: data.mediaType,
            }),
          });

          await queryClient.invalidateQueries({
            queryKey: queryKeys.projectMediaItems(data.projectId),
          });
        }

        if (currentData.status === "completed") {
          if (
            currentData.mediaType === "video" &&
            !currentData.metadata?.thumbnail_url
          ) {
            console.log("[DEBUG] Generating thumbnail for Runware video");
            const videoUrl = resolveMediaUrl(currentData);
            if (videoUrl) {
              const thumbnailUrl = await extractVideoThumbnail(videoUrl);
              await db.media.update(data.id, {
                ...currentData,
                metadata: {
                  ...currentData.metadata,
                  thumbnail_url: thumbnailUrl,
                },
              });
              await queryClient.invalidateQueries({
                queryKey: queryKeys.projectMediaItems(data.projectId),
              });
              console.log("[DEBUG] Thumbnail generated:", thumbnailUrl);

              currentData = {
                ...currentData,
                metadata: {
                  ...currentData.metadata,
                  thumbnail_url: thumbnailUrl,
                },
              } as GeneratedMediaItem;
            }
          }

          if (
            currentData.mediaType !== "image" &&
            !currentData.metadata?.duration
          ) {
            console.log(
              "[DEBUG] Extracting metadata for Runware",
              currentData.mediaType,
            );
            const mediaMetadata = await getMediaMetadata(currentData);
            await db.media.update(data.id, {
              ...currentData,
              metadata: {
                ...(currentData.metadata || {}),
                ...(mediaMetadata?.media || {}),
              },
            });
            await queryClient.invalidateQueries({
              queryKey: queryKeys.projectMediaItems(data.projectId),
            });
            console.log("[DEBUG] Metadata extracted:", mediaMetadata?.media);

            currentData = {
              ...currentData,
              metadata: {
                ...(currentData.metadata || {}),
                ...(mediaMetadata?.media || {}),
              },
            } as GeneratedMediaItem;
          }

          if (
            !currentData.metadata?.thumbnail_url &&
            !currentData.metadata?.duration
          ) {
            console.log(
              "[DEBUG] Runware item should already be completed, skipping polling",
            );
            await db.media.update(data.id, {
              ...currentData,
              status: "completed",
            });
            await queryClient.invalidateQueries({
              queryKey: queryKeys.projectMediaItems(data.projectId),
            });
          }
        }
        return null;
      }

      return null;
    },
    enabled:
      (!isDone && data.kind === "generated") ||
      (data.provider === "runware" &&
        data.status === "completed" &&
        data.mediaType === "video" &&
        !data.metadata?.thumbnail_url),
    refetchInterval: () => {
      if (data.kind === "uploaded") return false;
      const provider = data.provider || "fal";

      if (provider === "fal") {
        return data.mediaType === "video" ? 20000 : 1000;
      }
      return 5000;
    },
  });
  const mediaUrl = resolveMediaUrl(data) ?? "";
  const mediaId = data.id.split("-")[0];
  const handleOnDragStart: DragEventHandler<HTMLDivElement> = (event) => {
    const jobData = JSON.stringify(data);
    event.dataTransfer.setData("job", jobData);
    event.dataTransfer.setData("application/json", jobData);
    event.dataTransfer.setData("text/plain", jobData);
    event.dataTransfer.effectAllowed = "copyMove";
    return true;
  };

  const coverImage =
    data.mediaType === "video"
      ? data.metadata?.thumbnail_url ||
        data.metadata?.start_frame_url ||
        data?.metadata?.end_frame_url
      : resolveMediaUrl(data);

  return (
    <div
      className={cn(
        "flex items-start space-x-2 py-2 w-full px-4 hover:bg-accent transition-all",
        className,
      )}
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(data);
      }}
      draggable={draggable && data.status === "completed"}
      onDragStart={handleOnDragStart}
    >
      {!!draggable && (
        <div
          className={cn(
            "flex items-center h-full cursor-grab text-muted-foreground",
            {
              "text-muted": data.status !== "completed",
            },
          )}
        >
          <GripVerticalIcon className="w-4 h-4" />
        </div>
      )}
      <div className="w-16 h-16 aspect-square relative rounded overflow-hidden border border-transparent hover:border-accent bg-accent transition-all">
        {data.status === "completed" ? (
          <>
            {(data.mediaType === "image" || data.mediaType === "video") &&
              (coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverImage}
                  alt="Generated media"
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center top-0 left-0 absolute p-2 z-50">
                  {data.mediaType === "image" ? (
                    <ImageIcon className="w-7 h-7 text-muted-foreground" />
                  ) : (
                    <VideoIcon className="w-7 h-7 text-muted-foreground" />
                  )}
                </div>
              ))}
            {data.mediaType === "music" && (
              <div className="w-full h-full flex items-center justify-center top-0 left-0 absolute p-2 z-50">
                <MusicIcon className="w-7 h-7 text-muted-foreground" />
              </div>
            )}
            {data.mediaType === "voiceover" && (
              <div className="w-full h-full flex items-center justify-center top-0 left-0 absolute p-2 z-50">
                <MicIcon className="w-7 h-7 text-muted-foreground" />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full bg-white/5 flex items-center justify-center text-muted-foreground">
            {data.status === "running" && <LoadingIcon className="w-8 h-8" />}
            {data.status === "pending" && (
              <HourglassIcon className="w-8 h-8 animate-spin ease-in-out delay-700 duration-1000" />
            )}
            {data.status === "failed" && (
              <CircleXIcon className="w-8 h-8 text-rose-700" />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col h-full gap-1 flex-1">
        <div className="flex flex-col items-start justify-center">
          <div className="flex w-full justify-between">
            <h3 className="text-sm font-medium flex flex-row gap-1 items-center">
              {createElement(trackIcons[data.mediaType], {
                className: "w-4 h-4 stroke-1",
              } as React.ComponentProps<
                (typeof trackIcons)[keyof typeof trackIcons]
              >)}
              <span>{data.kind === "generated" ? "Job" : "File"}</span>
              <code className="text-muted-foreground">#{mediaId}</code>
              {data.kind === "uploaded" ? (
                <Badge variant="outline" className="text-xs ml-1">
                  Uploaded
                </Badge>
              ) : data.endpointId?.startsWith("fal-ai/") ? (
                <Badge variant="outline" className="text-xs ml-1">
                  FAL
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs ml-1">
                  Runware
                </Badge>
              )}
            </h3>
            {data.status !== "completed" && (
              <Badge
                variant="outline"
                className={cn({
                  "text-rose-700": data.status === "failed",
                  "text-sky-500": data.status === "running",
                  "text-muted-foreground": data.status === "pending",
                })}
              >
                {data.status}
              </Badge>
            )}
          </div>
          <p className="opacity-40 text-sm line-clamp-1 ">
            {data.input?.prompt}
          </p>
        </div>
        <div className="flex flex-row gap-2 justify-between">
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(data.createdAt, { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

type MediaItemsPanelProps = {
  data: MediaItem[];
  mediaType: string;
} & HTMLAttributes<HTMLDivElement>;

export function MediaItemPanel({
  className,
  data,
  mediaType,
}: MediaItemsPanelProps) {
  const setSelectedMediaId = useVideoProjectStore((s) => s.setSelectedMediaId);
  const handleOnOpen = (item: MediaItem) => {
    setSelectedMediaId(item.id);
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden divide-y divide-border",
        className,
      )}
    >
      {data
        .filter((media) => {
          if (mediaType === "all") return true;
          return media.mediaType === mediaType;
        })
        .map((media) => (
          <Fragment key={media.id}>
            <MediaItemRow data={media} onOpen={handleOnOpen} />
          </Fragment>
        ))}
    </div>
  );
}
