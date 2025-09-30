import type { MediaItem, AspectRatio } from "@/data/schema";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { resolveMediaUrl } from "./utils";
import { fal } from "./fal";

const videoSizeMap = {
  "16:9": { width: 1024, height: 576 },
  "9:16": { width: 576, height: 1024 },
  "1:1": { width: 1024, height: 1024 },
};

interface ExportKeyframe {
  timestamp: number;
  duration: number;
  url: string | null;
  mediaId: string;
}

interface ExportTrack {
  id: string;
  type: "video" | "audio";
  keyframes: ExportKeyframe[];
}

export async function exportVideoClientSide(
  tracks: ExportTrack[],
  mediaItems: Record<string, MediaItem>,
  totalDuration: number,
  aspectRatio: AspectRatio,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const ffmpeg = new FFmpeg();

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(Math.min(progress * 100, 99));
    });
  }

  const videoTrack = tracks.find((t) => t.type === "video");
  if (!videoTrack || !videoTrack.keyframes.length) {
    throw new Error("No video track found");
  }

  const dimensions = videoSizeMap[aspectRatio] || videoSizeMap["16:9"];
  const { width, height } = dimensions;

  const keyframes = [...videoTrack.keyframes].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const segments: Array<{
    type: "frame" | "gap";
    start: number;
    duration: number;
    keyframe?: ExportKeyframe;
  }> = [];

  let currentTime = 0;
  for (const keyframe of keyframes) {
    if (keyframe.timestamp > currentTime) {
      segments.push({
        type: "gap",
        start: currentTime,
        duration: keyframe.timestamp - currentTime,
      });
    }

    segments.push({
      type: "frame",
      start: keyframe.timestamp,
      duration: keyframe.duration,
      keyframe,
    });

    currentTime = keyframe.timestamp + keyframe.duration;
  }

  if (currentTime < totalDuration) {
    segments.push({
      type: "gap",
      start: currentTime,
      duration: totalDuration - currentTime,
    });
  }

  const clips: string[] = [];
  let clipIndex = 0;

  for (const segment of segments) {
    const durationSeconds = segment.duration / 1000;
    const outputFilename = `clip_${clipIndex}.mp4`;

    if (segment.type === "gap") {
      await ffmpeg.exec([
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${width}x${height}:d=${durationSeconds}`,
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        outputFilename,
      ]);
    } else {
      const { keyframe } = segment;
      if (!keyframe || !keyframe.url) continue;

      const url = keyframe.url;

      const mediaData = await fetchFile(url);
      const inputFilename = `input_${clipIndex}.${getExtension(url)}`;
      await ffmpeg.writeFile(inputFilename, mediaData);

      const media = mediaItems[keyframe.mediaId];
      const isImage =
        media?.mediaType === "image" || /\.(jpg|jpeg|png|gif|webp)$/i.test(url);

      if (isImage) {
        await ffmpeg.exec([
          "-loop",
          "1",
          "-i",
          inputFilename,
          "-t",
          durationSeconds.toString(),
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          outputFilename,
        ]);
      } else {
        await ffmpeg.exec([
          "-i",
          inputFilename,
          "-t",
          durationSeconds.toString(),
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          "-r",
          "30",
          "-pix_fmt",
          "yuv420p",
          outputFilename,
        ]);
      }
    }

    clips.push(outputFilename);
    clipIndex++;
  }

  const concatContent = clips.map((clip) => `file '${clip}'`).join("\n");
  await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatContent));

  await ffmpeg.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat.txt",
    "-c",
    "copy",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4");

  if (onProgress) {
    onProgress(100);
  }

  return new Blob([data], { type: "video/mp4" });
}

function getExtension(url: string): string {
  const match = url.match(/\.([^./?#]+)(?:[?#]|$)/);
  return match ? match[1] : "mp4";
}

export async function getMediaMetadata(media: MediaItem) {
  try {
    const { data: mediaMetadata } = await fal.subscribe(
      "fal-ai/ffmpeg-api/metadata",
      {
        input: {
          media_url: resolveMediaUrl(media),
          extract_frames: true,
        },
        mode: "streaming",
      },
    );

    return mediaMetadata;
  } catch (error) {
    console.error(error);
    return {};
  }
}
