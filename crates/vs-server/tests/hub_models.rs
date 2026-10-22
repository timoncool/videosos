use serde_json::Value;
use vs_providers::Provider;
use vs_server::jobs::Job;

fn job(provider: Provider, model: &str, task: &str, status: &str) -> Job {
    Job {
        id: format!("{}-{model}", provider.as_str()),
        project_id: None,
        provider,
        model: model.into(),
        model_name: model.into(),
        title: String::new(),
        task: task.into(),
        values: Value::Null,
        status: status.into(),
        progress: None,
        error: None,
        error_code: None,
        estimate: None,
        cost: None,
        cost_source: None,
        outputs: Vec::new(),
        imported: Value::Null,
        place: false,
        place_at: None,
        liked: false,
        origin: "window".into(),
        created: 0,
        updated: 0,
        handle: None,
    }
}

#[test]
fn every_finished_generation_reports_its_model_by_provider() {
    let shared = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    // SAFETY: the only test of this binary, set before anything reads the environment.
    unsafe {
        std::env::set_var("TIMONCOOL_SHARED_DIR", shared.path());
        std::env::remove_var("DO_NOT_TRACK");
        std::env::remove_var("STUDIO_TELEMETRY");
    }
    let hub = studio_hub_client::Hub::new(studio_hub_client::HubConfig {
        app: "videosos".into(),
        version: "0.0.0".into(),
        data_dir: data.path().to_path_buf(),
        http: reqwest::Client::new(),
        os_label: "test".into(),
        gpu: studio_hub_client::Gpu { vendor: "other".into(), vram_gb: "?".into(), backend: "vulkan".into() },
        ui_lang: "en".into(),
        urls: vec!["http://127.0.0.1:9".into()],
    })
    .unwrap();
    hub.acknowledge(true);

    let models = [
        (Provider::Openrouter, "google/gemini-2.5-flash-image", "image"),
        (Provider::Runware, "runware:100@1", "image"),
        (Provider::Fal, "fal-ai/kling-video/v2.1/master/image-to-video", "video"),
        (Provider::Local, "speech-studio:supertonic", "speech"),
    ];
    for (provider, model, task) in models {
        vs_server::hub::record_job_end(&hub, &job(provider, model, task, "done"));
    }
    vs_server::hub::record_job_end(&hub, &job(Provider::Fal, "fal-ai/flux/schnell", "image", "failed"));

    let state: Value = serde_json::from_slice(&std::fs::read(data.path().join("studio-hub.json")).unwrap()).unwrap();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let day = &state["days"][&today];
    let sets: Vec<(String, Vec<String>, u64)> = day["model_sets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|set| {
            let components = set["components"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
            (set["set"].as_str().unwrap().to_string(), components, set["count"].as_u64().unwrap())
        })
        .collect();
    for (provider, model, _) in models {
        assert!(
            sets.contains(&(provider.as_str().to_string(), vec![model.to_string()], 1)),
            "{} {model} missing from {sets:?}",
            provider.as_str()
        );
    }
    assert_eq!(sets.len(), models.len(), "a failed generation reports no model: {sets:?}");
    assert_eq!(day["counts"]["image_done"], 2);
    assert_eq!(day["counts"]["image_failed"], 1);
}
