import { db } from "@/data/db";
import {
  queryKeys,
  refreshVideoCache,
  useProjectMediaItems,
} from "@/data/queries";
import type { MediaItem, VideoKeyFrame, VideoTrack } from "@/data/schema";
import { useProjectId, useVideoProjectStore } from "@/data/store";
import { cn, resolveDuration, resolveMediaUrl, trackIcons } from "@/lib/utils";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TrashIcon } from "lucide-react";
import type React from "react";
import {
  type HTMLAttributes,
  type MouseEventHandler,
  createElement,
  useMemo,
  useRef,
} from "react";
import { WithTooltip } from "../ui/tooltip";

type VideoTrackRowProps = {
  data: VideoTrack;
  timelineDurationMs: number;
  maxKeyframeDurationMs: number;
} & HTMLAttributes<HTMLDivElement>;

export function VideoTrackRow({
  data,
  timelineDurationMs,
  maxKeyframeDurationMs,
  ...props
}: VideoTrackRowProps) {
  const { data: keyframes = [] } = useQuery({
    queryKey: ["frames", data],
    queryFn: () => db.keyFrames.keyFramesByTrack(data.id),
  });

  const mediaType = useMemo(() => keyframes[0]?.data.type, [keyframes]);

  const safeTimelineDurationMs = Math.max(timelineDurationMs, 1);

  return (
    <div
      className={cn(
        "relative w-full timeline-container",
        "flex flex-col select-none rounded overflow-hidden shrink-0",
        {
          "min-h-[64px]": mediaType,
          "min-h-[56px]": !mediaType,
        },
      )}
      {...props}
    >
      {keyframes.map((frame) => (
        <VideoTrackView
          key={frame.id}
          className="absolute top-0 bottom-0"
          style={{
            left: `${((frame.timestamp / safeTimelineDurationMs) * 100).toFixed(2)}%`,
            width: `${((frame.duration / safeTimelineDurationMs) * 100).toFixed(2)}%`,
          }}
          track={data}
          frame={frame}
          timelineDurationMs={safeTimelineDurationMs}
          maxKeyframeDurationMs={maxKeyframeDurationMs}
        />
      ))}
    </div>
  );
}

type AudioWaveformProps = {
  data: MediaItem;
};

function AudioWaveform({ data }: AudioWaveformProps) {
  const { data: waveform = [] } = useQuery({
    queryKey: ["media", "waveform", data.id],
    queryFn: async () => {
      if (data.metadata?.waveform && Array.isArray(data.metadata.waveform)) {
        return data.metadata.waveform;
      }

      const audioUrl = resolveMediaUrl(data);
      if (!audioUrl) {
        throw new Error("No media URL found");
      }

      try {
        const proxyUrl = `${window.location.origin}/api/download?url=${encodeURIComponent(audioUrl)}`;
        const response = await fetch(proxyUrl);
        const arrayBuffer = await response.arrayBuffer();

        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const pointsPerSecond = 5;
        const precision = 3;
        const channelData = audioBuffer.getChannelData(0);
        const duration = audioBuffer.duration;
        const totalPoints = Math.floor(duration * pointsPerSecond);
        const samplesPerPoint = Math.floor(channelData.length / totalPoints);

        const waveformData: number[] = [];
        for (let i = 0; i < totalPoints; i++) {
          const start = i * samplesPerPoint;
          const end = Math.min(start + samplesPerPoint, channelData.length);

          let sum = 0;
          for (let j = start; j < end; j++) {
            sum += channelData[j] * channelData[j];
          }
          const rms = Math.sqrt(sum / (end - start));
          waveformData.push(Number(rms.toFixed(precision)));
        }

        await db.media.update(data.id, {
          ...data,
          metadata: {
            ...data.metadata,
            waveform: waveformData,
          },
        });

        return waveformData;
      } catch (error) {
        console.error("Failed to generate waveform locally:", error);
        return [];
      }
    },
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const svgHeight = 100;

  if (waveform.length === 0) {
    return null;
  }

  return (
    <div className="h-full flex items-center overflow-hidden">
      <div className="w-full">
        <svg
          width="100%"
          height="80%"
          viewBox={`0 0 ${waveform.length} ${svgHeight}`}
          preserveAspectRatio="none"
        >
          <title>Audio Waveform</title>
          {waveform.map((v, index) => {
            const amplitude = Math.abs(v);
            const height = Math.max(amplitude * svgHeight, 2);
            const x = index;
            const y = (svgHeight - height) / 2;

            return (
              <rect
                key={`waveform-${index}-${x}`}
                x={x}
                y={y}
                width="1"
                height={height}
                className="fill-black/40"
                rx="4"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

type VideoTrackViewProps = {
  track: VideoTrack;
  frame: VideoKeyFrame;
  timelineDurationMs: number;
  maxKeyframeDurationMs: number;
} & HTMLAttributes<HTMLDivElement>;

export function VideoTrackView({
  className,
  track,
  frame,
  timelineDurationMs,
  maxKeyframeDurationMs,
  ...props
}: VideoTrackViewProps) {
  const queryClient = useQueryClient();
  const deleteKeyframe = useMutation({
    mutationFn: () => db.keyFrames.delete(frame.id),
    onSuccess: () => refreshVideoCache(queryClient, track.projectId),
  });
  const handleOnDelete = () => {
    deleteKeyframe.mutate();
  };

  const isSelected = useVideoProjectStore((state) =>
    state.selectedKeyframes.includes(frame.id),
  );
  const selectKeyframe = useVideoProjectStore((state) => state.selectKeyframe);
  const handleOnClick: MouseEventHandler = (e) => {
    if (e.detail > 1) {
      return;
    }
    selectKeyframe(frame.id);
  };

  const projectId = useProjectId();
  const { data: mediaItems = [] } = useProjectMediaItems(projectId);

  const media = mediaItems.find((item) => item.id === frame.data.mediaId);
  const mediaUrl = media ? resolveMediaUrl(media) : null;

  const trackRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(() => {
    if (!media) return undefined;
    if (media.mediaType === "image") {
      return mediaUrl;
    }
    if (media.mediaType === "video") {
      return (
        media.metadata?.thumbnail_url ||
        media.input?.image_url ||
        media.metadata?.start_frame_url ||
        media.metadata?.end_frame_url
      );
    }
    return undefined;
  }, [media, mediaUrl]);

  // TODO improve missing data
  if (!media) return null;

  const label = media.mediaType ?? "unknown";

  const calculateBounds = () => {
    const trackElement = trackRef.current;
    const timelineElement = trackElement?.closest(
      ".timeline-container",
    ) as HTMLElement | null;
    const timelineRect = timelineElement?.getBoundingClientRect();
    const trackRect = trackElement?.getBoundingClientRect();

    if (!timelineRect || !trackRect || !trackElement)
      return { left: 0, right: 0 };

    const previousTrack = trackElement?.previousElementSibling;
    const nextTrack = trackElement?.nextElementSibling;

    const leftBound = previousTrack
      ? previousTrack.getBoundingClientRect().right - (timelineRect?.left || 0)
      : 0;
    const rightBound = nextTrack
      ? nextTrack.getBoundingClientRect().left -
        (timelineRect?.left || 0) -
        trackRect.width
      : timelineRect.width - trackRect.width;

    return {
      left: leftBound,
      right: rightBound,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest(
        'button,[role="button"],a,input,textarea,select',
      )
    ) {
      return;
    }

    const trackElement = trackRef.current;
    if (!trackElement) return;
    const bounds = calculateBounds();
    const startX = e.clientX;
    const startLeft = trackElement.offsetLeft;
    const duplicateMode = e.ctrlKey || e.metaKey;
    const originalTimestamp = frame.timestamp;
    const originalLeftStyle = trackElement.style.left;
    let duplicateTimestamp = frame.timestamp;

    const applyLeftStyle = (timestamp: number) => {
      const percent = (timestamp / timelineDurationMs) * 100;
      trackElement.style.left = `${percent.toFixed(2)}%`;
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      let newLeft = startLeft + deltaX;

      if (newLeft < bounds.left) {
        newLeft = bounds.left;
      } else if (newLeft > bounds.right) {
        newLeft = bounds.right;
      }

      const timelineElement = trackElement.closest(".timeline-container");
      const parentWidth = timelineElement
        ? (timelineElement as HTMLElement).offsetWidth
        : 1;
      const ratio = newLeft / parentWidth;
      const sanitizedTimestamp = Math.max(0, ratio) * timelineDurationMs;

      if (duplicateMode) {
        duplicateTimestamp = sanitizedTimestamp;
        applyLeftStyle(sanitizedTimestamp);
        return;
      }

      frame.timestamp = sanitizedTimestamp;
      applyLeftStyle(frame.timestamp);
      db.keyFrames.update(frame.id, { timestamp: frame.timestamp });
    };

    const handleMouseUp = async () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (duplicateMode) {
        if (originalLeftStyle) {
          trackElement.style.left = originalLeftStyle;
        } else {
          applyLeftStyle(originalTimestamp);
        }

        await db.keyFrames.create({
          trackId: frame.trackId,
          data: { ...frame.data },
          timestamp: duplicateTimestamp,
          duration: frame.duration,
        });
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.projectPreview(projectId),
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleResize = (
    e: React.MouseEvent<HTMLDivElement>,
    direction: "left" | "right",
  ) => {
    e.stopPropagation();
    const trackElement = trackRef.current;
    if (!trackElement) return;
    const startX = e.clientX;
    const startWidth = trackElement.offsetWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      let newWidth = startWidth + (direction === "right" ? deltaX : -deltaX);

      const minDuration = 1000;
      const mediaDuration = resolveDuration(media) ?? 5000;
      const maxDuration = Math.min(mediaDuration, maxKeyframeDurationMs);

      const timelineElement = trackElement.closest(".timeline-container");
      const parentWidth = timelineElement
        ? (timelineElement as HTMLElement).offsetWidth
        : 1;
      let newDuration = (newWidth / parentWidth) * timelineDurationMs;

      if (newDuration < minDuration) {
        newWidth = (minDuration / timelineDurationMs) * parentWidth;
        newDuration = minDuration;
      } else if (newDuration > maxDuration) {
        newWidth = (maxDuration / timelineDurationMs) * parentWidth;
        newDuration = maxDuration;
      }

      frame.duration = newDuration;
      const percent = (frame.duration / timelineDurationMs) * 100;
      trackElement.style.width = `${percent.toFixed(2)}%`;
    };

    const handleMouseUp = () => {
      frame.duration = Math.round(frame.duration / 100) * 100;
      const percent = (frame.duration / timelineDurationMs) * 100;
      trackElement.style.width = `${percent.toFixed(2)}%`;
      db.keyFrames.update(frame.id, { duration: frame.duration });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectPreview(projectId),
      });
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      ref={trackRef}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      aria-checked={isSelected}
      onClick={handleOnClick}
      className={cn(
        "flex flex-col border border-white/10 rounded-lg",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "flex flex-col select-none rounded overflow-hidden group h-full",
          {
            "bg-sky-600": track.type === "video",
            "bg-teal-500": track.type === "music",
            "bg-indigo-500": track.type === "voiceover",
          },
        )}
      >
        <div className="relative z-60 p-0.5 pl-1 bg-black/10 flex flex-row items-center pointer-events-auto">
          <div className="flex flex-row gap-1 text-sm items-center font-semibold text-white/60 w-full">
            <div className="flex flex-row truncate gap-1 items-center">
              {createElement(trackIcons[track.type], {
                className: "w-5 h-5 text-white",
              } as React.ComponentProps<
                (typeof trackIcons)[typeof track.type]
              >)}
              <span className="line-clamp-1 truncate text-sm mb-[2px] w-full ">
                {media.input?.prompt || label}
              </span>
            </div>
            <div className="flex flex-row shrink-0 flex-1 items-center justify-end">
              <WithTooltip tooltip="Remove content">
                <button
                  type="button"
                  className="p-1 rounded hover:bg-black/5 group-hover:text-white"
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOnDelete();
                  }}
                >
                  <TrashIcon className="w-3 h-3 text-white" />
                </button>
              </WithTooltip>
            </div>
          </div>
        </div>
        <div
          className="p-px flex-1 items-center bg-repeat-x h-full max-h-full overflow-hidden relative"
          style={
            imageUrl
              ? {
                  background: `url(${imageUrl})`,
                  backgroundSize: "auto 100%",
                }
              : undefined
          }
        >
          {(media.mediaType === "music" || media.mediaType === "voiceover") && (
            <AudioWaveform data={media} />
          )}
          <div
            className={cn(
              "absolute right-0 z-50 top-0 bg-black/20 group-hover:bg-black/40",
              "rounded-md bottom-0 w-2 m-1 p-px cursor-ew-resize backdrop-blur-md text-white/40",
              "transition-colors flex flex-col items-center justify-center text-xs tracking-tighter",
            )}
            onMouseDown={(e) => handleResize(e, "right")}
          >
            <span className="flex gap-[1px]">
              <span className="w-px h-2 rounded bg-white/40" />
              <span className="w-px h-2 rounded bg-white/40" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
