//! The resource monitor's snapshot: the GPU through NVML and memory through sysinfo, polled by the window
//! once a second at `GET /api/hw/snapshot`.

use std::sync::{Mutex, OnceLock};

use axum::routing::get;
use axum::{Json, Router};
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::Nvml;
use serde::Serialize;
use sysinfo::{Pid, System};

use crate::AppState;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub gpu_name: String,
    pub total_vram: u64,
    pub used_vram: u64,
    pub free_vram: u64,
    pub gpu_utilization: f64,
    pub temperature: f64,
    pub power_draw: f64,
    pub power_limit: f64,
    pub process_ram: u64,
    pub total_ram: u64,
    pub used_ram: u64,
    pub message: String,
}

fn nvml() -> &'static Mutex<Option<Nvml>> {
    static N: OnceLock<Mutex<Option<Nvml>>> = OnceLock::new();
    N.get_or_init(|| Mutex::new(None))
}

fn sysinfo() -> &'static Mutex<System> {
    static S: OnceLock<Mutex<System>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(System::new()))
}

pub fn snapshot() -> HardwareSnapshot {
    let mut snap = HardwareSnapshot::default();
    let mut nvml = nvml().lock().unwrap_or_else(|p| p.into_inner());
    if nvml.is_none() {
        match Nvml::init() {
            Ok(n) => *nvml = Some(n),
            Err(e) => snap.message = format!("NVML init: {e}"),
        }
    }
    if let Some(n) = nvml.as_ref() {
        match n.device_by_index(0) {
            Ok(d) => {
                snap.gpu_name = d.name().unwrap_or_else(|_| "NVIDIA GPU".into());
                if let Ok(m) = d.memory_info() {
                    snap.total_vram = m.total;
                    snap.used_vram = m.used;
                    snap.free_vram = m.free;
                }
                if let Ok(u) = d.utilization_rates() {
                    snap.gpu_utilization = f64::from(u.gpu);
                }
                if let Ok(t) = d.temperature(TemperatureSensor::Gpu) {
                    snap.temperature = f64::from(t);
                }
                if let Ok(p) = d.power_usage() {
                    snap.power_draw = f64::from(p) / 1000.0;
                }
                if let Ok(l) = d.power_management_limit() {
                    snap.power_limit = f64::from(l) / 1000.0;
                }
            }
            Err(e) => snap.message = format!("NVML device: {e}"),
        }
    } else if snap.message.is_empty() {
        snap.message = t!("hw-no-nvidia");
    }
    drop(nvml);

    let mut system = sysinfo().lock().unwrap_or_else(|p| p.into_inner());
    system.refresh_memory();
    snap.total_ram = system.total_memory();
    snap.used_ram = system.used_memory();
    let pid = Pid::from(std::process::id() as usize);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    if let Some(p) = system.process(pid) {
        snap.process_ram = p.memory();
    }
    snap
}

async fn snapshot_route() -> Json<HardwareSnapshot> {
    Json(tokio::task::spawn_blocking(snapshot).await.unwrap_or_default())
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/hw/snapshot", get(snapshot_route))
}
