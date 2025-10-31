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
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

import { db } from "@/data/db";
import { useToast } from "@/hooks/use-toast";
import { calculateModelCost, fal, formatCost, getPricingInfo } from "@/lib/fal";
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

  if (endpointId.startsWith("fal-ai/")) return "fal";
  if (endpointId.includes(":") && endpointId.includes("@")) return "runware";

  return undefined;
};

// Helper function to determine model subcategory
const getModelSubcategory = (
  endpoint: (typeof ALL_ENDPOINTS)[number],
): string => {
  const { category, inputAsset } = endpoint;

  if (category === "image") {
    if (inputAsset && inputAsset.length > 0) {
      return "image-to-image";
    }
    return "text-to-image";
  }

  if (category === "video") {
    if (inputAsset && inputAsset.length > 0) {
      return "image-to-video";
    }
    return "text-to-video";
  }

  return category; // music, voiceover
};

const subcategoryLabels: Record<string, string> = {
  "text-to-image": "Text to Image",
  "image-to-image": "Image to Image",
  "text-to-video": "Text to Video",
  "image-to-video": "Image to Video",
  music: "Music",
  voiceover: "Voiceover",
};

type ModelEndpointPickerProps = {
  mediaType: string;
  value?: string;
  onValueChange: (value: string) => void;
};

function ModelEndpointPicker({
  mediaType,
  value,
  onValueChange,
}: ModelEndpointPickerProps) {
  const [open, setOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState<
    "all" | "fal" | "runware"
  >("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const allEndpoints = useMemo(
    () => [...AVAILABLE_ENDPOINTS, ...RUNWARE_ENDPOINTS],
    [],
  );

  const endpoints = useMemo(() => {
    const filtered = allEndpoints
      .filter((endpoint) => {
        if (endpoint.category !== mediaType) return false;
        if (providerFilter !== "all" && endpoint.provider !== providerFilter)
          return false;
        if (typeFilter !== "all") {
          const subcat = getModelSubcategory(endpoint);
          if (subcat !== typeFilter) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // First, group by subcategory
        const subcatA = getModelSubcategory(a);
        const subcatB = getModelSubcategory(b);

        if (subcatA !== subcatB) {
          return subcatA.localeCompare(subcatB);
        }

        // Within same subcategory, sort alphabetically by label
        return a.label.localeCompare(b.label);
      });

    return filtered;
  }, [allEndpoints, mediaType, providerFilter, typeFilter]);

  // Group endpoints by subcategory for rendering with headers
  const groupedEndpoints = useMemo(() => {
    const groups: Record<string, typeof endpoints> = {};

    for (const endpoint of endpoints) {
      const subcat = getModelSubcategory(endpoint);
      if (!groups[subcat]) {
        groups[subcat] = [];
      }
      groups[subcat].push(endpoint);
    }

    return groups;
  }, [endpoints]);

  // Get available subcategories for current media type
  const availableSubcategories = useMemo(() => {
    const subcats = new Set<string>();
    for (const endpoint of allEndpoints) {
      if (endpoint.category === mediaType) {
        subcats.add(getModelSubcategory(endpoint));
      }
    }
    return Array.from(subcats).sort();
  }, [allEndpoints, mediaType]);

  const selectedEndpoint = allEndpoints.find((e) => e.endpointId === value);

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

      {/* Type filter chips */}
      {availableSubcategories.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <Button
            variant={typeFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTypeFilter("all")}
          >
            All Types
          </Button>
          {availableSubcategories.map((subcat) => (
            <Button
              key={subcat}
              variant={typeFilter === subcat ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTypeFilter(subcat)}
            >
              {subcategoryLabels[subcat] || subcat}
            </Button>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between text-base font-semibold"
          >
            <span className="truncate">
              {selectedEndpoint?.label || "Select model..."}
            </span>
            <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[450px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models..." className="h-9" />
            <CommandList>
              <CommandEmpty>No model found</CommandEmpty>
              {Object.entries(groupedEndpoints).map(
                ([subcategory, subcategoryEndpoints]) => (
                  <CommandGroup
                    key={subcategory}
                    heading={subcategoryLabels[subcategory] || subcategory}
                  >
                    {subcategoryEndpoints.map((endpoint) => {
                      let displayCost: string | null = null;

                      if (endpoint.provider === "fal") {
                        // Calculate estimated cost with default parameters for FAL models
                        const estimatedCost = calculateModelCost(
                          endpoint.endpointId,
                          {
                            duration: endpoint.defaultDuration || 5,
                            width: endpoint.defaultWidth || 1024,
                            height: endpoint.defaultHeight || 1024,
                            textLength: 100,
                            quantity: 1,
                          },
                        );

                        if (estimatedCost !== null) {
                          displayCost = formatCost(estimatedCost);
                        } else if (endpoint.cost) {
                          displayCost = endpoint.cost;
                        }
                      }

                      return (
                        <CommandItem
                          key={endpoint.endpointId}
                          value={`${endpoint.label} ${endpoint.provider} ${endpoint.endpointId}`}
                          onSelect={() => {
                            onValueChange(endpoint.endpointId);
                            setOpen(false);
                          }}
                        >
                          <div className="flex flex-row gap-2 items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{endpoint.label}</span>
                              <Badge variant="outline" className="text-xs">
                                {endpoint.provider}
                              </Badge>
                            </div>
                            {displayCost && (
                              <span className="text-xs text-muted-foreground ml-2">
                                ~{displayCost}
                              </span>
                            )}
                          </div>
                          <CheckIcon
                            className={cn(
                              "ml-auto h-4 w-4",
                              value === endpoint.endpointId
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ),
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
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

    // Add defaults for video models from endpoint configuration
    const dataWithDefaults: any = { ...initialInput };
    if (mediaType === "video" && endpoint) {
      if (endpoint.defaultDuration !== undefined) {
        dataWithDefaults.duration = endpoint.defaultDuration;
      }
      if (endpoint.defaultFps !== undefined) {
        dataWithDefaults.fps = endpoint.defaultFps;
      }
      if (endpoint.defaultWidth !== undefined) {
        dataWithDefaults.width = endpoint.defaultWidth;
      }
      if (endpoint.defaultHeight !== undefined) {
        dataWithDefaults.height = endpoint.defaultHeight;
      }
    }

    if (
      (mediaType === "video" &&
        endpoint?.endpointId === "fal-ai/hunyuan-video") ||
      mediaType !== "video"
    ) {
      setGenerateData({ image: null, ...dataWithDefaults });
    } else {
      setGenerateData({ ...dataWithDefaults });
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
    "9:16": { image: "portrait_9_16", video: "9:16" },
    "1:1": { image: "square", video: "1:1" },
  };

  const isFal = provider === "fal";
  const isRunware = provider === "runware";
  const isImage = endpoint?.category === "image";
  const isVideo = endpoint?.category === "video";

  const selectedDim = endpoint?.availableDimensions?.find(
    (d) => d.width === generateData.width && d.height === generateData.height,
  );

  let dimensionsInput: {
    image_size?: string;
    width?: number;
    height?: number;
    aspect_ratio?: string;
  } = {};

  if (isFal && isImage && selectedDim?.preset) {
    dimensionsInput = { image_size: selectedDim.preset };
  } else if (
    isRunware &&
    isImage &&
    generateData.width &&
    generateData.height
  ) {
    dimensionsInput = {
      width: generateData.width,
      height: generateData.height,
    };
  } else if (isVideo && project?.aspectRatio) {
    dimensionsInput = {
      aspect_ratio: aspectRatioMap[project.aspectRatio]?.video,
    };
  } else if (project?.aspectRatio && !selectedDim) {
    dimensionsInput = {
      image_size: aspectRatioMap[project.aspectRatio]?.image,
    };
  }

  const input: InputType = {
    prompt: generateData.prompt,
    image_url: undefined,
    seconds_total: !isImage ? (generateData.duration ?? undefined) : undefined,
    voice:
      endpointId === "fal-ai/playht/tts/v3" ? generateData.voice : undefined,
    input:
      endpointId === "fal-ai/playht/tts/v3" ? generateData.prompt : undefined,
    ...dimensionsInput,
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
      const assetKey = getAssetKey(asset);
      let assetValue: string | Blob | File | null = null;

      try {
        if (media.kind === "uploaded") {
          if (media.blob) {
            assetValue = media.blob;
          } else if (media.url?.startsWith("blob:")) {
            const response = await fetch(media.url);
            if (!response.ok) {
              throw new Error(
                `Failed to read blob URL (${response.status} ${response.statusText})`,
              );
            }
            assetValue = await response.blob();
          } else if (media.url) {
            assetValue = media.url;
          }
        }

        if (!assetValue) {
          const resolvedUrl = resolveMediaUrl(media);

          if (resolvedUrl?.startsWith("blob:")) {
            const response = await fetch(resolvedUrl);
            if (!response.ok) {
              throw new Error(
                `Failed to read blob URL (${response.status} ${response.statusText})`,
              );
            }
            assetValue = await response.blob();
          } else {
            assetValue = resolvedUrl ?? null;
          }
        }
      } catch (error) {
        console.error("Failed to normalize Runware media asset", error);
        toast({
          title: tToast("uploadFailed"),
          description: tToast("runwareKeyRequiredDesc"),
          variant: "destructive",
        });
        setTab("generation");
        return;
      }

      if (!assetValue) {
        setTab("generation");
        return;
      }

      setGenerateData({ [assetKey]: assetValue });
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

  // Calculate estimated cost for FAL models
  const estimatedCost = useMemo(() => {
    if (!endpointId || !isFalEndpoint(endpointId)) return null;

    return calculateModelCost(endpointId, {
      duration: generateData.duration,
      width: generateData.width,
      height: generateData.height,
      textLength: generateData.prompt?.length || 0,
      quantity: 1,
    });
  }, [
    endpointId,
    generateData.duration,
    generateData.width,
    generateData.height,
    generateData.prompt,
  ]);

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

                // Add defaults for video models from endpoint configuration
                const dataWithDefaults: any = { ...initialInput };
                if (mediaType === "video" && endpoint) {
                  if (endpoint.defaultDuration !== undefined) {
                    dataWithDefaults.duration = endpoint.defaultDuration;
                  }
                  if (endpoint.defaultFps !== undefined) {
                    dataWithDefaults.fps = endpoint.defaultFps;
                  }
                  if (endpoint.defaultWidth !== undefined) {
                    dataWithDefaults.width = endpoint.defaultWidth;
                  }
                  if (endpoint.defaultHeight !== undefined) {
                    dataWithDefaults.height = endpoint.defaultHeight;
                  }
                }

                setGenerateData(dataWithDefaults);
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
          {/* Optional image field for models without required inputAsset but with inputMap support */}
          {(!endpoint?.inputAsset || endpoint.inputAsset.length === 0) &&
            endpoint?.inputMap &&
            (endpoint.inputMap.image ||
              endpoint.inputMap.seedImage ||
              endpoint.inputMap.image_url) && (
              <div className="flex w-full">
                <div className="flex flex-col w-full">
                  <div className="flex justify-between">
                    <h4 className="capitalize text-muted-foreground mb-2">
                      {t("image")} ({t("optional").toLowerCase()})
                    </h4>
                    {tab === "asset-image" && (
                      <Button
                        variant="ghost"
                        onClick={() => setTab("generation")}
                        size="sm"
                      >
                        <ArrowLeft /> {t("back")}
                      </Button>
                    )}
                  </div>
                  {(tab === "generation" || tab !== "asset-image") && (
                    <>
                      {!generateData.seedImage && (
                        <div className="flex flex-col gap-2 justify-between">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setTab("asset-image");
                              setAssetMediaType("image");
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
                            <label htmlFor="optionalImageUploadButton">
                              <Input
                                id="optionalImageUploadButton"
                                type="file"
                                className="hidden"
                                onChange={handleFileUpload}
                                multiple={false}
                                disabled={isUploading}
                                accept="image/*"
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
                      {generateData.seedImage && (
                        <div className="cursor-pointer overflow-hidden relative w-full flex flex-col items-center justify-center border border-dashed border-border rounded-md">
                          <WithTooltip tooltip={t("removeMedia")}>
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-black/50 absolute top-1 z-50 bg-black/80 right-1 group-hover:text-white"
                              onClick={() =>
                                setGenerateData({
                                  seedImage: undefined,
                                })
                              }
                            >
                              <TrashIcon className="w-3 h-3 stroke-2" />
                            </button>
                          </WithTooltip>
                          {generateData.seedImage && (
                            <SelectedAssetPreview
                              asset={{
                                type: "image",
                                key: "seedImage",
                              }}
                              data={generateData}
                            />
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {tab === "asset-image" && (
                    <div className="flex items-center gap-2 flex-wrap overflow-y-auto max-h-80 divide-y divide-border">
                      {mediaItems
                        .filter((media) => media.mediaType === "image")
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
            )}
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
                        {/* Show Aspect Ratio selector only if model doesn't have availableDimensions */}
                        {mediaType === "image" &&
                          !endpoint?.availableDimensions && (
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs">Aspect Ratio</Label>
                              <Select
                                value={generateData.aspect_ratio || "16:9"}
                                onValueChange={(value) => {
                                  // Update aspect ratio and calculate corresponding dimensions
                                  const dimensionsMap: Record<
                                    string,
                                    { width: number; height: number }
                                  > = {
                                    "1:1": { width: 1024, height: 1024 },
                                    "16:9": { width: 1024, height: 576 },
                                    "9:16": { width: 576, height: 1024 },
                                    "4:3": { width: 1024, height: 768 },
                                    "3:4": { width: 768, height: 1024 },
                                    "21:9": { width: 1344, height: 576 }, // Must be multiples of 64 for Runware
                                  };
                                  const dimensions = dimensionsMap[value];
                                  setGenerateData({
                                    aspect_ratio: value,
                                    ...(dimensions && {
                                      width: dimensions.width,
                                      height: dimensions.height,
                                    }),
                                  });
                                }}
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
                        {endpoint?.availableDimensions &&
                        endpoint.availableDimensions.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            <Label className="text-xs">Size</Label>
                            <Select
                              value={`${generateData.width || endpoint.defaultWidth || endpoint.availableDimensions[0].width}x${generateData.height || endpoint.defaultHeight || endpoint.availableDimensions[0].height}`}
                              onValueChange={(value) => {
                                const [width, height] = value
                                  .split("x")
                                  .map(Number);
                                setGenerateData({ width, height });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {endpoint.availableDimensions.map((dim) => (
                                  <SelectItem
                                    key={`${dim.width}x${dim.height}`}
                                    value={`${dim.width}x${dim.height}`}
                                  >
                                    {dim.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
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
                                  endpoint?.defaultWidth ||
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
                                  endpoint?.defaultHeight ||
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
                        )}
                        {mediaType === "image" && (
                          <>
                            {/* Show Steps only if model has steps parameters */}
                            {(endpoint?.minSteps !== undefined ||
                              endpoint?.maxSteps !== undefined ||
                              endpoint?.defaultSteps !== undefined ||
                              endpoint?.availableSteps !== undefined) && (
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">Steps</Label>
                                <Input
                                  className="h-8 text-xs"
                                  type="number"
                                  min={endpoint?.minSteps || 1}
                                  max={endpoint?.maxSteps || 100}
                                  step={1}
                                  value={
                                    generateData.steps ||
                                    endpoint?.defaultSteps ||
                                    28
                                  }
                                  onChange={(e) =>
                                    setGenerateData({
                                      steps: Number.parseInt(e.target.value),
                                    })
                                  }
                                />
                              </div>
                            )}
                            {/* Show CFG Scale only if model has guidance parameters */}
                            {(endpoint?.minGuidanceScale !== undefined ||
                              endpoint?.maxGuidanceScale !== undefined ||
                              endpoint?.defaultGuidanceScale !== undefined) && (
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">CFG Scale</Label>
                                <Input
                                  className="h-8 text-xs"
                                  type="number"
                                  min={endpoint?.minGuidanceScale || 1}
                                  max={endpoint?.maxGuidanceScale || 20}
                                  step={0.5}
                                  value={
                                    generateData.CFGScale ||
                                    endpoint?.defaultGuidanceScale ||
                                    3.5
                                  }
                                  onChange={(e) =>
                                    setGenerateData({
                                      CFGScale: Number.parseFloat(
                                        e.target.value,
                                      ),
                                    })
                                  }
                                />
                              </div>
                            )}
                            {/* Show Seed only if model has seed parameter */}
                            {endpoint?.hasSeed && (
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
                            )}
                          </>
                        )}
                        {mediaType === "video" && (
                          <>
                            {/* Show Duration only if model has duration parameters */}
                            {(endpoint?.availableDurations ||
                              endpoint?.defaultDuration !== undefined) && (
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">
                                  Duration (seconds)
                                </Label>
                                {endpoint?.availableDurations &&
                                endpoint.availableDurations.length > 0 ? (
                                  <Select
                                    value={String(
                                      generateData.duration ||
                                        endpoint.defaultDuration ||
                                        endpoint.availableDurations[0],
                                    )}
                                    onValueChange={(value) =>
                                      setGenerateData({
                                        duration: Number.parseInt(value),
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {endpoint.availableDurations.map(
                                        (dur) => (
                                          <SelectItem
                                            key={dur}
                                            value={String(dur)}
                                          >
                                            {dur}s
                                          </SelectItem>
                                        ),
                                      )}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    className="h-8 text-xs"
                                    type="number"
                                    min={1}
                                    max={30}
                                    step={1}
                                    value={
                                      generateData.duration ||
                                      endpoint?.defaultDuration ||
                                      5
                                    }
                                    onChange={(e) =>
                                      setGenerateData({
                                        duration: Number.parseInt(
                                          e.target.value,
                                        ),
                                      })
                                    }
                                  />
                                )}
                              </div>
                            )}
                            {/* Show FPS only if model has fps parameters */}
                            {(endpoint?.availableFps ||
                              endpoint?.defaultFps !== undefined) && (
                              <div className="flex flex-col gap-2">
                                <Label className="text-xs">FPS</Label>
                                {endpoint?.availableFps &&
                                endpoint.availableFps.length > 0 ? (
                                  <Select
                                    value={String(
                                      generateData.fps ||
                                        endpoint.defaultFps ||
                                        endpoint.availableFps[0],
                                    )}
                                    onValueChange={(value) =>
                                      setGenerateData({
                                        fps: Number.parseInt(value),
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {endpoint.availableFps.map((fps) => (
                                        <SelectItem
                                          key={fps}
                                          value={String(fps)}
                                        >
                                          {fps} FPS
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    className="h-8 text-xs"
                                    type="number"
                                    min={12}
                                    max={60}
                                    step={1}
                                    value={
                                      generateData.fps ||
                                      endpoint?.defaultFps ||
                                      24
                                    }
                                    onChange={(e) =>
                                      setGenerateData({
                                        fps: Number.parseInt(e.target.value),
                                      })
                                    }
                                  />
                                )}
                              </div>
                            )}
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
              {/* Estimated cost display for FAL models */}
              {estimatedCost !== null && isFalEndpoint(endpointId) && (
                <>
                  <div className="flex items-center justify-between px-3 py-2 bg-accent/30 rounded-md border border-accent">
                    <span className="text-xs text-muted-foreground">
                      Estimated cost:
                    </span>
                    <span className="text-sm font-semibold">
                      {formatCost(estimatedCost)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground/70 text-center px-2">
                    FAL pricing is estimated and may vary based on actual usage
                  </div>
                </>
              )}
              {/* Info message for Runware pricing */}
              {isRunwareEndpoint(endpointId) && (
                <div className="text-xs text-muted-foreground text-center px-2">
                  Runware pricing will be shown after generation
                </div>
              )}
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
