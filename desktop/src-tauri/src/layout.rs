//! Раскладка каталогов оболочки: откуда читаются ресурсы установки и где лежат изменяемые данные
//! (модели, workspace, библиотека кастинга, профиль WebView2, временные файлы).
//!
//! Данные живут рядом с exe всегда, когда туда можно писать (модели весят десятки ГБ, и тот, кто
//! поставил студию в F:\AI, не ждёт их на диске C:). Запасной путь %LOCALAPPDATA%\Dub Studio нужен
//! только там, где каталог установки недоступен для записи (MSI в Program Files, общий ресурс
//! только для чтения). Портативная копия (маркер `portable.flag` рядом с exe) запасного пути не имеет:
//! ей нечем заменить свою папку, поэтому недоступная для записи папка — явная ошибка.

use std::fs;
use std::path::{Path, PathBuf};

pub const DATA_DIRECTORY_NAME: &str = "Dub Studio";
pub const PORTABLE_MARKER: &str = "portable.flag";

/// Ресурсы бандла (`bundle.resources` в tauri.bundle.conf.json): установщик кладёт их рядом с exe.
/// Когда данные уезжают в запасной каталог, сервер ищет их там же, где и скачанные модели, поэтому
/// поставляемые файлы копируются туда.
const BUNDLED_RESOURCES: [&str; 4] = [
    "frontend/dist",
    "fonts",
    "models/ocr",
    "models/higgs-engine",
];

pub struct Layout {
    /// Корень, который получает `dub_server::serve_blocking`: ресурсы, models/, workspace/ и остальные данные.
    pub server_root: PathBuf,
    /// Где лежат профиль WebView2 и (если `redirect_temp`) временные файлы.
    pub state_root: PathBuf,
    /// TEMP/TMP переводятся в `<state_root>/temp`. Только для установленной и портативной раскладок:
    /// dev-запуск и явный DUB_STUDIO_ROOT системный TEMP не трогают.
    pub redirect_temp: bool,
}

pub fn executable_directory() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Портативной копию делает только маркер, который кладёт скрипт сборки в zip.
pub fn is_portable() -> bool {
    executable_directory().join(PORTABLE_MARKER).is_file()
}

/// Реальная запись и удаление пробного файла: права каталога по атрибутам не определить.
pub fn directory_is_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    if fs::write(&probe, b"").is_err() {
        return false;
    }
    let _ = fs::remove_file(&probe);
    true
}

/// Каталог данных при установленной/портативной раскладке. Чистая функция: все входы явные.
pub fn choose_data_directory(
    executable_dir: &Path,
    portable: bool,
    local_app_data: Option<&Path>,
) -> Result<PathBuf, String> {
    if directory_is_writable(executable_dir) {
        return Ok(executable_dir.to_path_buf());
    }
    if portable {
        return Err(format!(
            "Portable copy lives in a folder that cannot be written to: {}\nMove the folder somewhere writable.\n\nПортативная копия лежит в папке без права записи: {}\nПеренесите папку туда, где можно писать.",
            executable_dir.display(),
            executable_dir.display()
        ));
    }
    let Some(base) = local_app_data else {
        return Err(format!(
            "Cannot write next to the program ({}) and %LOCALAPPDATA% is not set.\n\nНельзя писать рядом с программой ({}), а переменная %LOCALAPPDATA% не задана.",
            executable_dir.display(),
            executable_dir.display()
        ));
    };
    let data = base.join(DATA_DIRECTORY_NAME);
    if !directory_is_writable(&data) {
        return Err(format!(
            "Cannot write to {}\n\nНельзя писать в {}",
            data.display(),
            data.display()
        ));
    }
    Ok(data)
}

/// Копирует файл, если его нет в приёмнике, размер другой или источник новее. Ошибка копирования —
/// явная: без поставляемых моделей OCR и VC++-рантайма студия всё равно не заработает.
fn copy_tree_if_changed(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("{}: {e}", dst.display()))?;
    let entries = fs::read_dir(src).map_err(|e| format!("{}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{}: {e}", src.display()))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = entry.metadata().map_err(|e| format!("{}: {e}", from.display()))?;
        if meta.is_dir() {
            copy_tree_if_changed(&from, &to)?;
            continue;
        }
        let up_to_date = match fs::metadata(&to) {
            Ok(existing) => {
                existing.len() == meta.len()
                    && match (existing.modified(), meta.modified()) {
                        (Ok(d), Ok(s)) => d >= s,
                        _ => false,
                    }
            }
            Err(_) => false,
        };
        if !up_to_date {
            fs::copy(&from, &to)
                .map_err(|e| format!("{} -> {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Переносит поставляемые ресурсы из каталога установки в каталог данных (запасной путь).
pub fn stage_bundled_resources(executable_dir: &Path, data_dir: &Path) -> Result<(), String> {
    for rel in BUNDLED_RESOURCES {
        let src = executable_dir.join(rel);
        if !src.is_dir() {
            continue;
        }
        copy_tree_if_changed(&src, &data_dir.join(rel))?;
    }
    Ok(())
}

fn installed_layout(executable_dir: &Path) -> bool {
    executable_dir.join("frontend").is_dir() && executable_dir.join("models").is_dir()
}

/// Linux-пакет (deb и AppImage): exe в usr/bin, ресурсы бандла в usr/lib/<productName>, оба только для чтения.
fn linux_package_resources(executable_dir: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let resources = executable_dir.parent()?.join("lib").join(DATA_DIRECTORY_NAME);
    installed_layout(&resources).then_some(resources)
}

/// Данные Linux-пакета: $XDG_DATA_HOME/dub-studio, иначе ~/.local/share/dub-studio.
fn linux_data_directory() -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(root).join("dub-studio"));
    }
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(|home| PathBuf::from(home).join(".local").join("share").join("dub-studio"))
        .ok_or_else(|| "Neither XDG_DATA_HOME nor HOME is set: there is nowhere to keep the models.\n\nНе заданы ни XDG_DATA_HOME, ни HOME: моделям негде лежать.".to_string())
}

pub fn resolve() -> Result<Layout, String> {
    let exe_dir = executable_directory();

    if let Ok(root) = std::env::var("DUB_STUDIO_ROOT") {
        return Ok(Layout {
            server_root: PathBuf::from(root),
            state_root: exe_dir,
            redirect_temp: false,
        });
    }

    if installed_layout(&exe_dir) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let data = choose_data_directory(&exe_dir, is_portable(), local.as_deref())?;
        if data != exe_dir {
            stage_bundled_resources(&exe_dir, &data)?;
        }
        return Ok(Layout {
            server_root: data.clone(),
            state_root: data,
            redirect_temp: true,
        });
    }

    if let Some(resources) = linux_package_resources(&exe_dir) {
        let data = linux_data_directory()?;
        if !directory_is_writable(&data) {
            return Err(format!("Cannot write to {}\n\nНельзя писать в {}", data.display(), data.display()));
        }
        stage_bundled_resources(&resources, &data)?;
        return Ok(Layout {
            server_root: data.clone(),
            state_root: data,
            redirect_temp: true,
        });
    }

    // Dev: exe в …/desktop/src-tauri/target/<profile>/. Поднимаемся до каталога с crates/.
    let mut d = exe_dir.as_path();
    for _ in 0..6 {
        if d.join("crates").is_dir() && d.join("frontend").is_dir() {
            return Ok(Layout {
                server_root: d.to_path_buf(),
                state_root: exe_dir,
                redirect_temp: false,
            });
        }
        match d.parent() {
            Some(p) => d = p,
            None => break,
        }
    }
    Ok(Layout {
        server_root: exe_dir.clone(),
        state_root: exe_dir,
        redirect_temp: false,
    })
}

/// Вызывать ДО старта потоков и Tauri: set_var небезопасен при параллельном чтении окружения.
pub fn apply_environment(layout: &Layout) -> Result<(), String> {
    if layout.redirect_temp {
        let temp = layout.state_root.join("temp");
        fs::create_dir_all(&temp).map_err(|e| format!("{}: {e}", temp.display()))?;
        for var in ["TEMP", "TMP"] {
            std::env::set_var(var, &temp);
        }
    }
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        std::env::set_var(
            "WEBVIEW2_USER_DATA_FOLDER",
            layout.state_root.join("webview-data"),
        );
    }
    Ok(())
}

/// Фатальная ошибка старта: окно Tauri ещё не создано, поэтому системный MessageBox.
#[cfg(windows)]
pub fn fatal(message: &str) -> ! {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    let wide = |s: &str| -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    };
    eprintln!("[ERROR] {message}");
    let text = wide(message);
    let caption = wide("Dub Studio");
    unsafe {
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x10);
    }
    std::process::exit(1);
}

#[cfg(not(windows))]
pub fn fatal(message: &str) -> ! {
    eprintln!("[ERROR] {message}");
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dub-layout-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writable_directory_is_kept() {
        let exe = scratch("writable");
        let chosen = choose_data_directory(&exe, false, None).unwrap();
        assert_eq!(chosen, exe);
        assert!(!exe.join(".write-probe").exists());
        let _ = fs::remove_dir_all(&exe);
    }

    #[test]
    fn unwritable_directory_falls_back_to_local_app_data() {
        let base = scratch("fallback");
        let blocker = base.join("blocker");
        fs::write(&blocker, b"file, not a directory").unwrap();
        let exe = blocker.join("app");
        let local = base.join("local");
        let chosen = choose_data_directory(&exe, false, Some(&local)).unwrap();
        assert_eq!(chosen, local.join(DATA_DIRECTORY_NAME));
        assert!(chosen.is_dir());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn portable_never_leaves_its_folder() {
        let base = scratch("portable");
        let blocker = base.join("blocker");
        fs::write(&blocker, b"x").unwrap();
        let exe = blocker.join("app");
        let local = base.join("local");
        assert!(choose_data_directory(&exe, true, Some(&local)).is_err());
        assert!(!local.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_local_app_data_is_an_error() {
        let base = scratch("nolocal");
        let blocker = base.join("blocker");
        fs::write(&blocker, b"x").unwrap();
        assert!(choose_data_directory(&blocker.join("app"), false, None).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn bundled_resources_are_copied_and_refreshed() {
        let base = scratch("stage");
        let exe = base.join("exe");
        let data = base.join("data");
        fs::create_dir_all(exe.join("models/ocr")).unwrap();
        fs::create_dir_all(exe.join("fonts")).unwrap();
        fs::write(exe.join("models/ocr/det.onnx"), b"one").unwrap();
        fs::write(exe.join("fonts/a.ttf"), b"font").unwrap();

        stage_bundled_resources(&exe, &data).unwrap();
        assert_eq!(fs::read(data.join("models/ocr/det.onnx")).unwrap(), b"one");
        assert_eq!(fs::read(data.join("fonts/a.ttf")).unwrap(), b"font");
        assert!(!data.join("models/higgs-engine").exists());

        // downloaded file next to bundled ones survives
        fs::write(data.join("models/ocr/extra.bin"), b"downloaded").unwrap();
        fs::write(exe.join("models/ocr/det.onnx"), b"second").unwrap();
        stage_bundled_resources(&exe, &data).unwrap();
        assert_eq!(fs::read(data.join("models/ocr/det.onnx")).unwrap(), b"second");
        assert_eq!(fs::read(data.join("models/ocr/extra.bin")).unwrap(), b"downloaded");
        let _ = fs::remove_dir_all(&base);
    }
}
