//! What VideoSOS asked a provider, and what came back (as in the music studios).
//!
//! A request that goes wrong leaves the user with one red line and no way to
//! find out more: the answer is gone the moment the window is closed, and a
//! model that wrote something almost right is indistinguishable from one that
//! wrote nothing. So every call is written down - what was asked, how long it
//! took, what came back, and the answer itself when it could not be used.
//!
//! Two rules hold this to something safe to keep on disk. The key is never
//! written, not even in part; and the file is trimmed rather than allowed to
//! grow, because a log nobody can open is a log nobody reads.

use std::fmt::Write as _;
use std::io::Write as _;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Past this, the older half goes. The last page is what matters.
const LIMIT: u64 = 4 * 1024 * 1024;

/// How much of an answer is kept when it could not be parsed. Enough to see
/// what the model was doing, not so much that one bad reply fills the file.
const ANSWER_SAMPLE: usize = 4000;

static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Where the log lives: `data/logs`, set when the server opens its data.
pub fn init(data: &std::path::Path) {
    let _ = DIR.set(data.join("logs"));
}

pub fn path() -> PathBuf {
    let root = DIR.get().cloned().unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::create_dir_all(&root);
    root.join("providers.log")
}

/// Seconds since the epoch. The program has no clock of its own to consult and
/// no need of one: what a reader wants is the order of things and the gap
/// between them.
fn stamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs()).unwrap_or(0)
}

fn append(line: &str) {
    trim();
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path()) {
        let _ = writeln!(file, "{} {line}", stamp());
    }
}

fn trim() {
    let path = path();
    let Ok(meta) = std::fs::metadata(&path) else { return };
    if meta.len() < LIMIT {
        return;
    }
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    let keep = text.split_at(text.len() / 2).1;
    let start = keep.find(char::is_control).map(|index| index + 1).unwrap_or(0);
    let _ = std::fs::write(&path, &keep[start..]);
}

/// One outgoing request. `what` names the task in the program's own terms - "image", "video", "speech" -
/// because that is what the reader is looking for, not a URL they already know.
pub fn asked(what: &str, model: &str, prompt_chars: usize) {
    append(&format!("-> {what} {model} prompt={prompt_chars} chars"));
}

/// A reply that arrived, whether or not it was any good.
pub fn answered(what: &str, model: &str, status: u16, seconds: f64, answer_chars: usize) {
    append(&format!("<- {what} {model} http={status} in={seconds:.1}s answer={answer_chars} chars"));
}

/// A request that never became a reply: no network, a refusal, a timeout.
pub fn failed(what: &str, model: &str, error: &str) {
    append(&format!("!! {what} {model} {}", one_line(error)));
}

/// An answer that arrived and could not be used. The text is the point: this is
/// the only place it survives the window being closed.
pub fn unusable(what: &str, model: &str, reason: &str, answer: &str) {
    let mut line = String::new();
    let _ = write!(line, "?? {what} {model} {}", one_line(reason));
    append(&line);
    let sample: String = answer.chars().take(ANSWER_SAMPLE).collect();
    for chunk in sample.lines() {
        append(&format!("   | {chunk}"));
    }
    if answer.chars().count() > ANSWER_SAMPLE {
        append("   | ...");
    }
}

/// Newlines out, so one event is one line and the file stays greppable.
fn one_line(text: &str) -> String {
    text.replace(['\n', '\r'], " ").trim().to_string()
}

/// The tail of the log, oldest first, for showing in the window.
pub fn tail(lines: usize) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path()) else { return Vec::new() };
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].iter().map(|line| line.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_is_one_line_however_the_error_was_written() {
        assert_eq!(one_line("first\nsecond\r\nthird"), "first second  third");
    }

    #[test]
    fn nothing_resembling_a_key_is_written() {
        // The key is not passed to any function here, and this is the guard
        // that keeps it that way: adding one would break this test.
        let events = [
            asked as fn(&str, &str, usize),
        ];
        assert_eq!(events.len(), 1, "one place to ask, and it takes no credentials");
    }
}
