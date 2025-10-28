"use client";

import { db } from "@/data/db";
import { queryKeys, refreshVideoCache } from "@/data/queries";
import {
  type MediaItem,
  TRACK_TYPE_ORDER,
  type VideoTrack,
} from "@/data/schema";
import { useProjectId, useVideoProjectStore } from "@/data/store";
import { cn, resolveDuration } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  type DragEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VideoControls } from "./video-controls";
import { TimelineRuler } from "./video/timeline";
import { VideoTrackRow } from "./video/track";

export default function BottomBar() {
  const t = useTranslations("app.bottomBar");
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const player = useVideoProjectStore((s) => s.player);
  const playerCurrentTimestamp = useVideoProjectStore(
    (s) => s.playerCurrentTimestamp,
  );
  const setPlayerCurrentTimestamp = useVideoProjectStore(
    (s) => s.setPlayerCurrentTimestamp,
  );
  const timelineWrapperRef = useRef<HTMLDivElement>(null);
  const timelineDurationSeconds = 30;
  const FPS = 30;
  const minTrackWidth = `${((2 / timelineDurationSeconds) * 100).toFixed(2)}%`;
  const currentMinutes = Math.floor(playerCurrentTimestamp / 60);
  const formattedCurrentMinutes = currentMinutes.toString().padStart(2, "0");
  const currentSeconds = playerCurrentTimestamp % 60;
  const formattedCurrentSeconds = currentSeconds.toFixed(2).padStart(5, "0");
  const totalMinutes = Math.floor(timelineDurationSeconds / 60);
  const formattedTotalMinutes = totalMinutes.toString().padStart(2, "0");
  const formattedTotalSeconds = (timelineDurationSeconds % 60)
    .toFixed(2)
    .padStart(5, "0");
  const [dragOverTracks, setDragOverTracks] = useState(false);

  const limitAllKeyframesToThirtySeconds = useMutation({
    mutationFn: async () => {
      const tracks = await db.tracks.tracksByProject(projectId);

      let updatedCount = 0;

      for (const track of tracks) {
        const keyframes = await db.keyFrames.keyFramesByTrack(track.id);

        for (const frame of keyframes) {
          if (frame.duration > 30000) {
            await db.keyFrames.update(frame.id, {
              duration: 30000,
            });
            updatedCount++;
          }
        }
      }

      return updatedCount;
    },
    onSuccess: (updatedCount) => {
      if (updatedCount > 0) {
        refreshVideoCache(queryClient, projectId);
      }
    },
  });

  const { data: tracks = [] } = useQuery({
    queryKey: queryKeys.projectTracks(projectId),
    queryFn: async () => {
      const result = await db.tracks.tracksByProject(projectId);
      return result.toSorted(
        (a, b) => TRACK_TYPE_ORDER[a.type] - TRACK_TYPE_ORDER[b.type],
      );
    },
  });

  // Automatically limit keyframes to 30 seconds whenever tracks change
  useEffect(() => {
    if (tracks.length > 0) {
      limitAllKeyframesToThirtySeconds.mutate();
    }
  }, [tracks, limitAllKeyframesToThirtySeconds]);

  const handleOnDragOver: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    setDragOverTracks(true);
    const jobPayload = event.dataTransfer.getData("job");
    if (!jobPayload) return false;
    const job: MediaItem = JSON.parse(jobPayload);
    return job.status === "completed";
  };

  const addToTrack = useMutation({
    mutationFn: async (media: MediaItem) => {
      const tracks = await db.tracks.tracksByProject(media.projectId);
      const trackType = media.mediaType === "image" ? "video" : media.mediaType;
      let track = tracks.find((t) => t.type === trackType);
      if (!track) {
        const id = await db.tracks.create({
          projectId: media.projectId,
          type: trackType,
          label: media.mediaType,
          locked: true,
        });
        const newTrack = await db.tracks.find(id.toString());
        if (!newTrack) return;
        track = newTrack;
      }
      const keyframes = await db.keyFrames.keyFramesByTrack(track.id);

      const lastKeyframe = [...keyframes]
        .sort((a, b) => a.timestamp - b.timestamp)
        .reduce(
          (acc, frame) => {
            if (frame.timestamp + frame.duration > acc.timestamp + acc.duration)
              return frame;
            return acc;
          },
          { timestamp: 0, duration: 0 },
        );

      const mediaDuration = resolveDuration(media) ?? 5000;
      const duration = Math.min(mediaDuration, 30000);

      const newId = await db.keyFrames.create({
        trackId: track.id,
        data: {
          mediaId: media.id,
          type: media.input?.image_url ? "image" : "prompt",
          prompt: media.input?.prompt || "",
          url: media.input?.image_url?.url,
        },
        timestamp: lastKeyframe
          ? lastKeyframe.timestamp + 1 + lastKeyframe.duration
          : 0,
        duration,
      });
      return db.keyFrames.find(newId.toString());
    },
    onSuccess: (data) => {
      if (!data) return;
      refreshVideoCache(queryClient, projectId);
    },
  });

  const trackObj: Record<string, VideoTrack> = useMemo(() => {
    return {
      video:
        tracks.find((t) => t.type === "video") ||
        ({
          id: "video",
          type: "video",
          label: t("video"),
          locked: true,
          keyframes: [],
          projectId: projectId,
        } as VideoTrack),
      music:
        tracks.find((t) => t.type === "music") ||
        ({
          id: "music",
          type: "music",
          label: t("music"),
          locked: true,
          keyframes: [],
          projectId: projectId,
        } as VideoTrack),
      voiceover:
        tracks.find((t) => t.type === "voiceover") ||
        ({
          id: "voiceover",
          type: "voiceover",
          label: t("voiceover"),
          locked: true,
          keyframes: [],
          projectId: projectId,
        } as VideoTrack),
    };
  }, [tracks, projectId, t]);

  const handleOnDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    setDragOverTracks(false);
    const jobPayload = event.dataTransfer.getData("job");
    if (!jobPayload) return false;
    const job: MediaItem = JSON.parse(jobPayload);
    addToTrack.mutate(job);
    return true;
  };

  const seekToTimestamp = (nextTimestamp: number) => {
    const clampedTimestamp = Math.max(
      0,
      Math.min(nextTimestamp, timelineDurationSeconds),
    );

    if (player) {
      const frame = Math.round(clampedTimestamp * FPS);
      player.seekTo(frame);
    }

    setPlayerCurrentTimestamp(clampedTimestamp);
  };

  const handleTimelineClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const timelineElement = timelineWrapperRef.current;
    if (!timelineElement) return;

    const rect = timelineElement.getBoundingClientRect();
    if (rect.width === 0) return;

    const relativeX = event.clientX - rect.left;
    const clampedX = Math.min(Math.max(relativeX, 0), rect.width);
    const ratio = clampedX / rect.width;
    const nextTimestamp = timelineDurationSeconds * ratio;

    seekToTimestamp(nextTimestamp);
  };

  const handleTimelineKeyDown: KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        seekToTimestamp(playerCurrentTimestamp - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        seekToTimestamp(playerCurrentTimestamp + 1);
        break;
      case "Home":
        event.preventDefault();
        seekToTimestamp(0);
        break;
      case "End":
        event.preventDefault();
        seekToTimestamp(timelineDurationSeconds);
        break;
      default:
        break;
    }
  };

  const timelineProgressPercent = (
    (Math.max(0, Math.min(playerCurrentTimestamp, timelineDurationSeconds)) /
      timelineDurationSeconds) *
    100
  ).toFixed(2);

  return (
    <div className="border-t pb-2 border-border flex flex-col bg-background-light ">
      <div className="border-b border-border bg-background-dark px-2 flex flex-row gap-8 py-2 justify-between items-center flex-1">
        <div className="h-full flex flex-col justify-center px-4 bg-muted/50 rounded-md font-mono cursor-default select-none shadow-inner">
          <div className="flex flex-row items-baseline font-thin tabular-nums">
            <span className="text-muted-foreground">
              {formattedCurrentMinutes}:
            </span>
            <span>{formattedCurrentSeconds}</span>
            <span className="text-muted-foreground/50 mx-2">/</span>
            <span className="text-sm opacity-50">
              <span className="text-muted-foreground">
                {formattedTotalMinutes}:
              </span>
              {formattedTotalSeconds}
            </span>
          </div>
        </div>
        <VideoControls />
      </div>
      <div
        className={cn(
          "min-h-64  max-h-72 h-full flex flex-row overflow-y-scroll transition-colors",
          {
            "bg-white/5": dragOverTracks,
          },
        )}
        onDragOver={handleOnDragOver}
        onDragLeave={() => setDragOverTracks(false)}
        onDrop={handleOnDrop}
      >
        <div
          ref={timelineWrapperRef}
          className="flex flex-col justify-start w-full h-full relative"
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={timelineDurationSeconds}
          aria-valuenow={playerCurrentTimestamp}
          aria-valuetext={`${formattedCurrentMinutes}:${formattedCurrentSeconds}`}
          tabIndex={0}
          onClick={handleTimelineClick}
          onKeyDown={handleTimelineKeyDown}
        >
          <div
            className="pointer-events-none absolute z-[32] top-6 bottom-0 w-[2px] bg-white/30 ms-4"
            style={{
              left: `${timelineProgressPercent}%`,
            }}
          />
          <TimelineRuler className="z-30" />
          <div className="relative z-[31] flex timeline-container flex-col h-full mx-4 mt-10 gap-2 pb-2 pointer-events-auto">
            {Object.entries(trackObj).map(([trackType, track]) =>
              track ? (
                <VideoTrackRow
                  key={track.id}
                  data={track}
                  style={{
                    minWidth: minTrackWidth,
                  }}
                />
              ) : (
                <div
                  key={`empty-track-${trackType}`}
                  className="flex flex-row relative w-full h-full timeline-container"
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
