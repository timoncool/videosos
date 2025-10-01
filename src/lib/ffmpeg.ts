import type { MediaItem, AspectRatio } from "@/data/schema";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { resolveMediaUrl } from "./utils";

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

  const audioTracks = tracks.filter((t) => t.type === "audio");

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

      const mediaData = await fetchFile(
        `${window.location.origin}/api/download?url=${encodeURIComponent(url)}`,
      );
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

  if (audioTracks.length > 0) {
    const audioInputs: string[] = [];

    for (let trackIdx = 0; trackIdx < audioTracks.length; trackIdx++) {
      const audioTrack = audioTracks[trackIdx];
      const audioKeyframes = [...audioTrack.keyframes].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      const audioSegments: Array<{
        type: "sound" | "silence";
        start: number;
        duration: number;
        keyframe?: ExportKeyframe;
      }> = [];

      let currentTime = 0;
      for (const keyframe of audioKeyframes) {
        if (keyframe.timestamp > currentTime) {
          audioSegments.push({
            type: "silence",
            start: currentTime,
            duration: keyframe.timestamp - currentTime,
          });
        }

        audioSegments.push({
          type: "sound",
          start: keyframe.timestamp,
          duration: keyframe.duration,
          keyframe,
        });

        currentTime = keyframe.timestamp + keyframe.duration;
      }

      if (currentTime < totalDuration) {
        audioSegments.push({
          type: "silence",
          start: currentTime,
          duration: totalDuration - currentTime,
        });
      }

      const trackAudioClips: string[] = [];
      let audioClipIndex = 0;

      for (const segment of audioSegments) {
        const durationSeconds = segment.duration / 1000;
        const outputFilename = `audio_track${trackIdx}_clip${audioClipIndex}.wav`;

        if (segment.type === "silence") {
          await ffmpeg.exec([
            "-f",
            "lavfi",
            "-i",
            `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${durationSeconds}`,
            outputFilename,
          ]);
        } else {
          const { keyframe } = segment;
          if (!keyframe || !keyframe.url) continue;

          const url = keyframe.url;
          const audioData = await fetchFile(
            `${window.location.origin}/api/download?url=${encodeURIComponent(url)}`,
          );
          const inputFilename = `audio_track${trackIdx}_input${audioClipIndex}.${getExtension(url)}`;
          await ffmpeg.writeFile(inputFilename, audioData);

          await ffmpeg.exec([
            "-i",
            inputFilename,
            "-t",
            durationSeconds.toString(),
            "-ar",
            "44100",
            "-ac",
            "2",
            outputFilename,
          ]);
        }

        trackAudioClips.push(outputFilename);
        audioClipIndex++;
      }

      const trackConcatContent = trackAudioClips
        .map((clip) => `file '${clip}'`)
        .join("\n");
      const trackConcatFilename = `audio_track${trackIdx}_concat.txt`;
      await ffmpeg.writeFile(
        trackConcatFilename,
        new TextEncoder().encode(trackConcatContent),
      );

      const trackOutputFilename = `audio_track${trackIdx}_final.wav`;
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        trackConcatFilename,
        "-c",
        "copy",
        trackOutputFilename,
      ]);

      audioInputs.push(trackOutputFilename);
    }

    let mixedAudioFilename = "audio_mixed.wav";
    if (audioInputs.length === 1) {
      mixedAudioFilename = audioInputs[0];
    } else {
      const amixInputs = audioInputs.map((_, idx) => `[${idx}:a]`).join("");
      const amixFilter = `${amixInputs}amix=inputs=${audioInputs.length}:duration=longest[aout]`;

      const ffmpegArgs = [];
      for (const input of audioInputs) {
        ffmpegArgs.push("-i", input);
      }
      ffmpegArgs.push(
        "-filter_complex",
        amixFilter,
        "-map",
        "[aout]",
        mixedAudioFilename,
      );

      await ffmpeg.exec(ffmpegArgs);
    }

    await ffmpeg.exec([
      "-i",
      "output.mp4",
      "-i",
      mixedAudioFilename,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "output_with_audio.mp4",
    ]);

    const finalData = await ffmpeg.readFile("output_with_audio.mp4");
    await ffmpeg.writeFile("output.mp4", finalData);
  }

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
    const mediaUrl = resolveMediaUrl(media);
    if (!mediaUrl) {
      return { media: {} };
    }

    return new Promise<{ media: any }>((resolve) => {
      const mediaElement =
        media.mediaType === "video"
          ? document.createElement("video")
          : document.createElement("audio");

      mediaElement.addEventListener("loadedmetadata", () => {
        const metadata = {
          duration: mediaElement.duration,
        };
        resolve({ media: metadata });
      });

      mediaElement.addEventListener("error", () => {
        console.error("Failed to load media metadata");
        resolve({ media: {} });
      });

      mediaElement.src = `${window.location.origin}/api/download?url=${encodeURIComponent(mediaUrl)}`;
      mediaElement.load();
    });
  } catch (error) {
    console.error("Error extracting metadata:", error);
    return { media: {} };
  }
}

export async function extractVideoThumbnail(
  videoUrl: string,
): Promise<string | null> {
  try {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.crossOrigin = "anonymous";
    video.muted = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
    });

    video.currentTime = 0;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
    });

    if (!blob) {
      throw new Error("Failed to create thumbnail blob");
    }

    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Failed to generate video thumbnail:", error);
    return null;
  }
}
