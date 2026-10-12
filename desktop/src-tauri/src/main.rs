// Console subsystem on purpose (not windows_subsystem = "windows"): console children such as ffmpeg inherit
// this one console instead of opening a window each; lib.rs hides the console's own window at start.

fn main() {
    videosos_desktop_lib::run();
}
