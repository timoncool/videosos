//! Generation on this computer: pictures and videos made by stable-diffusion.cpp (`vs-diffusion`), as a provider
//! beside the cloud ones. The engine is one of its release builds for the device (CUDA, Vulkan or CPU) and the
//! models are quantized GGUF files; both are downloaded when the person asks, pinned by address, size and SHA-256
//! like the link tool (`tools.rs`), and resumed when a download was cut. One model is loaded at a time and stays
//! loaded for the next run until another model or another device is asked for.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use vs_diffusion::{Canceller, Context, Engine, ImageParams, Lora, ModelConfig, RawImage, Sampler, Upscale, VideoParams};
use vs_providers::model::{Choice, Field, FieldKind, MediaKind, ModelEntry, ModelForm, Output, PriceRule, Provider, Rate, Role, Task};

/// One file to download, relative to the data folder.
struct Download {
    url: &'static str,
    dest: &'static str,
    size: u64,
    sha256: &'static str,
    /// A zip whose files go flat into this folder, then the zip is removed.
    unzip_into: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Device {
    Cuda,
    Vulkan,
    Cpu,
}

impl Device {
    const ALL: [Device; 3] = [Device::Cuda, Device::Vulkan, Device::Cpu];

    fn as_str(self) -> &'static str {
        match self {
            Device::Cuda => "cuda",
            Device::Vulkan => "vulkan",
            Device::Cpu => "cpu",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|device| device.as_str() == value)
    }
}

/// A release build of the engine for one device.
struct Build {
    device: Device,
    folder: &'static str,
    files: &'static [Download],
    /// Files that are there once it is unpacked.
    markers: &'static [&'static str],
}

#[cfg(windows)]
const BUILDS: &[Build] = &[
    Build {
        device: Device::Cuda,
        folder: "tools/sd/cuda12",
        files: &[
            Download { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-cuda12-x64.zip", dest: "tools/sd/_cuda12.zip", size: 338_016_915, sha256: "2f08572e143f0b15a764197ea937d219dd70f0cc7eefb30eb84c9dae6a7cba6d", unzip_into: Some("tools/sd/cuda12") },
            Download { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/cudart-sd-bin-win-cu12-x64.zip", dest: "tools/sd/_cudart12.zip", size: 563_452_046, sha256: "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d", unzip_into: Some("tools/sd/cuda12") },
        ],
        markers: &["tools/sd/cuda12/stable-diffusion.dll", "tools/sd/cuda12/ggml-cuda.dll", "tools/sd/cuda12/cudart64_12.dll"],
    },
    Build {
        device: Device::Vulkan,
        folder: "tools/sd/vulkan",
        files: &[Download { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-vulkan-x64.zip", dest: "tools/sd/_vulkan.zip", size: 30_155_040, sha256: "74211cb5c382aec2aeb086b64f2fdf525efec5faec4200a2d3257bc2328954ab", unzip_into: Some("tools/sd/vulkan") }],
        markers: &["tools/sd/vulkan/stable-diffusion.dll", "tools/sd/vulkan/ggml-vulkan.dll"],
    },
    Build {
        device: Device::Cpu,
        folder: "tools/sd/cpu",
        files: &[Download { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/sd-master-1d0a58a-bin-win-cpu-x64.zip", dest: "tools/sd/_cpu.zip", size: 17_574_585, sha256: "8e4e7bde781ff246817019a182040a087314caf4d21bc15fe4ff045167bd336d", unzip_into: Some("tools/sd/cpu") }],
        markers: &["tools/sd/cpu/stable-diffusion.dll"],
    },
];

#[cfg(not(windows))]
const BUILDS: &[Build] = &[];

/// The part of a model a file is.
#[derive(Clone, Copy, PartialEq)]
enum Slot {
    Diffusion,
    Llm,
    Vae,
    AudioVae,
    /// An adapter laid over the diffusion weights at generation time.
    Lora,
    /// A model that upscales latents between two passes.
    Upscaler,
}

struct ModelFile {
    slot: Slot,
    download: Download,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image,
    Video,
}

struct LocalModel {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    kind: Kind,
    files: &'static [ModelFile],
    /// Ways to sample the model, the default first; their files are downloaded with the model's own.
    presets: &'static [Preset],
    sizes: &'static [(u32, u32)],
    rng_cpu: bool,
    /// Seconds a video can last, frames at `fps` rounded up to the model's grid of `frame_step * k + frame_offset`.
    seconds: &'static [u32],
    fps: i32,
    frame_step: i32,
    frame_offset: i32,
}

/// A speed preset: an accelerator's files and the sampling it was distilled for.
struct Preset {
    id: &'static str,
    /// The accelerator's name as its makers publish it; empty for the model's own sampling.
    name: &'static str,
    /// A LoRA laid over the diffusion weights, or other diffusion weights of the same model in place of the model's own.
    files: &'static [ModelFile],
    /// 0 keeps the engine's.
    steps: i32,
    cfg: f32,
    /// The video stream's flow shift the accelerator was trained with; 0 keeps the model's.
    flow_shift: f32,
    schedule: Schedule,
    sampler: Sampler,
    /// A second pass at twice the size over the first pass's latents, upscaled by the preset's upscaler file, on
    /// these sigmas; empty for one pass at the chosen size.
    upscale_sigmas: &'static [f32],
}

enum Schedule {
    Engine,
    /// Sigmas a distilled model was trained on, the closing 0 included.
    Fixed(&'static [f32]),
    /// An even grid shifted for the picture's token count the way Qwen-Image 2.1's scheduler does, with no terminal stretch.
    QwenShifted(&'static [f32]),
}

impl Schedule {
    fn sigmas(&self, width: u32, height: u32) -> Vec<f32> {
        match self {
            Schedule::Engine => Vec::new(),
            Schedule::Fixed(sigmas) => sigmas.to_vec(),
            Schedule::QwenShifted(grid) => {
                let tokens = f64::from((width / 16) * (height / 16));
                let slope = (0.9 - 0.5) / (8192.0 - 256.0);
                let mu = (tokens * slope + 0.5 - slope * 256.0).exp();
                grid.iter().map(|&t| (mu / (mu + (1.0 / f64::from(t) - 1.0))) as f32).chain([0.0]).collect()
            }
        }
    }
}

const QWEN_IMAGE_2_1: ModelFile = ModelFile { slot: Slot::Diffusion, download: Download { url: "https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF/resolve/2c31ccd392b367a6637841a143813320a02dff55/qwen-image-2.1-Q4_K_M.gguf", dest: "models/qwen-image-2.1/qwen-image-2.1-Q4_K_M.gguf", size: 4_199_565_024, sha256: "631d532e7ca71e8d90a87c71d3699761a812039d22e3370e87498d87754660fe", unzip_into: None } };

/// Lightricks' schedule for the distilled checkpoint, the first pass of their DistilledPipeline.
const LTX_DISTILLED_SIGMAS: &[f32] = &[1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0];

const MODELS: &[LocalModel] = &[
    LocalModel {
        id: "qwen-image-2.1",
        name: "Qwen-Image 2.1",
        description: "Alibaba's picture model of September 2026, the first among open models; with its Qwen3-VL-8B text encoder. Three accelerators: Alibaba's own Turbo, LightX2V Lightning and Viggle Turbo.",
        kind: Kind::Image,
        files: &[
            ModelFile { slot: Slot::Llm, download: Download { url: "https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/f982a07559d4a2f6c8744d840bf6fccab30eea96/Qwen3VL-8B-Instruct-Q4_K_M.gguf", dest: "models/qwen-image-2.1/Qwen3VL-8B-Instruct-Q4_K_M.gguf", size: 5_027_784_800, sha256: "67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2", unzip_into: None } },
            ModelFile { slot: Slot::Vae, download: Download { url: "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/a8342359c61979b06a8dafb1a47991fe1f30e994/vae/qwen_image_2.1_vae_bf16.safetensors", dest: "models/qwen-image-2.1/qwen_image_2.1_vae_bf16.safetensors", size: 675_509_688, sha256: "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9", unzip_into: None } },
        ],
        presets: &[
            Preset {
                id: "turbo",
                name: "Qwen-Image 2.1 Turbo",
                files: &[ModelFile { slot: Slot::Diffusion, download: Download { url: "https://huggingface.co/unsloth/Qwen-Image-2.1-Turbo-GGUF/resolve/5d1f9f759ea877ae556cda88dbec958b62ad3809/qwen-image-2.1-turbo-Q4_K_M.gguf", dest: "models/qwen-image-2.1/qwen-image-2.1-turbo-Q4_K_M.gguf", size: 4_199_565_120, sha256: "8940e8b522af886e0c0f5afddf720e82dd223cb9a43580b5f61c4d740452ac20", unzip_into: None } }],
                steps: 8,
                cfg: 1.0,
                flow_shift: 0.0,
                schedule: Schedule::Fixed(&[1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0]),
                sampler: Sampler::Engine,
                upscale_sigmas: &[],
            },
            Preset {
                id: "lightning",
                name: "LightX2V Lightning",
                files: &[
                    QWEN_IMAGE_2_1,
                    ModelFile { slot: Slot::Lora, download: Download { url: "https://huggingface.co/lightx2v/Qwen-Image-2.1-Lightning/resolve/6b0a1176327c01522a44276c5da67331a025b6fc/pytorch_lora_weights.safetensors", dest: "models/qwen-image-2.1/loras/qwen-image-2.1-lightning-4step.safetensors", size: 67_144_280, sha256: "53c69320d4163da51032f90275074028cb098556039c72b45f8dce9f0f9e34a3", unzip_into: None } },
                ],
                steps: 4,
                cfg: 1.0,
                flow_shift: 0.0,
                schedule: Schedule::QwenShifted(&[1.0, 0.75, 0.5, 0.25]),
                sampler: Sampler::Engine,
                upscale_sigmas: &[],
            },
            Preset {
                id: "viggle",
                name: "Viggle Turbo v0.3",
                files: &[
                    QWEN_IMAGE_2_1,
                    ModelFile { slot: Slot::Lora, download: Download { url: "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/009a44a895ef85f7e643c80fdca9543795248867/Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors", dest: "models/qwen-image-2.1/loras/qwen-image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors", size: 1_359_147_904, sha256: "f06c266e04438b5272bdfb99410421d52a65d7a37f6f42aabc3cb1faf0142644", unzip_into: None } },
                ],
                steps: 6,
                cfg: 1.0,
                flow_shift: 0.0,
                schedule: Schedule::QwenShifted(&[1.0, 0.9375, 0.875, 0.75, 0.5, 0.25]),
                sampler: Sampler::Engine,
                upscale_sigmas: &[],
            },
        ],
        sizes: &[(1024, 1024), (1344, 768), (768, 1344), (1152, 896), (896, 1152), (1536, 640), (640, 1536)],
        rng_cpu: false,
        seconds: &[],
        fps: 0,
        frame_step: 1,
        frame_offset: 0,
    },
    LocalModel {
        id: "minimax-h3",
        name: "MiniMax-H3",
        description: "MiniMax's video model of August 2026, the strongest open one: video with its own sound, from a prompt or a first frame, at 24 fps; with its Qwen3-VL-32B text encoder. Accelerators: LightX2V Turbo in 8 and 4 steps. The weights' license excludes the US, EU, UK and South Korea.",
        kind: Kind::Video,
        files: &[
            ModelFile { slot: Slot::Diffusion, download: Download { url: "https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/minimax_h3_fl2va_pruned-Q4_K.gguf", dest: "models/minimax-h3/minimax_h3_fl2va_pruned-Q4_K.gguf", size: 11_420_663_904, sha256: "dd948e08ad0ba3c71bd42f368e283dd82e790f5122a63b276e22a3e0283d0c10", unzip_into: None } },
            ModelFile { slot: Slot::Llm, download: Download { url: "https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/qwen3vl_32b_minimax_h3-Q4_K_M.gguf", dest: "models/minimax-h3/qwen3vl_32b_minimax_h3-Q4_K_M.gguf", size: 18_218_065_024, sha256: "11e6efe70a57ce7f4838c47bdbd1a1c4b8ce10e2b7747f1b065990b70f4b05fc", unzip_into: None } },
            ModelFile { slot: Slot::Vae, download: Download { url: "https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/vae/minimax_h3_video_vae_fp16.safetensors", dest: "models/minimax-h3/minimax_h3_video_vae_fp16.safetensors", size: 5_207_808_496, sha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522", unzip_into: None } },
            ModelFile { slot: Slot::AudioVae, download: Download { url: "https://huggingface.co/unsloth/MiniMax-H3-GGUF/resolve/d629413c2e5b51b38c453668b75ca3b06ca92703/vae/minimax_h3_audio_vae_fp32.safetensors", dest: "models/minimax-h3/minimax_h3_audio_vae_fp32.safetensors", size: 605_254_808, sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48", unzip_into: None } },
        ],
        presets: &[
            Preset {
                id: "turbo-8",
                name: "LightX2V Turbo 768p",
                files: &[ModelFile { slot: Slot::Lora, download: Download { url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", dest: "models/minimax-h3/loras/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", size: 1_956_193_000, sha256: "08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980", unzip_into: None } }],
                steps: 8,
                cfg: 1.0,
                flow_shift: 6.0,
                schedule: Schedule::Engine,
                sampler: Sampler::Engine,
                upscale_sigmas: &[],
            },
            Preset {
                id: "turbo-4",
                name: "LightX2V Turbo 768p v1.2",
                files: &[ModelFile { slot: Slot::Lora, download: Download { url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors", dest: "models/minimax-h3/loras/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors", size: 1_956_193_000, sha256: "c8168ebc17bbacc4296103dda2fec1ba85b24392fa08cf2bfbcef0cff0dc3cc8", unzip_into: None } }],
                steps: 4,
                cfg: 1.0,
                flow_shift: 6.0,
                schedule: Schedule::Engine,
                sampler: Sampler::Engine,
                upscale_sigmas: &[],
            },
            Preset { id: "full", name: "", files: &[], steps: 0, cfg: 1.0, flow_shift: 0.0, schedule: Schedule::Engine, sampler: Sampler::Engine, upscale_sigmas: &[] },
        ],
        sizes: &[(864, 480), (480, 864), (1280, 704), (704, 1280), (640, 640)],
        rng_cpu: true,
        seconds: &[2, 3, 5],
        fps: 24,
        frame_step: 17,
        frame_offset: 5,
    },
    LocalModel {
        id: "ltx-2.5",
        name: "LTX-2.5",
        description: "Lightricks' video model of August 2026, distilled to 8 steps: video with its own sound, from a prompt or a first frame, at 24 fps; with Lightricks' own INT8 Gemma-4-12B text encoder. Sampled as Lightricks' DistilledPipeline: half the size first, then their ×2 latent upscaler and three refining steps.",
        kind: Kind::Video,
        files: &[
            ModelFile { slot: Slot::Diffusion, download: Download { url: "https://huggingface.co/unsloth/LTX-2.5-GGUF/resolve/6eae90030f7f15460a0ecf9ab16445d676b2bbb6/distilled/ltx-2.5-22b-distilled-Q4_K_M.gguf", dest: "models/ltx-2.5/ltx-2.5-22b-distilled-Q4_K_M.gguf", size: 13_584_703_872, sha256: "ba40d53770314e69e88361661e55c6cc3b12a363646ba2ea53c8bcd459b66747", unzip_into: None } },
            ModelFile { slot: Slot::Llm, download: Download { url: "https://huggingface.co/PulpCut/LTX-2.5-INT8-ConvRot-safetensors/resolve/7597fb305b4cab9e7ff2c1d1e9551279c2932f0f/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", dest: "models/ltx-2.5/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", size: 15_372_969_374, sha256: "6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f", unzip_into: None } },
            ModelFile { slot: Slot::Vae, download: Download { url: "https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/vae/ltx-2.5-video-vae-conv-bf16.safetensors", dest: "models/ltx-2.5/ltx-2.5-video-vae-conv-bf16.safetensors", size: 1_452_269_922, sha256: "685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d", unzip_into: None } },
            ModelFile { slot: Slot::AudioVae, download: Download { url: "https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/vae/ltx-2.5-audio-vae-bf16.safetensors", dest: "models/ltx-2.5/ltx-2.5-audio-vae-bf16.safetensors", size: 364_866_540, sha256: "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5", unzip_into: None } },
        ],
        presets: &[
            Preset {
                id: "two-pass",
                name: "LTX-2.5 Distilled ×2",
                files: &[ModelFile { slot: Slot::Upscaler, download: Download { url: "https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", dest: "models/ltx-2.5/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", size: 995_778_752, sha256: "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8", unzip_into: None } }],
                steps: 8,
                cfg: 1.0,
                flow_shift: 0.0,
                schedule: Schedule::Fixed(LTX_DISTILLED_SIGMAS),
                sampler: Sampler::EulerAncestral,
                upscale_sigmas: &[0.909375, 0.725, 0.421875, 0.0],
            },
            Preset { id: "one-pass", name: "LTX-2.5 Distilled", files: &[], steps: 8, cfg: 1.0, flow_shift: 0.0, schedule: Schedule::Fixed(LTX_DISTILLED_SIGMAS), sampler: Sampler::EulerAncestral, upscale_sigmas: &[] },
        ],
        sizes: &[(1536, 1024), (1024, 1536), (1280, 704), (704, 1280), (768, 512), (512, 768)],
        rng_cpu: false,
        seconds: &[2, 3, 5],
        fps: 24,
        frame_step: 8,
        frame_offset: 1,
    },
];

fn model(id: &str) -> Option<&'static LocalModel> {
    MODELS.iter().find(|model| model.id == id)
}

/// The model's own files and its presets', each once.
fn all_files(model: &'static LocalModel) -> Vec<&'static ModelFile> {
    let mut files: Vec<&'static ModelFile> = Vec::new();
    for file in model.files.iter().chain(model.presets.iter().flat_map(|preset| preset.files.iter())) {
        if !files.iter().any(|known| known.download.dest == file.download.dest) {
            files.push(file);
        }
    }
    files
}

fn preset(model: &'static LocalModel, id: Option<&str>) -> Result<&'static Preset, String> {
    match id.filter(|id| !id.is_empty()) {
        None => Ok(&model.presets[0]),
        Some(id) => model.presets.iter().find(|preset| preset.id == id).ok_or_else(|| {
            t!("local-unknown-preset", preset = id.to_string(), model = model.name, presets = model.presets.iter().map(|preset| preset.id).collect::<Vec<_>>().join(", "))
        }),
    }
}


/// The weight files a run of `id` with `preset` loads, by file name: the parts of the model set the hub counts.
pub fn components(id: &str, preset_id: Option<&str>) -> Vec<String> {
    let Some(model) = model(id) else { return Vec::new() };
    let Ok(preset) = preset(model, preset_id) else { return Vec::new() };
    model.files.iter().chain(preset.files.iter()).map(|file| file.download.dest.rsplit('/').next().unwrap_or(file.download.dest).to_string()).collect()
}

fn file_there(data: &Path, download: &Download) -> bool {
    std::fs::metadata(data.join(download.dest)).is_ok_and(|meta| meta.is_file() && meta.len() == download.size)
}

fn model_installed(data: &Path, model: &'static LocalModel) -> bool {
    all_files(model).iter().all(|file| file_there(data, &file.download))
}

fn build(device: Device) -> Option<&'static Build> {
    BUILDS.iter().find(|build| build.device == device)
}

fn build_installed(data: &Path, build: &Build) -> bool {
    build.markers.iter().all(|marker| data.join(marker).is_file())
}

/// The device a run uses: the one chosen in Settings, or for Auto the best one installed (CUDA on an NVIDIA card,
/// else Vulkan, else the processor).
fn chosen_device(data: &Path) -> Result<Device, String> {
    let chosen = crate::settings::get().local_device;
    if let Some(device) = Device::parse(&chosen) {
        return match build(device) {
            Some(build) if build_installed(data, build) => Ok(device),
            Some(_) => Err(t!("local-engine-missing", device = device.as_str())),
            None => Err(t!("local-unsupported")),
        };
    }
    let order: &[Device] = if nvidia() { &[Device::Cuda, Device::Vulkan, Device::Cpu] } else { &[Device::Vulkan, Device::Cpu] };
    order.iter().copied().find(|device| build(*device).is_some_and(|build| build_installed(data, build))).ok_or_else(|| t!("local-engine-missing", device = recommended_device().as_str()))
}

fn nvidia() -> bool {
    !crate::hw::snapshot().gpu_name.is_empty()
}

/// The build Auto downloads on this computer.
fn recommended_device() -> Device {
    if nvidia() { Device::Cuda } else { Device::Vulkan }
}

// ---------------------------------------------------------------- the catalogue

/// The models run here: VideoSOS's own, and the author's studios found running on this computer.
pub fn entries() -> Vec<ModelEntry> {
    MODELS.iter().map(entry_of).chain(crate::studios::entries()).collect()
}

pub fn entry(id: &str) -> Option<ModelEntry> {
    model(id).map(entry_of).or_else(|| crate::studios::entry(id))
}

fn entry_of(model: &'static LocalModel) -> ModelEntry {
    ModelEntry {
        provider: Provider::Local,
        id: model.id.into(),
        name: model.name.into(),
        description: model.description.into(),
        tasks: match model.kind {
            Kind::Image => vec![Task::Image],
            Kind::Video => vec![Task::Video],
        },
        created: None,
        status: "live".into(),
        price: Some(t!("local-price")),
        rates: Vec::new(),
        thumbnail: None,
        source: json!({ "download_bytes": all_files(model).iter().map(|file| file.download.size).sum::<u64>() }),
    }
}

/// What a run on this computer costs: nothing, so every estimate of it is exact.
pub(crate) fn free() -> PriceRule {
    PriceRule { rates: vec![Rate { amount: 0.0, unit: "output".into(), label: None }], note: Some(t!("local-price")) }
}

pub fn form(id: &str) -> Result<ModelForm, String> {
    if crate::studios::studio(id).is_some() {
        return crate::studios::form(id);
    }
    let model = model(id).ok_or_else(|| t!("catalog-unknown-model", provider = "local", model = id.to_string()))?;
    let size_choice = |(w, h): &(u32, u32)| Choice { value: json!(format!("{w}x{h}")), label: format!("{w}×{h}") };
    let mut fields = vec![
        Field { key: "prompt".into(), label: t!("local-field-prompt"), description: None, kind: FieldKind::Textarea { max_length: None }, required: true, default: None, advanced: false, role: Some(Role::Prompt) },
        Field {
            key: "size".into(),
            label: t!("local-field-size"),
            description: None,
            kind: FieldKind::Size { options: model.sizes.iter().map(size_choice).collect(), width_key: "width".into(), height_key: "height".into() },
            required: true,
            default: model.sizes.first().map(|(w, h)| json!(format!("{w}x{h}"))),
            advanced: false,
            role: Some(Role::Size),
        },
    ];
    if model.kind == Kind::Video {
        fields.push(Field {
            key: "duration".into(),
            label: t!("local-field-duration"),
            description: None,
            kind: FieldKind::Select { options: model.seconds.iter().map(|s| Choice { value: json!(s.to_string()), label: format!("{s} s") }).collect() },
            required: true,
            default: model.seconds.first().map(|s| json!(s.to_string())),
            advanced: false,
            role: Some(Role::Duration),
        });
        fields.push(Field { key: "first_frame".into(), label: t!("local-field-first-frame"), description: None, kind: FieldKind::Media { media: MediaKind::Image, min: 0, max: 1, list: false }, required: false, default: None, advanced: false, role: Some(Role::FirstFrame) });
    }
    if model.presets.len() > 1 {
        fields.push(Field {
            key: "preset".into(),
            label: t!("local-field-preset"),
            description: Some(t!("local-field-preset-hint")),
            kind: FieldKind::Select { options: model.presets.iter().map(|preset| Choice { value: json!(preset.id), label: preset_label(preset) }).collect() },
            required: false,
            default: Some(json!(model.presets[0].id)),
            advanced: false,
            role: None,
        });
    }
    fields.push(Field { key: "negative_prompt".into(), label: t!("local-field-negative"), description: None, kind: FieldKind::Textarea { max_length: None }, required: false, default: None, advanced: true, role: Some(Role::NegativePrompt) });
    fields.push(Field { key: "steps".into(), label: t!("local-field-steps"), description: Some(t!("local-field-steps-hint")), kind: FieldKind::Integer { min: Some(1.0), max: Some(80.0) }, required: false, default: None, advanced: true, role: None });
    fields.push(Field { key: "cfg".into(), label: t!("local-field-cfg"), description: Some(t!("local-field-cfg-hint")), kind: FieldKind::Number { min: Some(1.0), max: Some(15.0) }, required: false, default: None, advanced: true, role: None });
    fields.push(Field { key: "seed".into(), label: t!("local-field-seed"), description: None, kind: FieldKind::Integer { min: Some(-1.0), max: Some(2_147_483_647.0) }, required: false, default: Some(json!(-1)), advanced: true, role: Some(Role::Seed) });
    Ok(ModelForm { provider: Provider::Local, id: model.id.into(), fields, price: free(), delivery: "sync".into(), source: Value::Null })
}

// ---------------------------------------------------------------- downloads

#[derive(Clone, Debug, Default, Serialize)]
struct Install {
    /// A model id or `engine-<device>`.
    what: String,
    current: Option<String>,
    downloaded: u64,
    total: u64,
    error: Option<String>,
    installing: bool,
}

/// The program each model's files were taken from in this run instead of downloaded, by its contract id.
fn taken() -> &'static Mutex<std::collections::HashMap<&'static str, String>> {
    static TAKEN: OnceLock<Mutex<std::collections::HashMap<&'static str, String>>> = OnceLock::new();
    TAKEN.get_or_init(Default::default)
}

/// Model files being looked for at another program now, so a second poll does not start the same search.
fn linking() -> &'static Mutex<std::collections::HashSet<PathBuf>> {
    static LINKING: OnceLock<Mutex<std::collections::HashSet<PathBuf>>> = OnceLock::new();
    LINKING.get_or_init(Default::default)
}

/// The setup screen links in what another program of the author's has on the same drive: a hard link, checked
/// by SHA-256 before it is used; another drive waits for the install, which copies.
pub(crate) fn link_from_neighbors(data: &Path) {
    if installing().load(Ordering::SeqCst) {
        return;
    }
    for model in MODELS {
        for file in all_files(model) {
            let download = &file.download;
            let dest = data.join(download.dest);
            if download.unzip_into.is_some() || file_there(data, download) || !linking().lock().unwrap_or_else(|p| p.into_inner()).insert(dest.clone()) {
                continue;
            }
            tokio::task::spawn_blocking(move || {
                if let Some(name) = dest.file_name()
                    && let Some((source, app)) = studio_hub_client::neighbors::find_file(name, download.size, None)
                {
                    match studio_hub_client::neighbors::take_file(&source, &dest, false, |staged| sha256_of(staged).is_some_and(|got| got == download.sha256)) {
                        Ok(()) => {
                            taken().lock().unwrap_or_else(|p| p.into_inner()).insert(model.id, app);
                            changed();
                        }
                        Err(error) => tracing::warn!("[ERROR] {} from {app} was not linked in: {error}", source.display()),
                    }
                }
                linking().lock().unwrap_or_else(|p| p.into_inner()).remove(&dest);
            });
        }
    }
}

fn install_state() -> &'static Mutex<Install> {
    static STATE: OnceLock<Mutex<Install>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Install::default()))
}

fn installing() -> &'static AtomicBool {
    static FLAG: AtomicBool = AtomicBool::new(false);
    &FLAG
}

pub(crate) fn changed() {
    crate::events::send("local", json!({}));
}

/// What a model needs that is not here yet: its files, and the engine and ffmpeg when they are missing.
fn missing_for(data: &Path, what: &str) -> Result<Vec<&'static Download>, String> {
    let mut files = Vec::new();
    if let Some(device) = what.strip_prefix("engine-") {
        let device = Device::parse(device).ok_or_else(|| t!("local-unknown", what = what.to_string()))?;
        let build = build(device).ok_or_else(|| t!("local-unsupported"))?;
        if !build_installed(data, build) {
            files.extend(build.files.iter());
        }
        return Ok(files);
    }
    let model = model(what).ok_or_else(|| t!("local-unknown", what = what.to_string()))?;
    files.extend(all_files(model).into_iter().map(|file| &file.download).filter(|download| !file_there(data, download)));
    if chosen_device(data).is_err() {
        let device = Device::parse(&crate::settings::get().local_device).unwrap_or_else(recommended_device);
        let build = build(device).ok_or_else(|| t!("local-unsupported"))?;
        if !build_installed(data, build) {
            files.extend(build.files.iter());
        }
    }
    Ok(files)
}

/// Downloads a model (with the engine when it is missing) or an engine build, in the background.
pub fn start_install(data: &Path, what: &str) -> Result<bool, String> {
    let files = missing_for(data, what)?;
    let needs_ffmpeg = model(what).is_some_and(|model| model.kind == Kind::Video) && !ffmpeg(data).is_file();
    if files.is_empty() && !needs_ffmpeg {
        return Ok(false);
    }
    if installing().swap(true, Ordering::SeqCst) {
        return Err(t!("local-install-busy"));
    }
    let total: u64 = files.iter().map(|file| file.size).sum();
    if let Some(free) = crate::tools::free_bytes(data)
        && free < total.saturating_add(total / 10)
    {
        installing().store(false, Ordering::SeqCst);
        crate::hub::setup_failed("disk_space");
        return Err(t!("url-disk-space", need = total / 1_000_000, free = free / 1_000_000));
    }
    *install_state().lock().unwrap_or_else(|p| p.into_inner()) = Install { what: what.into(), installing: true, total, ..Install::default() };
    changed();
    let data = data.to_path_buf();
    let what = what.to_string();
    tokio::spawn(async move {
        let mut result = download_all(&data, &files).await;
        if result.is_ok() && needs_ffmpeg {
            result = crate::tools::install_ffmpeg(&data).await.map_err(|e| ("ffmpeg", e.detail));
        }
        match &result {
            // the models got ready: an engine build alone is a tool, not the step the install report counts
            Ok(()) if model(&what).is_some() => crate::hub::setup_ready(),
            Ok(()) => {}
            Err((code, _)) => crate::hub::setup_failed(code),
        }
        let result = result.map_err(|(_, message)| message);
        installing().store(false, Ordering::SeqCst);
        {
            let mut state = install_state().lock().unwrap_or_else(|p| p.into_inner());
            state.installing = false;
            state.current = None;
            state.error = result.as_ref().err().cloned();
        }
        if let Err(error) = result {
            tracing::warn!("[ERROR] local install: {error}");
        }
        changed();
    });
    Ok(true)
}

/// Downloads the files, each taken from another program of the author's first when it has the same one; an error
/// carries a code for the hub with its message.
async fn download_all(data: &Path, files: &[&'static Download]) -> Result<(), (&'static str, String)> {
    let client = crate::tools::client(Duration::from_secs(120)).map_err(|e| ("download", e.detail))?;
    let mut done = 0u64;
    for file in files {
        install_state().lock().unwrap_or_else(|p| p.into_inner()).current = Some(file.dest.rsplit('/').next().unwrap_or(file.dest).to_string());
        let dest = data.join(file.dest);
        if let Some(app) = take_from_neighbor(file, &dest).await {
            let what = install_state().lock().unwrap_or_else(|p| p.into_inner()).what.clone();
            if let Some(model) = model(&what) {
                taken().lock().unwrap_or_else(|p| p.into_inner()).insert(model.id, app);
            }
            done += file.size;
            install_state().lock().unwrap_or_else(|p| p.into_inner()).downloaded = done;
            changed();
            continue;
        }
        let last = Mutex::new(Instant::now());
        let tell = |bytes: u64| {
            install_state().lock().unwrap_or_else(|p| p.into_inner()).downloaded = done + bytes;
            let mut last = last.lock().unwrap_or_else(|p| p.into_inner());
            if last.elapsed() > Duration::from_millis(500) {
                *last = Instant::now();
                changed();
            }
        };
        fetch_resumable(&client, file, &dest, &tell).await.map_err(|message| ("download", message))?;
        done += file.size;
        if let Some(folder) = file.unzip_into {
            let (archive, folder) = (dest.clone(), data.join(folder));
            tokio::task::spawn_blocking(move || {
                std::fs::create_dir_all(&folder).map_err(|e| format!("{}: {e}", folder.display()))?;
                crate::tools::unzip(&archive, &folder, None)
            })
            .await
            .map_err(|e| ("unzip", e.to_string()))?
            .map_err(|message| ("unzip", message))?;
            let _ = std::fs::remove_file(&dest);
        }
    }
    Ok(())
}

/// A model file another program of the author's already has, put at `dest` (a hard link, a copy on another drive)
/// once its SHA-256 matches; the program's id, or None when no program has it and it is downloaded.
async fn take_from_neighbor(file: &'static Download, dest: &Path) -> Option<String> {
    // an archive is unpacked and removed, so no program keeps one to give
    if file.unzip_into.is_some() || dest.is_file() {
        return None;
    }
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let (source, app) = studio_hub_client::neighbors::find_file(dest.file_name()?, file.size, None)?;
        match studio_hub_client::neighbors::take_file(&source, &dest, true, |staged| sha256_of(staged).is_some_and(|got| got == file.sha256)) {
            Ok(()) => Some(app),
            Err(error) => {
                tracing::warn!("[ERROR] {} from {app} was not taken, it is downloaded: {error}", source.display());
                None
            }
        }
    })
    .await
    .ok()
    .flatten()
}

fn sha256_of(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut reader = std::fs::File::open(path).ok()?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = reader.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Some(hex::encode(digest.finalize()))
}

/// Downloads into `<dest>.part`, going on from what an earlier download left, checks size and SHA-256 over the
/// whole file and only then gives it its name.
async fn fetch_resumable(client: &reqwest::Client, file: &Download, dest: &Path, progress: &(dyn Fn(u64) + Sync)) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    if let Some(folder) = dest.parent() {
        std::fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let mut digest = Sha256::new();
    let mut have = std::fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
    if have > file.size {
        let _ = std::fs::remove_file(&part);
        have = 0;
    }
    if have > 0 {
        let mut reader = tokio::fs::File::open(&part).await.map_err(|e| format!("{}: {e}", part.display()))?;
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = reader.read(&mut buffer).await.map_err(|e| format!("{}: {e}", part.display()))?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
    }
    let mut request = client.get(file.url);
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("{}: {e}", file.url))?;
    if have > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        // the server sends the whole file again: start over
        digest = Sha256::new();
        have = 0;
    }
    let mut out = tokio::fs::OpenOptions::new().create(true).write(true).append(have > 0).truncate(have == 0).open(&part).await.map_err(|e| format!("{}: {e}", part.display()))?;
    let mut size = have;
    progress(size);
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("{}: {e}", file.url))? {
        size += chunk.len() as u64;
        if size > file.size {
            drop(out);
            let _ = std::fs::remove_file(&part);
            return Err(t!("local-too-large", url = file.url.to_string(), size = file.size));
        }
        digest.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| format!("{}: {e}", part.display()))?;
        progress(size);
    }
    out.flush().await.map_err(|e| format!("{}: {e}", part.display()))?;
    drop(out);
    let got = hex::encode(digest.finalize());
    if size != file.size || got != file.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(t!("local-sha-mismatch", url = file.url.to_string(), got = got, want = file.sha256.to_string()));
    }
    std::fs::rename(&part, dest).map_err(|e| format!("{}: {e}", dest.display()))
}

/// Removes a model's files; the engine stays.
pub fn remove(data: &Path, id: &str) -> Result<(), String> {
    let model = model(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    if installing().load(Ordering::SeqCst) && install_state().lock().unwrap_or_else(|p| p.into_inner()).what == id {
        return Err(t!("local-install-busy"));
    }
    unload_if(id);
    for file in all_files(model) {
        let path = data.join(file.download.dest);
        for each in [path.clone(), PathBuf::from(format!("{}.part", path.display()))] {
            if each.is_file() {
                std::fs::remove_file(&each).map_err(|e| format!("{}: {e}", each.display()))?;
            }
        }
    }
    changed();
    Ok(())
}

// ---------------------------------------------------------------- status

pub fn status(data: &Path) -> Value {
    let settings = crate::settings::get();
    let install = install_state().lock().unwrap_or_else(|p| p.into_inner()).clone();
    let loaded = LOADED.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|loaded| json!({ "model": loaded.model, "device": loaded.device.as_str() }));
    json!({
        "supported": !BUILDS.is_empty(),
        "device": if settings.local_device.is_empty() { "auto" } else { settings.local_device.as_str() },
        "device_in_use": chosen_device(data).ok().map(Device::as_str),
        "recommended": recommended_device().as_str(),
        "gpu": crate::hw::snapshot().gpu_name,
        "engines": BUILDS.iter().map(|build| json!({
            "device": build.device.as_str(),
            "installed": build_installed(data, build),
            "download_bytes": build.files.iter().map(|file| file.size).sum::<u64>(),
        })).collect::<Vec<_>>(),
        "ffmpeg": ffmpeg(data).is_file(),
        "models": MODELS.iter().map(|model| json!({
            "id": model.id,
            "name": model.name,
            "task": if model.kind == Kind::Image { "image" } else { "video" },
            "installed": model_installed(data, model),
            "download_bytes": all_files(model).iter().filter(|file| !file_there(data, &file.download)).map(|file| file.download.size).sum::<u64>(),
            "size_bytes": all_files(model).iter().map(|file| file.download.size).sum::<u64>(),
            "presets": model.presets.iter().map(|preset| json!({ "id": preset.id, "label": preset_label(preset) })).collect::<Vec<_>>(),
            "taken_from": taken().lock().unwrap_or_else(|p| p.into_inner()).get(model.id),
        })).collect::<Vec<_>>(),
        "loaded": loaded,
        "install": install,
        "studios": crate::studios::status(),
    })
}

/// Whether a model can run now; the reason when not.
pub fn ready(data: &Path, id: &str) -> Result<(), String> {
    let model = model(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    if !model_installed(data, model) {
        return Err(t!("local-model-missing", model = model.name));
    }
    chosen_device(data)?;
    if model.kind == Kind::Video && !ffmpeg(data).is_file() {
        return Err(t!("local-ffmpeg-missing"));
    }
    Ok(())
}

fn ffmpeg(data: &Path) -> PathBuf {
    crate::tools::ffmpeg_dir(data).join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
}

// ---------------------------------------------------------------- running

struct Loaded {
    model: String,
    device: Device,
    /// The diffusion weights read, which a preset can swap for another checkpoint of the model.
    weights: &'static str,
    context: Context<'static>,
}

/// The model in memory; a run holds the lock for its whole length, so runs go one at a time.
static LOADED: Mutex<Option<Loaded>> = Mutex::new(None);
/// The running generation's stop, reachable while `LOADED` is held by the run.
static RUNNING: Mutex<Option<Canceller>> = Mutex::new(None);

/// One engine per device build, loaded once: the libraries stay for the process, the models come and go.
fn engine(data: &Path, device: Device) -> Result<&'static Engine, String> {
    static ENGINES: Mutex<Vec<(Device, &'static Engine)>> = Mutex::new(Vec::new());
    let mut engines = ENGINES.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((_, engine)) = engines.iter().find(|(each, _)| *each == device) {
        return Ok(engine);
    }
    let build = build(device).ok_or_else(|| t!("local-unsupported"))?;
    let engine: &'static Engine = Box::leak(Box::new(Engine::load(&data.join(build.folder)).map_err(|e| e.to_string())?));
    tracing::info!("local engine {} for {}: {:?}", engine.commit(), device.as_str(), engine.devices());
    engines.push((device, engine));
    Ok(engine)
}

fn unload_if(id: &str) {
    let mut loaded = LOADED.lock().unwrap_or_else(|p| p.into_inner());
    if loaded.as_ref().is_some_and(|loaded| loaded.model == id) {
        *loaded = None;
    }
}

/// Frees the model's memory.
pub fn unload() -> bool {
    LOADED.lock().unwrap_or_else(|p| p.into_inner()).take().is_some()
}

/// Stops the generation running now, if any.
pub fn cancel() {
    if let Some(canceller) = RUNNING.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        canceller.cancel();
    }
}

fn config(data: &Path, model: &LocalModel, preset: &Preset, device: Device) -> ModelConfig {
    let mut config = ModelConfig { offload_to_cpu: device != Device::Cpu, flash_attn: device != Device::Cpu, n_threads: -1, rng_cpu: model.rng_cpu, ..ModelConfig::default() };
    for file in model.files.iter().chain(preset.files.iter().filter(|file| file.slot == Slot::Diffusion)) {
        let path = Some(data.join(file.download.dest));
        match file.slot {
            Slot::Diffusion => config.diffusion_model = path,
            Slot::Llm => config.llm = path,
            Slot::Vae => config.vae = path,
            Slot::AudioVae => config.audio_vae = path,
            Slot::Lora | Slot::Upscaler => {}
        }
    }
    config
}

/// The diffusion weights a preset samples: its own checkpoint, or the model's.
fn weights(model: &'static LocalModel, preset: &'static Preset) -> &'static str {
    preset.files.iter().chain(model.files.iter()).find(|file| file.slot == Slot::Diffusion).map(|file| file.download.dest).unwrap_or_default()
}

fn preset_label(preset: &Preset) -> String {
    if preset.name.is_empty() {
        t!("local-preset-full")
    } else {
        t!("local-preset", name = preset.name, steps = preset.steps)
    }
}

fn number(values: &Map<String, Value>, key: &str) -> Option<f64> {
    match values.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// Runs a local model with the job's values; the result is a file in `out_dir`. Blocking: call it off the runtime.
pub fn run(data: &Path, id: &str, values: &Map<String, Value>, out_dir: &Path, progress: &(dyn Fn(f64) + Sync)) -> Result<Vec<Output>, String> {
    let model = model(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    ready(data, id)?;
    let device = chosen_device(data)?;
    let prompt = values.get("prompt").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if prompt.is_empty() {
        return Err(t!("local-no-prompt"));
    }
    let negative = values.get("negative_prompt").and_then(Value::as_str).unwrap_or_default().to_string();
    let (width, height) = values
        .get("size")
        .and_then(Value::as_str)
        .and_then(|size| size.split_once('x'))
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .filter(|size| model.sizes.contains(size))
        .or_else(|| model.sizes.first().copied())
        .ok_or_else(|| t!("local-bad-size"))?;
    let preset = preset(model, values.get("preset").and_then(Value::as_str))?;
    let steps = number(values, "steps").map(|n| n.round() as i32).unwrap_or(preset.steps).clamp(0, 80);
    let cfg = number(values, "cfg").map(|n| n as f32).unwrap_or(preset.cfg);
    // a preset's schedule is the one its step count was distilled to; another count takes the engine's
    let sigmas = if steps == preset.steps { preset.schedule.sigmas(width, height) } else { Vec::new() };
    let loras: Vec<Lora> = preset.files.iter().filter(|file| file.slot == Slot::Lora).map(|file| Lora { path: data.join(file.download.dest), multiplier: 1.0 }).collect();
    let weights = weights(model, preset);
    let seed = number(values, "seed").map(|n| n as i64).filter(|seed| *seed >= 0).unwrap_or_else(|| (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) % 2_147_483_647) as i64);

    let mut loaded = LOADED.lock().unwrap_or_else(|p| p.into_inner());
    if !loaded.as_ref().is_some_and(|loaded| loaded.model == id && loaded.device == device && loaded.weights == weights) {
        // the old model's memory is freed before the new one is read
        *loaded = None;
        progress(0.0);
        let engine = engine(data, device)?;
        let context = engine.new_context(&config(data, model, preset, device)).map_err(|e| e.to_string())?;
        *loaded = Some(Loaded { model: id.into(), device, weights, context });
    }
    let Some(current) = loaded.as_mut() else { return Err(t!("local-not-loaded")) };
    *RUNNING.lock().unwrap_or_else(|p| p.into_inner()) = Some(current.context.canceller());
    let report = |step: i32, steps: i32| progress((step as f64 / steps.max(1) as f64).clamp(0.0, 1.0) * 0.95);
    // the engine's callback is 'static; the job's progress outlives the call through a channel of fractions
    let (tx, rx) = std::sync::mpsc::channel::<(i32, i32)>();
    let sink: Box<dyn Fn(i32, i32) + Send + Sync> = Box::new(move |step, steps| {
        let _ = tx.send((step, steps));
    });
    let report = &report;
    let outcome = std::thread::scope(|scope| {
        let reporter = scope.spawn(move || {
            for (step, steps) in rx.iter() {
                report(step, steps);
            }
        });
        let made = match model.kind {
            Kind::Image => current
                .context
                .image(&ImageParams { prompt: prompt.clone(), negative_prompt: negative.clone(), width: width as i32, height: height as i32, steps, cfg_scale: cfg, seed, sigmas, ref_images: Vec::new(), loras: loras.clone() }, Some(sink))
                .map(Made::Image),
            Kind::Video => {
                let seconds = number(values, "duration").map(|n| n.round() as u32).filter(|s| model.seconds.contains(s)).unwrap_or(model.seconds[0]);
                let wanted = seconds as i32 * model.fps;
                let frames = ((wanted - model.frame_offset).max(0) + model.frame_step - 1) / model.frame_step * model.frame_step + model.frame_offset;
                let first_frame = match values.get("first_frame").and_then(Value::as_str) {
                    Some(address) => Some(frame_from(data, address, width, height)?),
                    None => None,
                };
                let upscaler = preset.files.iter().find(|file| file.slot == Slot::Upscaler).filter(|_| !preset.upscale_sigmas.is_empty());
                let upscale = upscaler.map(|file| Upscale { model: data.join(file.download.dest), scale: 2.0, sigmas: preset.upscale_sigmas.to_vec() });
                let (pass_width, pass_height) = if upscale.is_some() { (width / 2, height / 2) } else { (width, height) };
                current
                    .context
                    .video(
                        &VideoParams {
                            prompt: prompt.clone(),
                            negative_prompt: negative.clone(),
                            width: pass_width as i32,
                            height: pass_height as i32,
                            frames,
                            fps: model.fps,
                            steps,
                            cfg_scale: cfg,
                            flow_shift: preset.flow_shift,
                            sigmas: sigmas.clone(),
                            sampler: preset.sampler,
                            seed,
                            first_frame,
                            last_frame: None,
                            loras: loras.clone(),
                            upscale,
                        },
                        Some(sink),
                    )
                    .map(Made::Video)
            }
        };
        let _ = reporter.join();
        Ok::<_, String>(made)
    });
    *RUNNING.lock().unwrap_or_else(|p| p.into_inner()) = None;
    drop(loaded);
    let made = outcome?.map_err(|e| e.to_string())?;
    std::fs::create_dir_all(out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;
    match made {
        Made::Image(image) => {
            let path = out_dir.join("local.png");
            write_png(&path, &image)?;
            Ok(vec![Output::File { path, mime: "image/png".into() }])
        }
        Made::Video(video) => {
            let path = out_dir.join("local.mp4");
            encode_video(data, &path, &video)?;
            Ok(vec![Output::File { path, mime: "video/mp4".into() }])
        }
    }
}

enum Made {
    Image(RawImage),
    Video(vs_diffusion::RawVideo),
}

fn write_png(path: &Path, image: &RawImage) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), image.width, image.height);
    encoder.set_color(if image.channels == 4 { png::ColorType::Rgba } else { png::ColorType::Rgb });
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(&image.data).map_err(|e| e.to_string())
}

/// The frames into an H.264 MP4 through the pinned ffmpeg, with the model's sound when it made some.
fn encode_video(data: &Path, path: &Path, video: &vs_diffusion::RawVideo) -> Result<(), String> {
    use std::io::Write;
    let first = video.frames.first().ok_or_else(|| t!("local-no-frames"))?;
    let audio_path = path.with_extension("f32");
    let mut command = std::process::Command::new(ffmpeg(data));
    command.args(["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", if first.channels == 4 { "rgba" } else { "rgb24" }]);
    command.args(["-s", &format!("{}x{}", first.width, first.height), "-r", &video.fps.to_string(), "-i", "-"]);
    if let Some(audio) = video.audio.as_ref() {
        let bytes: Vec<u8> = audio.samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
        std::fs::write(&audio_path, bytes).map_err(|e| format!("{}: {e}", audio_path.display()))?;
        command.args(["-f", "f32le", "-ar", &audio.sample_rate.to_string(), "-ac", &audio.channels.to_string(), "-i"]).arg(&audio_path);
        command.args(["-c:a", "aac", "-b:a", "192k", "-shortest"]);
    }
    command.args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart"]).arg(path);
    command.stdin(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("ffmpeg: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("ffmpeg: no stdin")?;
        for frame in &video.frames {
            stdin.write_all(&frame.data).map_err(|e| format!("ffmpeg: {e}"))?;
        }
    }
    let output = child.wait_with_output().map_err(|e| format!("ffmpeg: {e}"))?;
    let _ = std::fs::remove_file(&audio_path);
    if !output.status.success() {
        return Err(format!("ffmpeg: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(())
}

/// A picture the job was given (a data: address) as the model's first frame, scaled to fill the size.
fn frame_from(data: &Path, address: &str, width: u32, height: u32) -> Result<RawImage, String> {
    use base64::Engine as _;
    let encoded = address.split_once(";base64,").map(|(_, rest)| rest).ok_or_else(|| t!("local-bad-frame"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    let source = std::env::temp_dir().join(format!("vs-first-frame-{}", uuid::Uuid::new_v4()));
    std::fs::write(&source, &bytes).map_err(|e| format!("{}: {e}", source.display()))?;
    let mut command = std::process::Command::new(ffmpeg(data));
    command.args(["-hide_banner", "-loglevel", "error", "-i"]).arg(&source);
    command.args(["-vf", &format!("scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    let output = command.output().map_err(|e| format!("ffmpeg: {e}"));
    let _ = std::fs::remove_file(&source);
    let output = output?;
    if !output.status.success() || output.stdout.len() != (width * height * 3) as usize {
        return Err(format!("ffmpeg: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(RawImage { width, height, channels: 3, data: output.stdout })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_file_is_pinned_by_revision_size_and_hash() {
        let downloads = MODELS.iter().flat_map(|model| all_files(model).into_iter().map(|file| &file.download)).chain(BUILDS.iter().flat_map(|build| build.files.iter()));
        for download in downloads {
            assert!(download.size > 0, "{}", download.dest);
            assert_eq!(download.sha256.len(), 64, "{}", download.dest);
            assert!(download.url.starts_with("https://"), "{}", download.url);
            if download.url.starts_with("https://huggingface.co") {
                let revision = download.url.split("/resolve/").nth(1).and_then(|rest| rest.split('/').next()).unwrap_or_default();
                assert_eq!(revision.len(), 40, "{} is not pinned to a revision", download.url);
            }
        }
    }

    #[test]
    fn every_model_has_a_form_with_its_sizes() {
        for model in MODELS {
            let form = form(model.id).unwrap();
            assert!(form.fields.iter().any(|field| field.role == Some(Role::Prompt)));
            assert!(form.fields.iter().any(|field| matches!(&field.kind, FieldKind::Size { options, .. } if options.len() == model.sizes.len())));
            assert_eq!(form.fields.iter().any(|field| field.role == Some(Role::Duration)), model.kind == Kind::Video);
            assert_eq!(form.fields.iter().any(|field| field.key == "preset"), model.presets.len() > 1);
        }
    }

    #[test]
    fn a_run_on_this_computer_is_priced_at_exactly_nothing() {
        for model in MODELS {
            let form = form(model.id).expect("form");
            let estimate = vs_providers::price::estimate(&form, &serde_json::Map::new()).expect("an estimate");
            assert_eq!(estimate.usd, 0.0, "{}", model.id);
            assert!(estimate.exact, "{}", model.id);
        }
    }

    #[test]
    fn every_preset_samples_one_set_of_diffusion_weights() {
        for model in MODELS {
            assert!(!model.presets.is_empty(), "{}", model.id);
            for preset in model.presets {
                let own = model.files.iter().filter(|file| file.slot == Slot::Diffusion).count();
                let swapped = preset.files.iter().filter(|file| file.slot == Slot::Diffusion).count();
                assert!(own + swapped >= 1 && swapped <= 1, "{} {}", model.id, preset.id);
                assert!(preset.files.iter().all(|file| matches!(file.slot, Slot::Diffusion | Slot::Lora | Slot::Upscaler)), "{} {}", model.id, preset.id);
                let upscalers = preset.files.iter().filter(|file| file.slot == Slot::Upscaler).count();
                assert_eq!(upscalers, usize::from(!preset.upscale_sigmas.is_empty()), "{} {}", model.id, preset.id);
                if !preset.upscale_sigmas.is_empty() {
                    assert_eq!(preset.upscale_sigmas.last(), Some(&0.0), "{} {}", model.id, preset.id);
                    // both passes land on the 32-pixel latent grid
                    assert!(model.sizes.iter().all(|(w, h)| w % 64 == 0 && h % 64 == 0), "{} {}", model.id, preset.id);
                }
                if let Schedule::Fixed(sigmas) | Schedule::QwenShifted(sigmas) = &preset.schedule {
                    let evaluations = if matches!(preset.schedule, Schedule::Fixed(_)) { sigmas.len() - 1 } else { sigmas.len() };
                    assert_eq!(evaluations as i32, preset.steps, "{} {}", model.id, preset.id);
                }
            }
        }
    }

    #[test]
    fn qwen_shift_follows_the_token_count_without_a_terminal_stretch() {
        let sigmas = Schedule::QwenShifted(&[1.0, 0.75, 0.5, 0.25]).sigmas(1024, 1024);
        let mu = (4096.0 * 0.4 / 7936.0 + 0.5 - 0.4 / 7936.0 * 256.0_f64).exp();
        let expected: Vec<f32> = [1.0, 0.75, 0.5, 0.25].iter().map(|t: &f64| (mu / (mu + 1.0 / t - 1.0)) as f32).chain([0.0]).collect();
        assert_eq!(sigmas.len(), expected.len());
        assert!(sigmas.iter().zip(&expected).all(|(got, want)| (got - want).abs() < 1e-6), "{sigmas:?} {expected:?}");
        assert!((sigmas[1] - 0.8572).abs() < 1e-3, "{sigmas:?}");
        assert!(Schedule::QwenShifted(&[1.0, 0.5]).sigmas(1024, 1024)[1] < Schedule::QwenShifted(&[1.0, 0.5]).sigmas(1536, 1536)[1]);
    }
}

// ---------------------------------------------------------------- routes

use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};

use crate::AppState;

fn refused(error: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

async fn status_route(State(state): State<AppState>) -> Json<Value> {
    link_from_neighbors(&state.data);
    Json(status(&state.data))
}

#[derive(serde::Deserialize)]
struct InstallBody {
    /// A model id or `engine-<device>`.
    what: String,
}

async fn install_route(State(state): State<AppState>, Json(body): Json<InstallBody>) -> Response {
    match start_install(&state.data, &body.what) {
        Ok(started) => Json(json!({ "started": started, "status": status(&state.data) })).into_response(),
        Err(error) => refused(error),
    }
}

async fn remove_route(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match remove(&state.data, &id) {
        Ok(()) => Json(status(&state.data)).into_response(),
        Err(error) => refused(error),
    }
}

#[derive(serde::Deserialize)]
struct DeviceBody {
    /// `auto`, `cuda`, `vulkan` or `cpu`.
    device: String,
}

async fn device_route(State(state): State<AppState>, Json(body): Json<DeviceBody>) -> Response {
    let device = match body.device.as_str() {
        "auto" | "" => String::new(),
        other => match Device::parse(other) {
            Some(device) => device.as_str().to_string(),
            None => return refused(t!("local-unknown", what = other.to_string())),
        },
    };
    if let Err(error) = crate::settings::update(|settings| settings.local_device = device) {
        return refused(error);
    }
    unload();
    changed();
    Json(status(&state.data)).into_response()
}

async fn unload_route(State(state): State<AppState>) -> Json<Value> {
    let freed = unload();
    changed();
    Json(json!({ "freed": freed, "status": status(&state.data) }))
}

pub fn router() -> Router<AppState> {
    use axum::routing::{delete, get, post, put};
    Router::new()
        .route("/api/local", get(status_route))
        .route("/api/local/install", post(install_route))
        .route("/api/local/models/{id}", delete(remove_route))
        .route("/api/local/device", put(device_route))
        .route("/api/local/unload", post(unload_route))
}
