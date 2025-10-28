import type { AspectRatio, MediaItem } from "@/data/schema";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { resolveMediaUrl } from "./utils";

const FF_WORKER_BASE_URL = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm";
const patchedWorkerCache = new Map<number, string>();

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
  const durationMinutes = Math.max(1, Math.ceil(totalDuration / 60000));
  const basePages = 4096; // ~256MB
  const extraPagesPerMinute = 512; // ~32MB per additional minute
  const calculatedPages =
    basePages + (durationMinutes - 1) * extraPagesPerMinute;
  const initialPages = Math.min(calculatedPages, 16_384);
  const workerURL = await getPatchedWorkerURL(initialPages);
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    classWorkerURL: workerURL,
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
  const videoAudioClips: string[] = [];
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

      const videoAudioFilename = `video_audio_${clipIndex}.wav`;
      await ffmpeg.exec([
        "-f",
        "lavfi",
        "-i",
        `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${durationSeconds}`,
        videoAudioFilename,
      ]);
      videoAudioClips.push(videoAudioFilename);
    } else {
      const { keyframe } = segment;
      if (!keyframe || !keyframe.url) continue;

      const url = keyframe.url;

      let mediaData: Uint8Array;
      if (url.startsWith("blob:")) {
        mediaData = await fetchFile(url);
      } else {
        mediaData = await fetchFile(
          `${window.location.origin}/api/download?url=${encodeURIComponent(url)}`,
        );
      }

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

        const videoAudioFilename = `video_audio_${clipIndex}.wav`;
        await ffmpeg.exec([
          "-f",
          "lavfi",
          "-i",
          `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${durationSeconds}`,
          videoAudioFilename,
        ]);
        videoAudioClips.push(videoAudioFilename);
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

        const videoAudioFilename = `video_audio_${clipIndex}.wav`;
        await ffmpeg.exec([
          "-i",
          inputFilename,
          "-t",
          durationSeconds.toString(),
          "-vn",
          "-ar",
          "44100",
          "-ac",
          "2",
          videoAudioFilename,
        ]);
        videoAudioClips.push(videoAudioFilename);
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

  const videoAudioConcatContent = videoAudioClips
    .map((clip) => `file '${clip}'`)
    .join("\n");
  await ffmpeg.writeFile(
    "video_audio_concat.txt",
    new TextEncoder().encode(videoAudioConcatContent),
  );

  await ffmpeg.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "video_audio_concat.txt",
    "-c",
    "copy",
    "video_audio_track.wav",
  ]);

  if (audioTracks.length > 0 || videoAudioClips.length > 0) {
    const audioInputs: string[] = [];

    if (videoAudioClips.length > 0) {
      audioInputs.push("video_audio_track.wav");
    }

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

          let audioData: Uint8Array;
          if (url.startsWith("blob:")) {
            audioData = await fetchFile(url);
          } else {
            audioData = await fetchFile(
              `${window.location.origin}/api/download?url=${encodeURIComponent(url)}`,
            );
          }

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

async function getPatchedWorkerURL(initialPages: number): Promise<string> {
  const cacheKey = Math.max(Math.floor(initialPages), 0);
  const cached = patchedWorkerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${FF_WORKER_BASE_URL}/worker.js`);
  if (!response.ok) {
    throw new Error(`Failed to load ffmpeg worker (${response.status})`);
  }

  let script = await response.text();
  script = script.replace(/from\s+"\.\/([^"]+)"/g, (_match, path) => {
    return `from "${FF_WORKER_BASE_URL}/${path}"`;
  });

  const injectionAnchor = "ffmpeg = await self.createFFmpegCore({";
  if (!script.includes(injectionAnchor)) {
    throw new Error("Unable to patch ffmpeg worker: unexpected source format");
  }

  const injection = `const wasmMemory = self.__ffmpegWasmMemory || new WebAssembly.Memory({ initial: ${cacheKey}, maximum: 16384 });\n    self.__ffmpegWasmMemory = wasmMemory;\n    ffmpeg = await self.createFFmpegCore({`;
  script = script.replace(injectionAnchor, injection);

  const blobUrl = URL.createObjectURL(
    new Blob([script], { type: "text/javascript" }),
  );
  patchedWorkerCache.set(cacheKey, blobUrl);
  return blobUrl;
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
        resolve({ media: mediaElement });
      });

      if (mediaUrl.startsWith("blob:")) {
        mediaElement.src = mediaUrl;
      } else {
        mediaElement.src = `${window.location.origin}/api/download?url=${encodeURIComponent(mediaUrl)}`;
      }
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

    return canvas.toDataURL("image/jpeg", 0.8);
  } catch (error) {
    console.error("Failed to generate video thumbnail:", error);
    return null;
  }
}
