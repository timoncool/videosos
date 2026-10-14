//! Loads a release build of the engine and makes one picture or one video, to check the FFI against a real library:
//! `cargo run -p vs-diffusion --example smoke -- <engine dir> image <diffusion> <llm> <vae> <out.ppm>`
//! `cargo run -p vs-diffusion --example smoke -- <engine dir> video <diffusion> <t5xxl> <vae> <out dir>`

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use vs_diffusion::{Engine, ImageParams, ModelConfig, RawImage, VideoParams};

fn write_ppm(path: &Path, image: &RawImage) {
    let mut file = std::fs::File::create(path).expect("output file");
    write!(file, "P6\n{} {}\n255\n", image.width, image.height).unwrap();
    file.write_all(&image.data).unwrap();
}

fn main() {
    tracing_subscriber_lite();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let engine = Engine::load(Path::new(&args[0])).expect("engine");
    println!("engine {} {}", engine.version(), engine.commit());
    for device in engine.devices() {
        println!("device {device}");
    }
    let started = Instant::now();
    match args[1].as_str() {
        "image" => {
            let config = ModelConfig {
                diffusion_model: Some(PathBuf::from(&args[2])),
                llm: Some(PathBuf::from(&args[3])),
                vae: Some(PathBuf::from(&args[4])),
                offload_to_cpu: true,
                flash_attn: true,
                n_threads: -1,
                ..ModelConfig::default()
            };
            let mut context = engine.new_context(&config).expect("model");
            println!("loaded in {:.1}s, images {}, video {}", started.elapsed().as_secs_f32(), context.makes_images(), context.makes_video());
            let params = ImageParams {
                prompt: "a small red paper boat on a calm lake at sunrise, film photo".into(),
                negative_prompt: String::new(),
                width: 768,
                height: 768,
                steps: 8,
                cfg_scale: 1.0,
                seed: 42,
                sigmas: Vec::new(),
                ref_images: Vec::new(),
                loras: Vec::new(),
            };
            let image = context.image(&params, Some(Box::new(|step, steps| println!("[{}%] step {step}/{steps}", step * 100 / steps.max(1))))).expect("image");
            write_ppm(Path::new(&args[5]), &image);
            println!("[OK] {}x{}x{} in {:.1}s", image.width, image.height, image.channels, started.elapsed().as_secs_f32());
        }
        "video" => {
            let config = ModelConfig {
                diffusion_model: Some(PathBuf::from(&args[2])),
                t5xxl: Some(PathBuf::from(&args[3])),
                vae: Some(PathBuf::from(&args[4])),
                offload_to_cpu: true,
                flash_attn: true,
                n_threads: -1,
                ..ModelConfig::default()
            };
            let mut context = engine.new_context(&config).expect("model");
            println!("loaded in {:.1}s, images {}, video {}", started.elapsed().as_secs_f32(), context.makes_images(), context.makes_video());
            let params = VideoParams {
                prompt: "a small red paper boat drifting on a calm lake at sunrise, gentle ripples".into(),
                negative_prompt: String::new(),
                width: 832,
                height: 480,
                frames: 33,
                fps: 24,
                steps: 20,
                cfg_scale: 5.0,
                flow_shift: 3.0,
                seed: 42,
                first_frame: None,
                last_frame: None,
                loras: Vec::new(),
            };
            let video = context.video(&params, Some(Box::new(|step, steps| println!("[{}%] step {step}/{steps}", step * 100 / steps.max(1))))).expect("video");
            let dir = PathBuf::from(&args[5]);
            std::fs::create_dir_all(&dir).unwrap();
            for (index, frame) in video.frames.iter().enumerate() {
                write_ppm(&dir.join(format!("{index:04}.ppm")), frame);
            }
            println!("[OK] {} frames at {} fps, audio {:?} in {:.1}s", video.frames.len(), video.fps, video.audio.as_ref().map(|a| a.samples.len()), started.elapsed().as_secs_f32());
        }
        other => panic!("unknown mode {other}"),
    }
}

fn tracing_subscriber_lite() {}
