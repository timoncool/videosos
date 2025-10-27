"use client";

import { useJobCreator } from "@/data/mutations";
import { queryKeys, useProject, useProjectMediaItems } from "@/data/queries";
import type { MediaItem } from "@/data/schema";
import {
  type GenerateData,
  type MediaType,
  useProjectId,
  useVideoProjectStore,
} from "@/data/store";
import { AVAILABLE_ENDPOINTS, type InputAsset } from "@/lib/fal";
import { RUNWARE_ENDPOINTS } from "@/lib/runware-models";
import {
  ArrowLeft,
  CrossIcon,
  ImageIcon,
  LoaderCircleIcon,
  MicIcon,
  MusicIcon,
  TrashIcon,
  VideoIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaItemRow } from "./media-panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

import { db } from "@/data/db";
import { useToast } from "@/hooks/use-toast";
import { fal } from "@/lib/fal";
import { getMediaMetadata } from "@/lib/ffmpeg";
import { enhancePrompt } from "@/lib/prompt";
import {
  assetKeyMap,
  cn,
  getAssetKey,
  getAssetType,
  mapInputKey,
  resolveMediaUrl,
} from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import CameraMovement from "./camera-control";
import { VoiceSelector } from "./playht/voice-selector";
import { LoadingIcon } from "./ui/icons";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { WithTooltip } from "./ui/tooltip";
import VideoFrameSelector from "./video-frame-selector";

const ALL_ENDPOINTS = [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS];

const isFalEndpoint = (endpointId?: string) =>
  !!endpointId &&
  AVAILABLE_ENDPOINTS.some((endpoint) => endpoint.endpointId === endpointId);

const isRunwareEndpoint = (endpointId?: string) =>
  !!endpointId &&
  RUNWARE_ENDPOINTS.some((endpoint) => endpoint.endpointId === endpointId);

const assetUrlKeys = ["url", "cachedUrl"] as const;

const isFileLike = (value: unknown): value is File | Blob => {
  if (typeof File !== "undefined" && value instanceof File) {
    return true;
  }

  return typeof Blob !== "undefined" && value instanceof Blob;
};

const normalizeAssetValue = (
  value: unknown,
): string | File | Blob | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (isFileLike(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const key of assetUrlKeys) {
      const urlCandidate = record[key];
      if (typeof urlCandidate === "string") {
        const trimmed = urlCandidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return undefined;
};

const isAssetValueProvided = (value: unknown) =>
  Boolean(normalizeAssetValue(value));

const getProviderForEndpoint = (
  endpointId?: string,
): "fal" | "runware" | undefined => {
  if (!endpointId) return undefined;
  if (isFalEndpoint(endpointId)) return "fal";
  if (isRunwareEndpoint(endpointId)) return "runware";
  return undefined;
};

type ModelEndpointPickerProps = {
  mediaType: string;
  onValueChange: (value: MediaType) => void;
} & Parameters<typeof Select>[0];

function ModelEndpointPicker({
  mediaType,
  ...props
}: ModelEndpointPickerProps) {
  const [providerFilter, setProviderFilter] = useState<
    "all" | "fal" | "runware"
  >("all");

  const endpoints = useMemo(() => {
    const allEndpoints = [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS];
    const filtered = allEndpoints
      .filter((endpoint) => {
        if (endpoint.category !== mediaType) return false;
        if (providerFilter !== "all" && endpoint.provider !== providerFilter)
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.provider !== b.provider) {
          return a.provider === "fal" ? -1 : 1;
        }
        return b.popularity - a.popularity;
      });

    return filtered;
  }, [mediaType, providerFilter]);

  return (
    <div className="flex flex-col gap-2">
      <Tabs
        value={providerFilter}
        onValueChange={(v) => setProviderFilter(v as "all" | "fal" | "runware")}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="fal">FAL</TabsTrigger>
          <TabsTrigger value="runware">Runware</TabsTrigger>
        </TabsList>
      </Tabs>

      <Select {...props}>
        <SelectTrigger className="text-base w-full minw-56 font-semibold">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {endpoints.map((endpoint) => (
            <SelectItem key={endpoint.endpointId} value={endpoint.endpointId}>
              <div className="flex flex-row gap-2 items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span>{endpoint.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {endpoint.provider}
                  </Badge>
                </div>
                {endpoint.cost && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {endpoint.cost}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { useTranslations } from "next-intl";

export default function RightPanel({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("app.rightPanel");
  const tToast = useTranslations("app.toast");
  const videoProjectStore = useVideoProjectStore((s) => s);
  const {
    generateData,
    setGenerateData,
    resetGenerateData,
    endpointId,
    setEndpointId,
  } = videoProjectStore;

  const [tab, setTab] = useState<string>("generation");
  const [assetMediaType, setAssetMediaType] = useState("all");
  const projectId = useProjectId();
  const openGenerateDialog = useVideoProjectStore((s) => s.openGenerateDialog);
  const generateDialogOpen = useVideoProjectStore((s) => s.generateDialogOpen);
  const closeGenerateDialog = useVideoProjectStore(
    (s) => s.closeGenerateDialog,
  );
  const queryClient = useQueryClient();

  const [apiKeys, setApiKeys] = useState({ fal: false, runware: false });

  const updateApiKeys = useCallback(() => {
    if (typeof window === "undefined") return;
    setApiKeys({
      fal: Boolean(localStorage.getItem("falKey")),
      runware: Boolean(localStorage.getItem("runwareKey")),
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    updateApiKeys();
    window.addEventListener("focus", updateApiKeys);
    window.addEventListener("storage", updateApiKeys);
    window.addEventListener("apiKeysUpdated", updateApiKeys);

    return () => {
      window.removeEventListener("focus", updateApiKeys);
      window.removeEventListener("storage", updateApiKeys);
      window.removeEventListener("apiKeysUpdated", updateApiKeys);
    };
  }, [updateApiKeys]);

  const generateDialogOpenRef = useRef(generateDialogOpen);
  const shouldReopenOnSuccessRef = useRef(false);

  const handleOnOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        closeGenerateDialog();
        resetGenerateData();
        shouldReopenOnSuccessRef.current = false;
        return;
      }
      onOpenChange?.(isOpen);
      openGenerateDialog();
    },
    [closeGenerateDialog, resetGenerateData, onOpenChange, openGenerateDialog],
  );

  const { data: project } = useProject(projectId);

  const { toast } = useToast();
  const enhance = useMutation({
    mutationFn: async () => {
      return enhancePrompt(generateData.prompt, {
        type: mediaType,
        project,
      });
    },
    onSuccess: (enhancedPrompt) => {
      setGenerateData({ prompt: enhancedPrompt });
    },
    onError: (error) => {
      console.warn("Failed to create suggestion", error);
      toast({
        title: tToast("enhancePromptFailed"),
        description: tToast("enhancePromptFailedDesc"),
      });
    },
  });

  const { data: mediaItems = [] } = useProjectMediaItems(projectId);
  const mediaType = useVideoProjectStore((s) => s.generateMediaType);
  const setMediaType = useVideoProjectStore((s) => s.setGenerateMediaType);

  const allEndpoints = useMemo(
    () => [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS],
    [],
  );

  const endpoint = useMemo(
    () => allEndpoints.find((endpoint) => endpoint.endpointId === endpointId),
    [endpointId, allEndpoints],
  );

  const provider = useMemo(
    () => endpoint?.provider ?? getProviderForEndpoint(endpointId),
    [endpoint, endpointId],
  );
  const isFalProvider = provider === "fal";
  const isRunwareProvider = provider === "runware";
  const isProviderKeyMissing =
    (isFalProvider && !apiKeys.fal) || (isRunwareProvider && !apiKeys.runware);

  const ensureProviderKey = useCallback(() => {
    if (isFalProvider && !apiKeys.fal) {
      toast({
        title: tToast("falKeyRequired"),
        description: tToast("falKeyRequiredDesc"),
        variant: "destructive",
      });
      return false;
    }

    if (isRunwareProvider && !apiKeys.runware) {
      toast({
        title: tToast("runwareKeyRequired"),
        description: tToast("runwareKeyRequiredDesc"),
        variant: "destructive",
      });
      return false;
    }

    return true;
  }, [
    apiKeys.fal,
    apiKeys.runware,
    isFalProvider,
    isRunwareProvider,
    tToast,
    toast,
  ]);

  useEffect(() => {
    if (generateDialogOpen) {
      updateApiKeys();
    }
  }, [generateDialogOpen, updateApiKeys]);

  const { isAssetProvided, missingAssets } = useMemo(() => {
    if (!endpoint?.inputAsset || endpoint.inputAsset.length === 0) {
      return { isAssetProvided: true, missingAssets: [] as string[] };
    }

    const missing = endpoint.inputAsset.reduce<string[]>((acc, asset) => {
      const assetKey = getAssetKey(asset);
      const assetValue = generateData[assetKey];

      if (!isAssetValueProvided(assetValue)) {
        acc.push(getAssetType(asset));
      }

      return acc;
    }, []);

    return {
      isAssetProvided: missing.length === 0,
      missingAssets: Array.from(new Set(missing)),
    };
  }, [endpoint?.inputAsset, generateData]);

  const missingAssetLabels = useMemo(() => {
    if (missingAssets.length === 0) return "";

    const labelMap: Record<string, string> = {
      image: t("image"),
      video: t("video"),
      audio: t("audio"),
    };

    return missingAssets.map((asset) => labelMap[asset] ?? asset).join(", ");
  }, [missingAssets, t]);
  const handleMediaTypeChange = (mediaType: string) => {
    setMediaType(mediaType as MediaType);
    const endpoint = allEndpoints.find(
      (endpoint) => endpoint.category === mediaType,
    );

    const initialInput = endpoint?.initialInput || {};

    if (
      (mediaType === "video" &&
        endpoint?.endpointId === "fal-ai/hunyuan-video") ||
      mediaType !== "video"
    ) {
      setGenerateData({ image: null, ...initialInput });
    } else {
      setGenerateData({ ...initialInput });
    }

    setEndpointId(endpoint?.endpointId ?? allEndpoints[0].endpointId);
  };
  // TODO improve model-specific parameters
  type InputType = {
    prompt: string;
    image_url?: File | Blob | string | null;
    video_url?: File | Blob | string | null;
    audio_url?: File | Blob | string | null;
    image_size?: { width: number; height: number } | string;
    aspect_ratio?: string;
    seconds_total?: number;
    voice?: string;
    input?: string;
    reference_audio_url?: File | Blob | string | null;
    images?: {
      start_frame_num: number;
      image_url: string | File | Blob;
    }[];
    advanced_camera_control?: {
      movement_value: number;
      movement_type: string;
    };
  };

  const aspectRatioMap = {
    "16:9": { image: "landscape_16_9", video: "16:9" },
    "9:16": { image: "portrait_16_9", video: "9:16" },
    "1:1": { image: "square_1_1", video: "1:1" },
  };

  let imageAspectRatio: string | { width: number; height: number } | undefined;
  let videoAspectRatio: string | undefined;

  if (project?.aspectRatio) {
    imageAspectRatio = aspectRatioMap[project.aspectRatio].image;
    videoAspectRatio = aspectRatioMap[project.aspectRatio].video;
  }

  const input: InputType = {
    prompt: generateData.prompt,
    image_url: undefined,
    image_size: imageAspectRatio,
    aspect_ratio: videoAspectRatio,
    seconds_total: generateData.duration ?? undefined,
    voice:
      endpointId === "fal-ai/playht/tts/v3" ? generateData.voice : undefined,
    input:
      endpointId === "fal-ai/playht/tts/v3" ? generateData.prompt : undefined,
  };

  const normalizedImage = normalizeAssetValue(generateData.image);
  if (normalizedImage) {
    input.image_url = normalizedImage;
  }

  const normalizedVideo = normalizeAssetValue(generateData.video_url);
  if (normalizedVideo) {
    input.video_url = normalizedVideo;
  }

  const normalizedAudio = normalizeAssetValue(generateData.audio_url);
  if (normalizedAudio) {
    input.audio_url = normalizedAudio;
  }

  const normalizedReferenceAudio = normalizeAssetValue(
    generateData.reference_audio_url,
  );
  if (normalizedReferenceAudio) {
    input.reference_audio_url = normalizedReferenceAudio;
  }

  if (generateData.advanced_camera_control) {
    input.advanced_camera_control = generateData.advanced_camera_control;
  }

  if (generateData.images) {
    input.images = generateData.images;
  }

  const extraInput =
    endpointId === "fal-ai/f5-tts"
      ? {
          gen_text: generateData.prompt,
          ref_audio_url:
            "https://github.com/SWivid/F5-TTS/raw/21900ba97d5020a5a70bcc9a0575dc7dec5021cb/tests/ref_audio/test_en_1_ref_short.wav",
          ref_text: "Some call me nature, others call me mother nature.",
          model_type: "F5-TTS",
          remove_silence: true,
        }
      : {};
  const createJob = useJobCreator({
    projectId,
    endpointId:
      generateData.image &&
      mediaType === "video" &&
      !endpointId.endsWith("/image-to-video")
        ? `${endpointId}/image-to-video`
        : endpointId,
    mediaType,
    input: {
      ...(endpoint?.initialInput || {}),
      ...mapInputKey(input, endpoint?.inputMap || {}),
      ...extraInput,
    },
  });

  useEffect(() => {
    generateDialogOpenRef.current = generateDialogOpen;
  }, [generateDialogOpen]);

  const handleOnGenerate = useCallback(async () => {
    if (!ensureProviderKey()) {
      return;
    }

    shouldReopenOnSuccessRef.current = generateDialogOpenRef.current;
    setTab("generation");

    createJob.mutate({} as unknown as Parameters<typeof createJob.mutate>[0], {
      onError: (error) => {
        console.warn("Failed to create job", error);
        toast({
          title: tToast("generateMediaFailed"),
          description: isRunwareProvider
            ? tToast("generateMediaFailedDescRunware")
            : tToast("generateMediaFailedDesc"),
        });
      },
    });
  }, [createJob, ensureProviderKey, isRunwareProvider, tToast, toast]);

  useEffect(() => {
    videoProjectStore.onGenerate = handleOnGenerate;
  }, [handleOnGenerate, videoProjectStore]);

  useEffect(() => {
    if (createJob.isSuccess && shouldReopenOnSuccessRef.current) {
      openGenerateDialog();
      shouldReopenOnSuccessRef.current = false;
    }
  }, [createJob.isSuccess, openGenerateDialog]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        if (enhance.isPending || createJob.isPending || event.repeat) {
          return;
        }
        event.preventDefault();
        handleOnGenerate();
      }
    },
    [handleOnGenerate, enhance, createJob],
  );

  const handleSelectMedia = async (media: MediaItem) => {
    const asset = endpoint?.inputAsset?.find((item) => {
      const assetType = getAssetType(item);

      if (
        assetType === "audio" &&
        (media.mediaType === "voiceover" || media.mediaType === "music")
      ) {
        return true;
      }
      return assetType === media.mediaType;
    });

    if (!asset) {
      setTab("generation");
      return;
    }

    if (isRunwareProvider) {
      const assetValue =
        (media.kind === "uploaded" && media.url ? media.url : null) ??
        (media.kind === "uploaded" && media.blob ? media.blob : null) ??
        resolveMediaUrl(media);

      if (!assetValue) {
        setTab("generation");
        return;
      }

      setGenerateData({ [getAssetKey(asset)]: assetValue });
      setTab("generation");
      return;
    }

    let mediaUrl = resolveMediaUrl(media);

    if (media.kind === "uploaded" && media.blob) {
      if (!media.url || !media.url.startsWith("http")) {
        try {
          const falUrl = await fal.storage.upload(media.blob);
          await db.media.update(media.id, { ...media, url: falUrl });
          mediaUrl = falUrl;
        } catch (err) {
          console.error("Failed to upload to fal.ai storage:", err);
          toast({
            title: tToast("uploadFailed"),
            description: apiKeys.fal
              ? tToast("uploadFailedDesc")
              : tToast("falKeyRequiredDesc"),
            variant: "destructive",
          });
          return;
        }
      } else {
        mediaUrl = media.url;
      }
    }

    if (!mediaUrl) {
      setTab("generation");
      return;
    }

    setGenerateData({ [getAssetKey(asset)]: mediaUrl });
    setTab("generation");
  };

  const [isUploading, setIsUploading] = useState(false);
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const oversizedFiles = fileArray.filter(
      (file) => file.size > MAX_FILE_SIZE,
    );

    if (oversizedFiles.length > 0) {
      toast({
        title: tToast("uploadFailed"),
        description: `${tToast("uploadFailedDesc")}: Files must be under 50MB`,
      });
      e.target.value = "";
      return;
    }

    setIsUploading(true);
    try {
      await handleUploadComplete(fileArray);
    } catch (err) {
      console.warn(`ERROR! ${err}`);
      toast({
        title: tToast("uploadFailed"),
        description: tToast("uploadFailedDesc"),
      });
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleUploadComplete = async (files: File[]) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mediaType = file.type.split("/")[0];
      const outputType = mediaType === "audio" ? "music" : mediaType;

      let falUrl: string | undefined;
      try {
        falUrl = await fal.storage.upload(file);
      } catch (err) {
        console.error("Failed to upload to fal.ai storage:", err);

        toast({
          title: tToast("uploadFailed"),
          description: !apiKeys.fal
            ? tToast("falKeyRequiredDesc")
            : tToast("uploadFailedDesc"),
          variant: "destructive",
        });

        continue;
      }

      const data: Omit<MediaItem, "id"> = {
        projectId,
        kind: "uploaded",
        createdAt: Date.now(),
        mediaType: outputType as MediaType,
        status: "completed",
        url: falUrl,
        blob: file,
      };

      if (falUrl) {
        setGenerateData({
          [assetKeyMap[outputType as keyof typeof assetKeyMap]]: falUrl,
        });
      }

      const mediaId = await db.media.create(data);
      const media = await db.media.find(mediaId as string);

      if (media) {
        if (media.mediaType !== "image") {
          const mediaMetadata = await getMediaMetadata(media as MediaItem);

          await db.media.update(media.id, {
            ...media,
            metadata: mediaMetadata?.media || {},
          });
        }

        queryClient.invalidateQueries({
          queryKey: queryKeys.projectMediaItems(projectId),
        });
      }
    }
  };

  const generateDisabled =
    enhance.isPending ||
    createJob.isPending ||
    !isAssetProvided ||
    isProviderKeyMissing;

  const shouldShowAssetTooltip =
    !isAssetProvided && Boolean(missingAssetLabels) && !isProviderKeyMissing;

  const generateButton = (
    <Button
      className="w-full"
      disabled={generateDisabled}
      onClick={handleOnGenerate}
    >
      {t("generate")}
    </Button>
  );

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border w-[450px] z-50 transition-all duration-300 absolute top-0 h-full bg-background",
        generateDialogOpen ? "right-0" : "-right-[450px]",
      )}
    >
      <div
        className="flex-1 p-4 flex flex-col gap-4 border-b border-border h-full overflow-hidden relative"
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-row items-center justify-between">
          <h2 className="text-sm text-muted-foreground font-semibold flex-1">
            {t("generateMedia")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleOnOpenChange(false)}
            className="flex items-center gap-2"
          >
            <XIcon className="w-6 h-6" />
          </Button>
        </div>
        <div className="w-full flex flex-col">
          <div className="flex w-full gap-2">
            <Button
              variant="ghost"
              onClick={() => handleMediaTypeChange("image")}
              className={cn(
                mediaType === "image" && "bg-white/10",
                "h-14 flex flex-col justify-center w-1/4 rounded-md gap-2 items-center",
              )}
            >
              <ImageIcon className="w-4 h-4 opacity-50" />
              <span className="text-[10px]">{t("image")}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleMediaTypeChange("video")}
              className={cn(
                mediaType === "video" && "bg-white/10",
                "h-14 flex flex-col justify-center w-1/4 rounded-md gap-2 items-center",
              )}
            >
              <VideoIcon className="w-4 h-4 opacity-50" />
              <span className="text-[10px]">{t("video")}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleMediaTypeChange("voiceover")}
              className={cn(
                mediaType === "voiceover" && "bg-white/10",
                "h-14 flex flex-col justify-center w-1/4 rounded-md gap-2 items-center",
              )}
            >
              <MicIcon className="w-4 h-4 opacity-50" />
              <span className="text-[10px]">{t("voiceover")}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleMediaTypeChange("music")}
              className={cn(
                mediaType === "music" && "bg-white/10",
                "h-14 flex flex-col justify-center w-1/4 rounded-md gap-2 items-center",
              )}
            >
              <MusicIcon className="w-4 h-4 opacity-50" />
              <span className="text-[10px]">{t("music")}</span>
            </Button>
          </div>
          <div className="flex flex-col gap-2 mt-2 justify-start font-medium text-base">
            <div className="text-muted-foreground">{t("using")}</div>
            <ModelEndpointPicker
              mediaType={mediaType}
              value={endpointId}
              onValueChange={(endpointId) => {
                resetGenerateData();
                setEndpointId(endpointId);

                const endpoint = allEndpoints.find(
                  (endpoint) => endpoint.endpointId === endpointId,
                );

                const initialInput = endpoint?.initialInput || {};
                setGenerateData({ ...initialInput });
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 relative">
          {endpoint?.inputAsset?.map((asset) => {
            const assetType = getAssetType(asset);
            const assetKey = getAssetKey(asset);
            const assetValue = generateData[assetKey];
            const hasAssetValue = isAssetValueProvided(assetValue);

            return (
              <div key={assetKey} className="flex w-full">
                <div className="flex flex-col w-full" key={assetKey}>
                  <div className="flex justify-between">
                    <h4 className="capitalize text-muted-foreground mb-2">
                      {assetType} {t("reference")}
                    </h4>
                    {tab === `asset-${assetType}` && (
                      <Button
                        variant="ghost"
                        onClick={() => setTab("generation")}
                        size="sm"
                      >
                        <ArrowLeft /> {t("back")}
                      </Button>
                    )}
                  </div>
                  {(tab === "generation" || tab !== `asset-${assetType}`) && (
                    <>
                      {!hasAssetValue && (
                        <div className="flex flex-col gap-2 justify-between">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setTab(`asset-${assetType}`);
                              setAssetMediaType(assetType ?? "all");
                            }}
                            className="cursor-pointer min-h-[30px] flex flex-col items-center justify-center border border-dashed border-border rounded-md px-4"
                          >
                            <span className="text-muted-foreground text-xs text-center text-nowrap">
                              {t("select")}
                            </span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isUploading}
                            className="cursor-pointer min-h-[30px] flex flex-col items-center justify-center border border-dashed border-border rounded-md px-4"
                            asChild
                          >
                            <label htmlFor="assetUploadButton">
                              <Input
                                id="assetUploadButton"
                                type="file"
                                className="hidden"
                                onChange={handleFileUpload}
                                multiple={false}
                                disabled={isUploading}
                                accept="image/*,audio/*,video/*"
                              />
                              {isUploading ? (
                                <LoaderCircleIcon className="w-4 h-4 opacity-50 animate-spin" />
                              ) : (
                                <span className="text-muted-foreground text-xs text-center text-nowrap">
                                  {t("upload")}
                                </span>
                              )}
                            </label>
                          </Button>
                        </div>
                      )}
                      {hasAssetValue && (
                        <div className="cursor-pointer overflow-hidden relative w-full flex flex-col items-center justify-center border border-dashed border-border rounded-md">
                          <WithTooltip tooltip={t("removeMedia")}>
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-black/50 absolute top-1 z-50 bg-black/80 right-1 group-hover:text-white"
                              onClick={() =>
                                setGenerateData({
                                  [assetKey]: undefined,
                                })
                              }
                            >
                              <TrashIcon className="w-3 h-3 stroke-2" />
                            </button>
                          </WithTooltip>
                          {hasAssetValue && (
                            <SelectedAssetPreview
                              asset={asset}
                              data={generateData}
                            />
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {tab === `asset-${assetType}` && (
                    <div className="flex items-center gap-2 flex-wrap overflow-y-auto max-h-80 divide-y divide-border">
                      {mediaItems
                        .filter((media) => {
                          if (assetMediaType === "all") return true;
                          if (
                            assetMediaType === "audio" &&
                            (media.mediaType === "voiceover" ||
                              media.mediaType === "music")
                          )
                            return true;
                          return media.mediaType === assetMediaType;
                        })
                        .map((job) => (
                          <MediaItemRow
                            draggable={false}
                            key={job.id}
                            data={job}
                            onOpen={handleSelectMedia}
                            className="cursor-pointer"
                          />
                        ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {endpoint?.prompt !== false && (
            <div className="relative bg-border rounded-lg pb-10 placeholder:text-base w-full  resize-none">
              <Textarea
                className="text-base shadow-none focus:!ring-0 placeholder:text-base w-full h-32 resize-none"
                placeholder={t("imaginePlaceholder")}
                value={generateData.prompt}
                rows={3}
                onChange={(e) => setGenerateData({ prompt: e.target.value })}
              />
              <WithTooltip tooltip="Enhance your prompt with AI-powered suggestions.">
                <div className="absolute bottom-2 right-2">
                  <Button
                    variant="secondary"
                    disabled={enhance.isPending}
                    className="bg-purple-400/10 text-purple-400 text-xs rounded-full h-6 px-3"
                    onClick={() => enhance.mutate()}
                  >
                    {enhance.isPending ? (
                      <LoadingIcon />
                    ) : (
                      <WandSparklesIcon className="opacity-50" />
                    )}
                    {t("enhancePrompt")}
                  </Button>
                </div>
              </WithTooltip>
            </div>
          )}
        </div>
        {tab === "generation" && (
          <div className="flex flex-col gap-2 mb-2">
            {endpoint?.imageForFrame && (
              <VideoFrameSelector
                mediaItems={mediaItems}
                onChange={(
                  images: {
                    start_frame_num: number;
                    image_url: string | File;
                  }[],
                ) => setGenerateData({ images })}
              />
            )}
            {endpoint?.cameraControl && (
              <CameraMovement
                value={generateData.advanced_camera_control}
                onChange={(val) =>
                  setGenerateData({
                    advanced_camera_control: val
                      ? {
                          movement_value: val.value,
                          movement_type: val.movement,
                        }
                      : undefined,
                  })
                }
              />
            )}
            {mediaType === "music" && (
              <div className="flex-1 flex flex-row gap-2">
                <div className="flex flex-row items-center gap-1">
                  <Label>{t("duration")}</Label>
                  <Input
                    className="w-12 text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    min={5}
                    max={30}
                    step={1}
                    type="number"
                    value={generateData.duration}
                    onChange={(e) =>
                      setGenerateData({
                        duration: Number.parseInt(e.target.value),
                      })
                    }
                  />
                  <span>s</span>
                </div>
                {endpointId === "fal-ai/playht/tts/v3" && (
                  <VoiceSelector
                    value={generateData.voice}
                    onValueChange={(voice) => {
                      setGenerateData({ voice });
                    }}
                  />
                )}
              </div>
            )}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="advanced" className="border-none">
                <AccordionTrigger className="text-xs text-muted-foreground py-2">
                  Advanced Settings
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-3">
                    {(mediaType === "image" || mediaType === "video") && (
                      <>
                        {mediaType === "image" && (
                          <div className="flex flex-col gap-2">
                            <Label className="text-xs">Aspect Ratio</Label>
                            <Select
                              value={generateData.aspect_ratio || "16:9"}
                              onValueChange={(value) =>
                                setGenerateData({ aspect_ratio: value })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1:1">
                                  1:1 (Square)
                                </SelectItem>
                                <SelectItem value="16:9">
                                  16:9 (Landscape)
                                </SelectItem>
                                <SelectItem value="9:16">
                                  9:16 (Portrait)
                                </SelectItem>
                                <SelectItem value="4:3">4:3</SelectItem>
                                <SelectItem value="3:4">3:4</SelectItem>
                                <SelectItem value="21:9">
                                  21:9 (Ultrawide)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <div className="flex flex-col gap-2 flex-1">
                            <Label className="text-xs">Width</Label>
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              min={256}
                              max={2048}
                              step={64}
                              value={
                                generateData.width ||
                                (mediaType === "image" ? 1024 : 1920)
                              }
                              onChange={(e) =>
                                setGenerateData({
                                  width: Number.parseInt(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-2 flex-1">
                            <Label className="text-xs">Height</Label>
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              min={256}
                              max={2048}
                              step={64}
                              value={
                                generateData.height ||
                                (mediaType === "image" ? 1024 : 1080)
                              }
                              onChange={(e) =>
                                setGenerateData({
                                  height: Number.parseInt(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                        {mediaType === "image" && (
                          <>
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">Steps</Label>
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                value={generateData.steps || 28}
                                onChange={(e) =>
                                  setGenerateData({
                                    steps: Number.parseInt(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">CFG Scale</Label>
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                min={1}
                                max={20}
                                step={0.5}
                                value={generateData.CFGScale || 3.5}
                                onChange={(e) =>
                                  setGenerateData({
                                    CFGScale: Number.parseFloat(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">Seed</Label>
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                placeholder="Random"
                                value={generateData.seed || ""}
                                onChange={(e) =>
                                  setGenerateData({
                                    seed: e.target.value
                                      ? Number.parseInt(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                        {mediaType === "video" && (
                          <>
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">
                                Duration (seconds)
                              </Label>
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                min={1}
                                max={30}
                                step={1}
                                value={generateData.duration || 5}
                                onChange={(e) =>
                                  setGenerateData({
                                    duration: Number.parseInt(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">FPS</Label>
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                min={12}
                                max={60}
                                step={1}
                                value={generateData.fps || 24}
                                onChange={(e) =>
                                  setGenerateData({
                                    fps: Number.parseInt(e.target.value),
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {(mediaType === "music" || mediaType === "voiceover") && (
                      <div className="flex flex-col gap-2">
                        <Label className="text-xs">Duration (seconds)</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={1}
                          max={60}
                          step={1}
                          value={generateData.duration || 30}
                          onChange={(e) =>
                            setGenerateData({
                              duration: Number.parseInt(e.target.value),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="flex flex-col gap-2">
              {!isAssetProvided && missingAssetLabels && (
                <div className="text-xs text-muted-foreground text-center">
                  {t("thisModelRequiresAsset", { assets: missingAssetLabels })}
                </div>
              )}
              {isProviderKeyMissing && (
                <div className="text-xs text-destructive text-center">
                  {isFalProvider
                    ? tToast("falKeyRequiredDesc")
                    : tToast("runwareKeyRequiredDesc")}
                </div>
              )}
              {shouldShowAssetTooltip ? (
                <WithTooltip
                  tooltip={t("missingAssetsTooltip", {
                    assets: missingAssetLabels,
                  })}
                >
                  {generateButton}
                </WithTooltip>
              ) : (
                generateButton
              )}
            </div>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background to-transparent via-background via-60% h-8 pointer-events-none" />
      </div>
    </div>
  );
}

const SelectedAssetPreview = ({
  data,
  asset,
}: {
  data: GenerateData;
  asset: InputAsset;
}) => {
  const assetType = getAssetType(asset);
  const assetKey = getAssetKey(asset);

  if (!data[assetKey]) return null;

  return (
    <>
      {assetType === "audio" && (
        <audio
          src={
            data[assetKey] && typeof data[assetKey] !== "string"
              ? URL.createObjectURL(data[assetKey])
              : data[assetKey] || ""
          }
          controls={true}
        >
          <track kind="captions" />
        </audio>
      )}
      {assetType === "video" && (
        <video
          src={
            data[assetKey] && typeof data[assetKey] !== "string"
              ? URL.createObjectURL(data[assetKey])
              : data[assetKey] || ""
          }
          controls={false}
          style={{ pointerEvents: "none" }}
        >
          <track kind="captions" />
        </video>
      )}
      {assetType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          id="image-preview"
          src={
            data[assetKey] && typeof data[assetKey] !== "string"
              ? URL.createObjectURL(data[assetKey])
              : data[assetKey] || ""
          }
          alt="Media Preview"
        />
      )}
    </>
  );
};
