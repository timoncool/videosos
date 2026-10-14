//! Tauri shell of VideoSOS. It does nothing heavy itself: it runs `vs-server` (axum) inside this process on
//! 127.0.0.1:8796 (`VIDEOSOS_PORT`) and opens the window on that URL. The server serves the window and the API
//! on one origin, and the fixed port keeps that origin, with the window's storage and the agents' address,
//! the same between runs. When VideoSOS already answers on the port the window opens on it; a second start of
//! the release build gives focus to the window already open.
//!
//! Where resources, data, the WebView2 profile and temporary files live is decided by `layout`.

mod layout;

use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use vs_server::service::{self, Claim};
use vs_server::vs_providers::net as vs_providers_net;

fn wait_for_own_service(port: u16, stopped: &Receiver<Result<(), String>>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if service::wait_until_serving(port, Duration::from_millis(500)) {
            return Ok(());
        }
        match stopped.try_recv() {
            Ok(Err(e)) => return Err(vs_server::i18n::text("shell-server-failed", &[("error", e)])),
            Ok(Ok(())) => return Err(vs_server::i18n::text("shell-server-stopped", &[])),
            Err(TryRecvError::Disconnected) => return Err(vs_server::i18n::text("shell-server-crashed", &[])),
            Err(TryRecvError::Empty) => {}
        }
        if Instant::now() >= deadline {
            return Err(vs_server::i18n::text("shell-server-silent", &[("port", port.to_string())]));
        }
    }
}

/// There is no window yet and the console is hidden: a native dialog is the only way to say why.
fn fatal(message: &str) {
    eprintln!("[ERROR] {message}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("VideoSOS")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// The page the embedded server serves this window; anything else opens in the person's browser.
fn own_page(url: &tauri::Url, port: u16) -> bool {
    url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

fn open_in_browser(app: &tauri::AppHandle, url: &tauri::Url) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("[ERROR] the link {url} did not open in the browser: {e}");
    }
}

/// The single-instance lock is named by the identifier, which the installed, portable and dev builds share;
/// only the release build on the default port takes it, so a dev copy beside an installed one still starts.
fn single_instance_wanted() -> bool {
    !cfg!(debug_assertions) && !service::port_is_explicit()
}

fn start_or_reuse_service(repo_root: &std::path::Path) -> Result<u16, String> {
    let port = service::listen_port()?;
    match service::claim_port_on(vs_server::bind_address(repo_root), port, Duration::from_secs(20)).map_err(|busy| busy.to_string())? {
        Claim::Bound(listener) => {
            let root = repo_root.to_path_buf();
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::Builder::new()
                .name("vs-server".into())
                .spawn(move || {
                    let result = vs_server::serve_blocking(&root, listener).map_err(|e| format!("{e:#}"));
                    if let Err(e) = &result {
                        eprintln!("[ERROR] the embedded vs-server stopped: {e}");
                    }
                    let _ = tx.send(result);
                })
                .map_err(|e| e.to_string())?;
            wait_for_own_service(port, &rx)?;
        }
        Claim::AlreadyRunning(running) => {
            eprintln!("VideoSOS {} ({}) already serves 127.0.0.1:{port}: the window opens on it", running.version, running.service_executable);
        }
    }
    Ok(port)
}

/// Checks the GitHub release for an update and installs it when the person agrees. Driven from Rust: the
/// window is loaded from the embedded server's http URL, where Tauri's JS IPC is not given. Only an NSIS
/// installation updates in place; a portable copy is offered the release page.
const RELEASES_URL: &str = "https://github.com/timoncool/videosos/releases/latest";
fn spawn_update_check(app: tauri::AppHandle, portable: bool) {
    use tauri::utils::config::BundleType;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;
    let install_in_place = !portable && tauri::utils::platform::bundle_type() == Some(BundleType::Nsis);
    tauri::async_runtime::spawn(async move {
        // the installer is a child of this process, which sits in a kill-on-close job: it is released first
        let cleanup = app.clone();
        let mut builder = app.updater_builder().on_before_exit(move || {
            cleanup.cleanup_before_exit();
            vs_server::process_group::terminate_group_members();
            if !vs_server::process_group::release_children() {
                eprintln!("[ERROR] the update installer was not released from the program's job object");
            }
        });
        if install_in_place {
            builder = builder.installer_arg(format!("/D={}", layout::executable_directory().display()));
        }
        let Ok(updater) = builder.build() else { return };
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => return,
            Err(e) => {
                eprintln!("[ERROR] the update check failed: {e}");
                return;
            }
        };
        let version = update.version.clone();
        let _ = tauri::async_runtime::spawn_blocking(|| {
            for _ in 0..100 {
                if vs_server::i18n::reported() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        })
        .await;
        let text = |key: &str, args: &[(&'static str, String)]| vs_server::i18n::text(key, args);
        if !install_in_place {
            let open = app
                .dialog()
                .message(text("update-open-page", &[("version", version.clone())]))
                .title(text("update-title", &[]))
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom(text("update-button-open", &[]), text("update-button-later", &[])))
                .blocking_show();
            if open {
                let opened = vs_server::process_group::detach_from_group(&mut std::process::Command::new(if cfg!(windows) { "explorer" } else { "xdg-open" }))
                    .arg(RELEASES_URL)
                    .spawn();
                if let Err(e) = opened {
                    app.dialog()
                        .message(text("update-open-failed", &[("url", RELEASES_URL.to_string()), ("error", e.to_string())]))
                        .title(text("update-title", &[]))
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                }
            }
            return;
        }
        let yes = app
            .dialog()
            .message(text("update-install-now", &[("version", version.clone())]))
            .title(text("update-title", &[]))
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(text("update-button-install", &[]), text("update-button-later", &[])))
            .blocking_show();
        if !yes {
            return;
        }
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(_) => app.restart(),
            Err(e) => {
                app.dialog()
                    .message(text("update-failed", &[("error", e.to_string())]))
                    .title(text("update-title", &[]))
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
            }
        }
    });
}

/// The service's answer to a plain local request: `Err(false)` when nothing listens, `Err(true)` when it did not
/// answer in `wait`.
fn service_call(path: &str, wait: Duration) -> Result<String, bool> {
    use std::io::{Read, Write};
    let Some(port) = service::recorded_port() else { return Err(false) };
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return Err(false);
    };
    let _ = stream.set_read_timeout(Some(wait));
    let request = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\n\r\n");
    let mut response = String::new();
    if stream.write_all(request.as_bytes()).is_err() || stream.read_to_string(&mut response).is_err() {
        return Err(true);
    }
    response.split("\r\n\r\n").nth(1).map(str::to_owned).ok_or(true)
}

/// Generations not finished yet; `None` when the service could not say in `wait`.
fn generations_in_progress(wait: Duration) -> Option<usize> {
    match service_call("/api/jobs?limit=1000", wait) {
        Ok(body) => serde_json::from_str::<serde_json::Value>(&body).ok().and_then(|answer| {
            answer["jobs"].as_array().map(|jobs| {
                jobs.iter().filter(|job| matches!(job["status"].as_str(), Some("queued" | "sending" | "running"))).count()
            })
        }),
        Err(false) => Some(0),
        Err(true) => None,
    }
}

/// Quit, asking first only while a generation is not finished: one being sent, or answered in one request, is
/// lost with the program and may still be paid.
fn confirm_quit(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let running = generations_in_progress(Duration::from_secs(2));
    if running == Some(0) {
        app.exit(0);
        return;
    }
    let text = |key: &str, args: &[(&'static str, String)]| vs_server::i18n::text(key, args);
    let count = running.map_or_else(|| "?".to_string(), |count| count.to_string());
    let mut dialog = app
        .dialog()
        .message(text("quit-running", &[("count", count)]))
        .title(text("quit-title", &[]))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(text("quit-button-quit", &[]), text("quit-button-stay", &[])));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    if dialog.blocking_show() {
        app.exit(0);
    }
}

/// Tauri's own WebView2 switches, the proxy the person chose for what the window loads itself (as in the music
/// studios), and whatever is set in the variable WebView2 documents for exactly this.
#[cfg(windows)]
fn webview_browser_arguments(proxy: &vs_providers_net::ProxySettings) -> String {
    let mut own = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required".to_owned();
    if proxy.mode == vs_providers_net::ProxyMode::Off {
        own.push_str(" --no-proxy-server");
    } else if let Some(url) = proxy.window_proxy().filter(|url| !matches!(url.scheme(), "http" | "socks5")) {
        own.push_str(&format!(" --proxy-server={}://{}:{}", url.scheme(), url.host_str().unwrap_or_default(), url.port_or_known_default().unwrap_or_default()));
    }
    match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Ok(extra) if !extra.trim().is_empty() => format!("{own} {}", extra.trim()),
        _ => own,
    }
}

/// Hides this process's own console window; a console shared with a terminal it was started from is left.
#[cfg(windows)]
fn hide_console_window() {
    extern "system" {
        fn GetConsoleWindow() -> isize;
        fn ShowWindow(hwnd: isize, n_cmd_show: i32) -> i32;
        fn GetConsoleProcessList(lpdw_process_list: *mut u32, dw_process_count: u32) -> u32;
    }
    unsafe {
        let mut pids = [0u32; 4];
        if GetConsoleProcessList(pids.as_mut_ptr(), pids.len() as u32) != 1 {
            return;
        }
        let hwnd = GetConsoleWindow();
        if hwnd != 0 {
            ShowWindow(hwnd, 0);
        }
    }
}

pub fn run() {
    if cfg!(windows) && !vs_server::process_group::bind_children_to_this_process() {
        eprintln!("[ERROR] the process did not join its own job object: ffmpeg children end only with their handles");
    }
    #[cfg(windows)]
    hide_console_window();
    let placed = match layout::resolve().and_then(|l| layout::apply_environment(&l).map(|_| l)) {
        Ok(l) => l,
        Err(e) => layout::fatal(&e),
    };
    let repo_root = placed.server_root;

    let context = tauri::generate_context!();
    service::set_app_version(context.package_info().version.to_string());

    let mut builder = tauri::Builder::default();
    if single_instance_wanted() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let shown = win.unminimize().and_then(|_| win.show()).and_then(|_| win.set_focus());
                if let Err(e) = shown {
                    eprintln!("[ERROR] second start: the VideoSOS window did not come to the front: {e}");
                }
            }
        }));
    }
    builder
        // a plugin's link script answers a click through IPC, which a page on http://127.0.0.1 is not given;
        // left to the webview, a click reaches on_new_window
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let port = match start_or_reuse_service(&repo_root) {
                Ok(p) => p,
                Err(message) => {
                    fatal(&message);
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            let url = format!("http://127.0.0.1:{port}/projects");
            let icon = app.default_window_icon().cloned();
            let (for_tabs, for_links) = (app.handle().clone(), app.handle().clone());
            let proxy = vs_server::settings::saved_proxy(&repo_root.join("data"));
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().expect("a valid URL")));
            #[cfg(windows)]
            let window = window.additional_browser_args(&webview_browser_arguments(&proxy));
            // a proxy of the person's own reaches the window through Tauri where it takes the scheme
            let window = match proxy.window_proxy().filter(|url| matches!(url.scheme(), "http" | "socks5")) {
                Some(url) => window.proxy_url(url),
                None => window,
            };
            let win = window
                .title(format!("VideoSOS {}", app.package_info().version))
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1200.0, 760.0)
                .resizable(true)
                .maximized(true)
                // the webview handles dropped files itself, so the editor's drop zones receive them
                .disable_drag_drop_handler()
                // WebView2 silently drops target=_blank and window.open without a new-window handler
                .on_new_window(move |target, _features| {
                    open_in_browser(&for_tabs, &target);
                    tauri::webview::NewWindowResponse::Deny
                })
                // the window shows only VideoSOS's own page: its microphone requests (the sound outputs' names,
                // the voice-over) are the person's own clicks
                .on_permission_request(move |webview, kind| match kind {
                    tauri::webview::PermissionKind::Microphone if webview.url().is_ok_and(|url| own_page(&url, port)) => {
                        tauri::webview::PermissionResponse::Allow
                    }
                    _ => tauri::webview::PermissionResponse::Default,
                })
                .on_navigation(move |target| {
                    if own_page(target, port) || !matches!(target.scheme(), "http" | "https") {
                        return true;
                    }
                    open_in_browser(&for_links, target);
                    false
                })
                .build()?;
            if let Some(icon) = icon {
                let _ = win.set_icon(icon);
            }
            let dialogs = app.handle().clone();
            vs_server::exports::set_save_dialog(std::sync::Arc::new(move |name: &str, start: Option<std::path::PathBuf>| {
                use tauri_plugin_dialog::DialogExt;
                let mut dialog = dialogs.dialog().file().set_file_name(name);
                if let Some(extension) = std::path::Path::new(name).extension().and_then(|extension| extension.to_str()) {
                    dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
                }
                if let Some(folder) = start {
                    dialog = dialog.set_directory(folder);
                }
                if let Some(window) = dialogs.get_webview_window("main") {
                    dialog = dialog.set_parent(&window);
                }
                dialog.blocking_save_file().and_then(|path| path.into_path().ok())
            }));
            spawn_update_check(app.handle().clone(), layout::is_portable());
            Ok(())
        })
        .build(context)
        .expect("Tauri did not start")
        .run(|app, event| match &event {
            // closing the main window quits on every platform; Cmd+Q and the Dock reach it as an exit request
            // with no code, and an exit the program requests itself carries one and goes through
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                api.prevent_close();
                let app = app.clone();
                std::thread::spawn(move || confirm_quit(&app));
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::ExitRequested { code: None, api, .. } => {
                api.prevent_exit();
                let app = app.clone();
                std::thread::spawn(move || confirm_quit(&app));
            }
            tauri::RunEvent::Exit => vs_server::hub::flush_on_exit(),
            _ => {}
        });
}
