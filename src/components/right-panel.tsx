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
import { useCallback } from "react";
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
import { MediaItemRow } from "./media-panel";
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
import { useEffect, useMemo, useState } from "react";
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

  const handleOnOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      closeGenerateDialog();
      resetGenerateData();
      return;
    }
    onOpenChange?.(isOpen);
    openGenerateDialog();
  };

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
    image_url?: File | string | null;
    video_url?: File | string | null;
    audio_url?: File | string | null;
    image_size?: { width: number; height: number } | string;
    aspect_ratio?: string;
    seconds_total?: number;
    voice?: string;
    input?: string;
    reference_audio_url?: File | string | null;
    images?: {
      start_frame_num: number;
      image_url: string | File;
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

  if (generateData.image) {
    input.image_url = generateData.image;
  }
  if (generateData.video_url) {
    input.video_url = generateData.video_url;
  }
  if (generateData.audio_url) {
    input.audio_url = generateData.audio_url;
  }
  if (generateData.reference_audio_url) {
    input.reference_audio_url = generateData.reference_audio_url;
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
      generateData.image && mediaType === "video"
        ? `${endpointId}/image-to-video`
        : endpointId,
    mediaType,
    input: {
      ...(endpoint?.initialInput || {}),
      ...mapInputKey(input, endpoint?.inputMap || {}),
      ...extraInput,
    },
  });

  const handleOnGenerate = useCallback(async () => {
    await createJob.mutateAsync(
      {} as Parameters<typeof createJob.mutateAsync>[0],
      {
        onSuccess: async () => {
          if (!createJob.isError) {
            handleOnOpenChange(false);
          }
        },
        onError: (error) => {
          console.warn("Failed to create job", error);
          toast({
            title: tToast("generateMediaFailed"),
            description: tToast("generateMediaFailedDesc"),
          });
        },
      },
    );
  }, [createJob, handleOnOpenChange, toast, tToast]);

  useEffect(() => {
    videoProjectStore.onGenerate = handleOnGenerate;
  }, [handleOnGenerate, videoProjectStore]);

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
            title: "Upload Failed",
            description:
              "Please check that your FAL API key is set correctly in Settings (click the gear icon)",
            variant: "destructive",
          });
          return;
        }
      } else {
        mediaUrl = media.url;
      }
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

        const falKey = localStorage.getItem("falKey");
        const isAuthError = !falKey;

        toast({
          title: tToast("uploadFailed"),
          description: isAuthError
            ? "Please set your FAL API key in Settings to use uploaded files with AI generation"
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
          ...generateData,
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

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border w-[450px] z-50 transition-all duration-300 absolute top-0 h-full bg-background",
        generateDialogOpen ? "right-0" : "-right-[450px]",
      )}
    >
      <div className="flex-1 p-4 flex flex-col gap-4 border-b border-border h-full overflow-hidden relative">
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
          {endpoint?.inputAsset?.map((asset, index) => (
            <div key={getAssetType(asset)} className="flex w-full">
              <div className="flex flex-col w-full" key={getAssetType(asset)}>
                <div className="flex justify-between">
                  <h4 className="capitalize text-muted-foreground mb-2">
                    {getAssetType(asset)} {t("reference")}
                  </h4>
                  {tab === `asset-${getAssetType(asset)}` && (
                    <Button
                      variant="ghost"
                      onClick={() => setTab("generation")}
                      size="sm"
                    >
                      <ArrowLeft /> {t("back")}
                    </Button>
                  )}
                </div>
                {(tab === "generation" ||
                  tab !== `asset-${getAssetType(asset)}`) && (
                  <>
                    {!generateData[getAssetKey(asset)] && (
                      <div className="flex flex-col gap-2 justify-between">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setTab(`asset-${getAssetType(asset)}`);
                            setAssetMediaType(getAssetType(asset) ?? "all");
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
                    {generateData[getAssetKey(asset)] && (
                      <div className="cursor-pointer overflow-hidden relative w-full flex flex-col items-center justify-center border border-dashed border-border rounded-md">
                        <WithTooltip tooltip={t("removeMedia")}>
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-black/50 absolute top-1 z-50 bg-black/80 right-1 group-hover:text-white"
                            onClick={() =>
                              setGenerateData({
                                [getAssetKey(asset)]: undefined,
                              })
                            }
                          >
                            <TrashIcon className="w-3 h-3 stroke-2" />
                          </button>
                        </WithTooltip>
                        {generateData[getAssetKey(asset)] && (
                          <SelectedAssetPreview
                            asset={asset}
                            data={generateData}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
                {tab === `asset-${getAssetType(asset)}` && (
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
          ))}
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
            <div className="flex flex-row gap-2">
              <Button
                className="w-full"
                disabled={enhance.isPending || createJob.isPending}
                onClick={handleOnGenerate}
              >
                {t("generate")}
              </Button>
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
