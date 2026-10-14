//! Local image and video generation on [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), as
//! Dungeon Ultimate's `du-image` does it: the engine is a library loaded at run time (`stable-diffusion.dll` beside
//! its ggml backends) from one of its release builds, so VideoSOS needs no CMake or CUDA toolchain, and the device
//! is picked by which build is loaded (CUDA, Vulkan or CPU).

pub mod ffi;

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ffi::*;

/// The release the FFI layer follows; another build may lay its structs out differently, so a mismatch is logged.
pub const PINNED_COMMIT: &str = "1d0a58a";

#[derive(Debug, thiserror::Error)]
pub enum DiffusionError {
    #[error("the generation engine is not installed: {0}")]
    LibraryMissing(PathBuf),
    #[error("the generation engine did not load: {0}")]
    Library(#[from] libloading::Error),
    #[error("a text or path has a zero byte: {0}")]
    BadText(String),
    #[error("the model did not load: check its files")]
    ContextCreation,
    #[error("this model makes {0}, not what was asked")]
    WrongKind(&'static str),
    #[error("the generation failed")]
    GenerationFailed,
}

/// Pixels of one picture or frame.
#[derive(Debug, Clone)]
pub struct RawImage {
    pub width: u32,
    pub height: u32,
    /// 3 for RGB.
    pub channels: u32,
    pub data: Vec<u8>,
}

/// Sound a video model made with its frames: interleaved float samples.
#[derive(Debug, Clone)]
pub struct RawAudio {
    pub sample_rate: u32,
    pub channels: u32,
    pub samples: Vec<f32>,
}

/// A generated video.
#[derive(Debug, Clone)]
pub struct RawVideo {
    pub frames: Vec<RawImage>,
    pub fps: u32,
    pub audio: Option<RawAudio>,
}

/// The files of a model and how the engine should hold them.
#[derive(Debug, Clone, Default)]
pub struct ModelConfig {
    pub diffusion_model: Option<PathBuf>,
    /// Wan2.2 A14B's second expert.
    pub high_noise_diffusion_model: Option<PathBuf>,
    /// A language model as the text encoder (Qwen, Gemma).
    pub llm: Option<PathBuf>,
    /// umT5 as the text encoder (Wan).
    pub t5xxl: Option<PathBuf>,
    pub clip_vision: Option<PathBuf>,
    pub embeddings_connectors: Option<PathBuf>,
    pub vae: Option<PathBuf>,
    pub audio_vae: Option<PathBuf>,
    /// Weights stay in RAM and go to the device as they are needed, so models larger than the card run.
    pub offload_to_cpu: bool,
    pub flash_attn: bool,
    /// `cuda0`, `vulkan0`, `cpu`; none lets the engine pick.
    pub backend: Option<String>,
    pub n_threads: i32,
    /// The noise of the processor's generator, which some models are tuned with (MiniMax-H3).
    pub rng_cpu: bool,
}

/// An adapter laid over the model's weights for one call, an accelerator's few-step LoRA among them.
#[derive(Debug, Clone)]
pub struct Lora {
    pub path: PathBuf,
    pub multiplier: f32,
}

/// One picture.
#[derive(Debug, Clone)]
pub struct ImageParams {
    pub prompt: String,
    pub negative_prompt: String,
    pub width: i32,
    pub height: i32,
    /// 0 keeps the model's own.
    pub steps: i32,
    pub cfg_scale: f32,
    pub seed: i64,
    /// A fixed noise schedule a distilled model is trained on; empty keeps the scheduler's.
    pub sigmas: Vec<f32>,
    /// Pictures a model edits from or follows.
    pub ref_images: Vec<RawImage>,
    pub loras: Vec<Lora>,
}

/// The sampler; the engine picks the model's own when it is not named.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum Sampler {
    #[default]
    Engine,
    Euler,
    EulerAncestral,
}

/// A second pass that upscales the first pass's latents with a model and denoises them again.
#[derive(Debug, Clone)]
pub struct Upscale {
    pub model: PathBuf,
    pub scale: f32,
    /// The second pass's sigmas, the closing 0 included.
    pub sigmas: Vec<f32>,
}

/// One video.
#[derive(Debug, Clone)]
pub struct VideoParams {
    pub prompt: String,
    pub negative_prompt: String,
    /// The first pass's size; an upscale pass multiplies it.
    pub width: i32,
    pub height: i32,
    pub frames: i32,
    pub fps: i32,
    /// 0 keeps the model's own.
    pub steps: i32,
    pub cfg_scale: f32,
    /// The video stream's flow shift; 0 keeps the model's own.
    pub flow_shift: f32,
    /// A fixed noise schedule a distilled model is trained on; empty keeps the scheduler's.
    pub sigmas: Vec<f32>,
    pub sampler: Sampler,
    pub seed: i64,
    pub first_frame: Option<RawImage>,
    pub last_frame: Option<RawImage>,
    pub loras: Vec<Lora>,
    pub upscale: Option<Upscale>,
}

type ProgressSink = Box<dyn Fn(i32, i32) + Send + Sync>;

/// The engine has one progress callback for the process; generations run one at a time, so one slot is enough.
static PROGRESS: Mutex<Option<ProgressSink>> = Mutex::new(None);

extern "C" fn progress_trampoline(step: c_int, steps: c_int, _time: f32, _data: *mut c_void) {
    if let Ok(guard) = PROGRESS.lock() {
        if let Some(sink) = guard.as_ref() {
            sink(step, steps);
        }
    }
}

extern "C" fn log_trampoline(level: c_int, text: *const c_char, _data: *mut c_void) {
    if text.is_null() {
        return;
    }
    let message = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let message = message.trim_end();
    match level {
        LOG_ERROR => tracing::error!(target: "sd", "{message}"),
        LOG_WARN => tracing::warn!(target: "sd", "{message}"),
        LOG_INFO => tracing::info!(target: "sd", "{message}"),
        _ => tracing::debug!(target: "sd", "{message}"),
    }
}

macro_rules! symbols {
    ($($name:ident: $ty:ty),* $(,)?) => {
        struct Symbols {
            $($name: $ty,)*
        }
        impl Symbols {
            unsafe fn load(lib: &libloading::Library) -> Result<Self, libloading::Error> {
                Ok(Self {
                    $($name: unsafe { *lib.get(concat!(stringify!($name), "\0").as_bytes())? },)*
                })
            }
        }
    };
}

symbols! {
    sd_version: unsafe extern "C" fn() -> *const c_char,
    sd_commit: unsafe extern "C" fn() -> *const c_char,
    sd_list_devices: unsafe extern "C" fn(*mut c_char, usize) -> usize,
    sd_set_log_callback: unsafe extern "C" fn(SdLogCb, *mut c_void),
    sd_set_progress_callback: unsafe extern "C" fn(SdProgressCb, *mut c_void),
    sd_ctx_params_init: unsafe extern "C" fn(*mut SdCtxParams),
    sd_img_gen_params_init: unsafe extern "C" fn(*mut SdImgGenParams),
    sd_vid_gen_params_init: unsafe extern "C" fn(*mut SdVidGenParams),
    new_sd_ctx: unsafe extern "C" fn(*const SdCtxParams) -> *mut sd_ctx_t,
    free_sd_ctx: unsafe extern "C" fn(*mut sd_ctx_t),
    sd_ctx_supports_image_generation: unsafe extern "C" fn(*const sd_ctx_t) -> bool,
    sd_ctx_supports_video_generation: unsafe extern "C" fn(*const sd_ctx_t) -> bool,
    generate_image: unsafe extern "C" fn(*mut sd_ctx_t, *const SdImgGenParams, *mut *mut SdImage, *mut c_int) -> bool,
    generate_video: unsafe extern "C" fn(*mut sd_ctx_t, *const SdVidGenParams, *mut *mut SdImage, *mut c_int, *mut *mut SdAudio, *mut c_int) -> bool,
    free_sd_images: unsafe extern "C" fn(*mut SdImage, c_int),
    free_sd_audio: unsafe extern "C" fn(*mut SdAudio),
    sd_cancel_generation: unsafe extern "C" fn(*mut sd_ctx_t, c_int),
}

/// The loaded engine; it outlives every context made from it.
pub struct Engine {
    // the libraries are dropped after the symbols that point into them
    symbols: Symbols,
    _lib: libloading::Library,
    _ggml: libloading::Library,
}

impl Engine {
    /// Loads the engine from `dir`, which holds `stable-diffusion.dll` and the ggml backends of one build.
    pub fn load(dir: &Path) -> Result<Self, DiffusionError> {
        let library = dir.join(LIBRARY);
        if !library.is_file() {
            return Err(DiffusionError::LibraryMissing(library));
        }
        // the CUDA backend's own libraries (cudart, cublas) are found through PATH, not beside the backend
        augment_search_path(dir);
        // ggml's backends are found beside the process by default, so they are registered from the engine's folder
        let ggml = unsafe { load_library(&dir.join(GGML))? };
        unsafe {
            let load_all: unsafe extern "C" fn(*const c_char) = *ggml.get(b"ggml_backend_load_all_from_path\0")?;
            let folder = CString::new(dir.to_string_lossy().into_owned()).map_err(|_| DiffusionError::BadText(dir.display().to_string()))?;
            load_all(folder.as_ptr());
        }
        let lib = unsafe { load_library(&library)? };
        let symbols = unsafe { Symbols::load(&lib)? };
        let engine = Engine { symbols, _lib: lib, _ggml: ggml };
        unsafe {
            (engine.symbols.sd_set_log_callback)(log_trampoline, std::ptr::null_mut());
            (engine.symbols.sd_set_progress_callback)(progress_trampoline, std::ptr::null_mut());
        }
        let commit = engine.commit();
        if !commit.starts_with(PINNED_COMMIT) {
            tracing::warn!("the engine is built from {commit}, the FFI follows {PINNED_COMMIT}: compare stable-diffusion.h");
        }
        Ok(engine)
    }

    pub fn version(&self) -> String {
        unsafe { cstr_to_string((self.symbols.sd_version)()) }
    }

    pub fn commit(&self) -> String {
        unsafe { cstr_to_string((self.symbols.sd_commit)()) }
    }

    /// The devices the engine sees, `name<TAB>description` each.
    pub fn devices(&self) -> Vec<String> {
        unsafe {
            let needed = (self.symbols.sd_list_devices)(std::ptr::null_mut(), 0);
            if needed == 0 {
                return Vec::new();
            }
            let mut buffer = vec![0u8; needed + 1];
            (self.symbols.sd_list_devices)(buffer.as_mut_ptr() as *mut c_char, buffer.len());
            let text = CStr::from_ptr(buffer.as_ptr() as *const c_char).to_string_lossy().into_owned();
            text.lines().filter(|line| !line.trim().is_empty()).map(str::to_string).collect()
        }
    }

    /// Loads a model; its memory is freed when the context is dropped.
    pub fn new_context(&self, config: &ModelConfig) -> Result<Context<'_>, DiffusionError> {
        let path = |value: &Option<PathBuf>| value.as_deref().map(path_to_cstring).transpose();
        let diffusion = path(&config.diffusion_model)?;
        let high_noise = path(&config.high_noise_diffusion_model)?;
        let llm = path(&config.llm)?;
        let t5xxl = path(&config.t5xxl)?;
        let clip_vision = path(&config.clip_vision)?;
        let connectors = path(&config.embeddings_connectors)?;
        let vae = path(&config.vae)?;
        let audio_vae = path(&config.audio_vae)?;
        let backend = config.backend.as_deref().map(text).transpose()?;
        let params_backend = config.offload_to_cpu.then(|| CString::new("*=cpu").unwrap());

        let mut params = unsafe {
            let mut params = std::mem::zeroed::<SdCtxParams>();
            (self.symbols.sd_ctx_params_init)(&mut params);
            params
        };
        let set = |slot: &mut *const c_char, value: &Option<CString>| {
            if let Some(value) = value {
                *slot = value.as_ptr();
            }
        };
        set(&mut params.diffusion_model_path, &diffusion);
        set(&mut params.high_noise_diffusion_model_path, &high_noise);
        set(&mut params.llm_path, &llm);
        set(&mut params.t5xxl_path, &t5xxl);
        set(&mut params.clip_vision_path, &clip_vision);
        set(&mut params.embeddings_connectors_path, &connectors);
        set(&mut params.vae_path, &vae);
        set(&mut params.audio_vae_path, &audio_vae);
        set(&mut params.backend, &backend);
        set(&mut params.params_backend, &params_backend);
        params.vae_format = VAE_FORMAT_AUTO;
        params.diffusion_flash_attn = config.flash_attn;
        params.n_threads = config.n_threads;
        params.lora_apply_mode = LORA_APPLY_AUTO;
        if config.rng_cpu {
            params.rng_type = RNG_CPU;
            params.sampler_rng_type = RNG_CPU;
        }

        let ctx = unsafe { (self.symbols.new_sd_ctx)(&params) };
        if ctx.is_null() {
            return Err(DiffusionError::ContextCreation);
        }
        Ok(Context { engine: self, ctx })
    }
}

/// A loaded model.
pub struct Context<'a> {
    engine: &'a Engine,
    ctx: *mut sd_ctx_t,
}

// one generation runs at a time and `&mut self` keeps two from overlapping
unsafe impl Send for Context<'_> {}

/// Stops the generation running on a context from another thread; valid while the context lives.
#[derive(Clone, Copy)]
pub struct Canceller {
    cancel: unsafe extern "C" fn(*mut sd_ctx_t, c_int),
    ctx: *mut sd_ctx_t,
}

// the engine's cancel only sets a flag the sampler reads, made to be called during a generation
unsafe impl Send for Canceller {}
unsafe impl Sync for Canceller {}

impl Canceller {
    pub fn cancel(&self) {
        unsafe { (self.cancel)(self.ctx, CANCEL_ALL) };
    }
}

impl Context<'_> {
    pub fn canceller(&self) -> Canceller {
        Canceller { cancel: self.engine.symbols.sd_cancel_generation, ctx: self.ctx }
    }

    pub fn makes_images(&self) -> bool {
        unsafe { (self.engine.symbols.sd_ctx_supports_image_generation)(self.ctx) }
    }

    pub fn makes_video(&self) -> bool {
        unsafe { (self.engine.symbols.sd_ctx_supports_video_generation)(self.ctx) }
    }

    /// Makes one picture; `progress` hears every sampler step.
    pub fn image(&mut self, params: &ImageParams, progress: Option<ProgressSink>) -> Result<RawImage, DiffusionError> {
        if !self.makes_images() {
            return Err(DiffusionError::WrongKind("video"));
        }
        let prompt = text(&params.prompt)?;
        let negative = text(&params.negative_prompt)?;
        let mut ref_buffers: Vec<Vec<u8>> = params.ref_images.iter().map(|image| image.data.clone()).collect();
        let mut refs: Vec<SdImage> = params.ref_images.iter().zip(ref_buffers.iter_mut()).map(|(image, buffer)| sd_image(image, buffer)).collect();

        let mut request = unsafe {
            let mut request = std::mem::zeroed::<SdImgGenParams>();
            (self.engine.symbols.sd_img_gen_params_init)(&mut request);
            request
        };
        request.prompt = prompt.as_ptr();
        request.negative_prompt = negative.as_ptr();
        request.width = params.width;
        request.height = params.height;
        request.seed = params.seed;
        request.batch_count = 1;
        if params.steps > 0 {
            request.sample_params.sample_steps = params.steps;
        }
        request.sample_params.guidance.txt_cfg = params.cfg_scale;
        let mut sigmas = params.sigmas.clone();
        if !sigmas.is_empty() {
            request.sample_params.custom_sigmas = sigmas.as_mut_ptr();
            request.sample_params.custom_sigmas_count = sigmas.len() as c_int;
        }
        if !refs.is_empty() {
            request.ref_images = refs.as_mut_ptr();
            request.ref_images_count = refs.len() as c_int;
        }
        let (_lora_paths, loras) = lora_list(&params.loras)?;
        request.loras = loras.as_ptr();
        request.lora_count = loras.len() as u32;

        set_progress_sink(progress);
        let mut out: *mut SdImage = std::ptr::null_mut();
        let mut count: c_int = 0;
        let ok = unsafe { (self.engine.symbols.generate_image)(self.ctx, &request, &mut out, &mut count) };
        set_progress_sink(None);
        if !ok || out.is_null() || count <= 0 {
            return Err(DiffusionError::GenerationFailed);
        }
        let mut images = unsafe { self.take_images(out, count) };
        Ok(images.remove(0))
    }

    /// Makes one video, with its sound when the model makes sound.
    pub fn video(&mut self, params: &VideoParams, progress: Option<ProgressSink>) -> Result<RawVideo, DiffusionError> {
        if !self.makes_video() {
            return Err(DiffusionError::WrongKind("pictures"));
        }
        let prompt = text(&params.prompt)?;
        let negative = text(&params.negative_prompt)?;
        let mut first_buffer = params.first_frame.as_ref().map(|image| image.data.clone()).unwrap_or_default();
        let mut last_buffer = params.last_frame.as_ref().map(|image| image.data.clone()).unwrap_or_default();

        let mut request = unsafe {
            let mut request = std::mem::zeroed::<SdVidGenParams>();
            (self.engine.symbols.sd_vid_gen_params_init)(&mut request);
            request
        };
        request.prompt = prompt.as_ptr();
        request.negative_prompt = negative.as_ptr();
        request.width = params.width;
        request.height = params.height;
        request.seed = params.seed;
        request.video_frames = params.frames;
        request.fps = params.fps;
        if params.steps > 0 {
            request.sample_params.sample_steps = params.steps;
        }
        request.sample_params.guidance.txt_cfg = params.cfg_scale;
        if params.flow_shift > 0.0 {
            request.sample_params.flow_shift = params.flow_shift;
        }
        match params.sampler {
            Sampler::Engine => {}
            Sampler::Euler => request.sample_params.sample_method = SAMPLE_EULER,
            Sampler::EulerAncestral => request.sample_params.sample_method = SAMPLE_EULER_A,
        }
        let mut sigmas = params.sigmas.clone();
        if !sigmas.is_empty() {
            request.sample_params.custom_sigmas = sigmas.as_mut_ptr();
            request.sample_params.custom_sigmas_count = sigmas.len() as c_int;
        }
        let upscaler = params.upscale.as_ref().map(|upscale| path_to_cstring(&upscale.model)).transpose()?;
        let mut upscale_sigmas = params.upscale.as_ref().map(|upscale| upscale.sigmas.clone()).unwrap_or_default();
        if let (Some(upscale), Some(model)) = (params.upscale.as_ref(), upscaler.as_ref()) {
            request.hires.enabled = true;
            request.hires.upscaler = HIRES_UPSCALER_MODEL;
            request.hires.model_path = model.as_ptr();
            request.hires.scale = upscale.scale;
            request.hires.steps = upscale_sigmas.len().saturating_sub(1) as c_int;
            request.hires.custom_sigmas = upscale_sigmas.as_mut_ptr();
            request.hires.custom_sigmas_count = upscale_sigmas.len() as c_int;
        }
        if let Some(image) = params.first_frame.as_ref() {
            request.init_image = sd_image(image, &mut first_buffer);
        }
        if let Some(image) = params.last_frame.as_ref() {
            request.end_image = sd_image(image, &mut last_buffer);
        }
        let (_lora_paths, loras) = lora_list(&params.loras)?;
        request.loras = loras.as_ptr();
        request.lora_count = loras.len() as u32;

        set_progress_sink(progress);
        let mut frames: *mut SdImage = std::ptr::null_mut();
        let mut count: c_int = 0;
        let mut audio: *mut SdAudio = std::ptr::null_mut();
        let mut fps: c_int = 0;
        let ok = unsafe { (self.engine.symbols.generate_video)(self.ctx, &request, &mut frames, &mut count, &mut audio, &mut fps) };
        set_progress_sink(None);
        if !ok || frames.is_null() || count <= 0 {
            if !audio.is_null() {
                unsafe { (self.engine.symbols.free_sd_audio)(audio) };
            }
            return Err(DiffusionError::GenerationFailed);
        }
        let frames = unsafe { self.take_images(frames, count) };
        let audio = unsafe { self.take_audio(audio) };
        Ok(RawVideo { frames, fps: if fps > 0 { fps as u32 } else { params.fps.max(1) as u32 }, audio })
    }

    /// Copies the engine's pictures out and hands their memory back: it was allocated by the engine's runtime.
    unsafe fn take_images(&self, out: *mut SdImage, count: c_int) -> Vec<RawImage> {
        let mut images = Vec::with_capacity(count as usize);
        for index in 0..count as usize {
            let raw = unsafe { *out.add(index) };
            let len = (raw.width * raw.height * raw.channel) as usize;
            let data = if raw.data.is_null() || len == 0 { Vec::new() } else { unsafe { std::slice::from_raw_parts(raw.data, len) }.to_vec() };
            images.push(RawImage { width: raw.width, height: raw.height, channels: raw.channel, data });
        }
        unsafe { (self.engine.symbols.free_sd_images)(out, count) };
        images
    }

    unsafe fn take_audio(&self, audio: *mut SdAudio) -> Option<RawAudio> {
        if audio.is_null() {
            return None;
        }
        let raw = unsafe { *audio };
        let len = (raw.sample_count as usize) * (raw.channels as usize);
        let taken = (!raw.data.is_null() && len > 0).then(|| RawAudio {
            sample_rate: raw.sample_rate,
            channels: raw.channels,
            samples: unsafe { std::slice::from_raw_parts(raw.data, len) }.to_vec(),
        });
        unsafe { (self.engine.symbols.free_sd_audio)(audio) };
        taken
    }
}

impl Drop for Context<'_> {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            unsafe { (self.engine.symbols.free_sd_ctx)(self.ctx) };
            self.ctx = std::ptr::null_mut();
        }
    }
}

#[cfg(windows)]
const LIBRARY: &str = "stable-diffusion.dll";
#[cfg(windows)]
const GGML: &str = "ggml.dll";
#[cfg(target_os = "linux")]
const LIBRARY: &str = "libstable-diffusion.so";
#[cfg(target_os = "linux")]
const GGML: &str = "libggml.so";
#[cfg(target_os = "macos")]
const LIBRARY: &str = "libstable-diffusion.dylib";
#[cfg(target_os = "macos")]
const GGML: &str = "libggml.dylib";

fn sd_image(image: &RawImage, buffer: &mut [u8]) -> SdImage {
    SdImage { width: image.width, height: image.height, channel: image.channels, data: buffer.as_mut_ptr() }
}

fn set_progress_sink(sink: Option<ProgressSink>) {
    if let Ok(mut guard) = PROGRESS.lock() {
        *guard = sink;
    }
}

unsafe fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() { String::new() } else { unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned() }
}

fn text(value: &str) -> Result<CString, DiffusionError> {
    CString::new(value).map_err(|_| DiffusionError::BadText(value.chars().take(60).collect()))
}

fn path_to_cstring(path: &Path) -> Result<CString, DiffusionError> {
    text(&path.to_string_lossy())
}

/// The engine's LoRA records point into the returned paths, which must outlive the call.
fn lora_list(loras: &[Lora]) -> Result<(Vec<CString>, Vec<SdLora>), DiffusionError> {
    let paths = loras.iter().map(|lora| path_to_cstring(&lora.path)).collect::<Result<Vec<_>, _>>()?;
    let list = loras.iter().zip(&paths).map(|(lora, path)| SdLora { is_high_noise: false, multiplier: lora.multiplier, path: path.as_ptr() }).collect();
    Ok((paths, list))
}

/// Puts the engine's folder first on PATH once, so its backends' own libraries are found.
fn augment_search_path(dir: &Path) {
    let dir = dir.to_string_lossy();
    let dir = dir.strip_prefix(r"\\?\").unwrap_or(&dir);
    let separator = if cfg!(windows) { ';' } else { ':' };
    let current = std::env::var("PATH").unwrap_or_default();
    if current.split(separator).any(|entry| entry.eq_ignore_ascii_case(dir)) {
        return;
    }
    // SAFETY: set before the engine starts threads of its own; VideoSOS reads PATH only to spawn tools
    unsafe { std::env::set_var("PATH", format!("{dir}{separator}{current}")) };
}

/// A library's own dependencies are searched beside it, not beside the process.
#[cfg(windows)]
unsafe fn load_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
    unsafe { Library::load_with_flags(path, LOAD_WITH_ALTERED_SEARCH_PATH) }.map(Into::into)
}

#[cfg(not(windows))]
unsafe fn load_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    unsafe { libloading::Library::new(path) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_engine_is_reported_as_such() {
        assert!(matches!(Engine::load(Path::new("no-such-folder")).err(), Some(DiffusionError::LibraryMissing(_))));
    }

    /// Sizes and offsets as MSVC lays out the pinned `stable-diffusion.h` on x64 (a C probe compiled against it).
    #[test]
    fn the_structs_keep_the_headers_layout() {
        use std::mem::{offset_of, size_of};
        assert_eq!(size_of::<SdImage>(), 24);
        assert_eq!(size_of::<SdAudio>(), 24);
        assert_eq!(size_of::<SdTilingParams>(), 32);
        assert_eq!(size_of::<SdCtxParams>(), 336);
        assert_eq!(size_of::<SdSampleParams>(), 96);
        assert_eq!(size_of::<SdGuidanceParams>(), 48);
        assert_eq!(size_of::<SdCacheParams>(), 96);
        assert_eq!(size_of::<SdHiresParams>(), 56);
        assert_eq!(size_of::<SdImgGenParams>(), 552);
        assert_eq!(size_of::<SdVidGenParams>(), 584);
        assert_eq!(size_of::<SdRefVideo>(), 40);
        assert_eq!(size_of::<SdLora>(), 16);
        assert_eq!(size_of::<SdPmParams>(), 32);
        assert_eq!(offset_of!(SdVidGenParams, seed), 360);
        assert_eq!(offset_of!(SdVidGenParams, video_frames), 368);
        assert_eq!(offset_of!(SdVidGenParams, image_preprocess), 576);
        assert_eq!(offset_of!(SdCtxParams, vae_format), 216);
        assert_eq!(offset_of!(SdCtxParams, flash_attn_mode), 320);
        assert_eq!(offset_of!(SdImgGenParams, image_preprocess), 544);
    }
}
