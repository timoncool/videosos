"use client";

import {
  EMPTY_VIDEO_COMPOSITION,
  useProject,
  useVideoComposition,
} from "@/data/queries";
import { DEFAULT_TIMELINE_SETTINGS, PROJECT_PLACEHOLDER } from "@/data/schema";
import { useProjectId, useVideoProjectStore } from "@/data/store";
import { exportVideoClientSide } from "@/lib/ffmpeg";
import { cn, resolveDuration, resolveMediaUrl } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, FilmIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { LoadingIcon } from "./ui/icons";

type ExportDialogProps = {} & Parameters<typeof Dialog>[0];

export function ExportDialog({ onOpenChange, ...props }: ExportDialogProps) {
  const t = useTranslations("app.exportDialog");
  const projectId = useProjectId();
  const { data: composition = EMPTY_VIDEO_COMPOSITION } =
    useVideoComposition(projectId);
  const [exportProgress, setExportProgress] = useState(0);
  const exportVideo = useMutation({
    mutationFn: async () => {
      const mediaItems = composition.mediaItems;

      let maxEnd = 0;
      for (const trackFrames of Object.values(composition.frames)) {
        for (const frame of trackFrames) {
          const media = mediaItems[frame.data.mediaId];
          const duration = frame.duration || resolveDuration(media) || 5000;
          maxEnd = Math.max(maxEnd, frame.timestamp + duration);
        }
      }
      const timelineSettings = project.timeline ?? DEFAULT_TIMELINE_SETTINGS;
      const timelineDurationMs = timelineSettings.durationSeconds * 1000;
      const totalDuration = Math.max(maxEnd, timelineDurationMs);

      const videoData = composition.tracks.map((track) => ({
        id: track.id,
        type: track.type === "video" ? ("video" as const) : ("audio" as const),
        keyframes: composition.frames[track.id].map((frame) => {
          const media = mediaItems[frame.data.mediaId];
          const duration = frame.duration || resolveDuration(media) || 5000;
          return {
            timestamp: frame.timestamp,
            duration: duration,
            url: resolveMediaUrl(media),
            mediaId: frame.data.mediaId,
          };
        }),
      }));

      if (videoData.length === 0) {
        throw new Error("No tracks to export");
      }

      const videoBlob = await exportVideoClientSide(
        videoData,
        mediaItems,
        totalDuration,
        project.aspectRatio,
        (progress) => {
          setExportProgress(progress);
        },
      );

      const videoUrl = URL.createObjectURL(videoBlob);

      return {
        video_url: videoUrl,
        thumbnail_url: "",
        blob: videoBlob,
      };
    },
  });
  const setExportDialogOpen = useVideoProjectStore(
    (s) => s.setExportDialogOpen,
  );
  const handleOnOpenChange = (open: boolean) => {
    setExportDialogOpen(open);
    onOpenChange?.(open);
  };

  const { data: project = PROJECT_PLACEHOLDER } = useProject(projectId);

  const actionsDisabled = exportVideo.isPending;

  return (
    <Dialog onOpenChange={handleOnOpenChange} {...props}>
      <DialogContent className="sm:max-w-4xl max-w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilmIcon className="w-6 h-6 opacity-50" />
            {t("title")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <div className="text-muted-foreground">
          <p>{t("description")}</p>
        </div>
        <div
          className={cn(
            "w-full max-h-[500px] mx-auto max-w-full",
            project?.aspectRatio === "16:9" ? "aspect-[16/9]" : "aspect-[9/16]",
          )}
        >
          {exportVideo.isPending || exportVideo.data === undefined ? (
            <div
              className={cn(
                "bg-accent/30 flex flex-col items-center justify-center w-full h-full",
              )}
            >
              {exportVideo.isPending ? (
                <>
                  <LoadingIcon className="w-24 h-24" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("exporting")} {Math.round(exportProgress)}%
                  </p>
                </>
              ) : (
                <FilmIcon className="w-24 h-24 opacity-50" />
              )}
            </div>
          ) : (
            <video
              src={exportVideo.data.video_url}
              controls
              className="w-full h-full"
            >
              <track kind="captions" />
            </video>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={actionsDisabled || !exportVideo.data}
            aria-disabled={actionsDisabled || !exportVideo.data}
            asChild
          >
            <a href={exportVideo.data?.video_url ?? "#"} download>
              <DownloadIcon className="w-4 h-4" />
              {t("download")}
            </a>
          </Button>
          <Button
            onClick={() => exportVideo.mutate()}
            disabled={actionsDisabled}
          >
            {t("export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
