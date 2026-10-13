//! Owns the Node bridge sidecar process.
//!
//! The frontend never talks to the process directly: it calls `bridge_start` /
//! `bridge_send` and receives each stdout line as a `bridge://line` event. The
//! lines are NDJSON defined by the `@programish/protocol` package; Rust treats
//! them as opaque strings so the protocol lives in exactly one place (TypeScript).

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, State};

const LINE_EVENT: &str = "bridge://line";

struct Running {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct BridgeState(Mutex<Option<Running>>);

/// Dev builds run the bundled script straight from the workspace. Packaging the
/// sidecar for release (embedding a Node runtime) is a later phase.
fn entry_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("PROGRAMISH_BRIDGE_ENTRY") {
        return Ok(PathBuf::from(path));
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/bridge/dist/main.mjs"));
    }
    Err("Bridge packaging is not implemented yet; set PROGRAMISH_BRIDGE_ENTRY.".into())
}

fn spawn_bridge() -> Result<Child, String> {
    let entry = entry_path()?;
    if !entry.exists() {
        return Err(format!(
            "Bridge entry not found at {}. Run `pnpm --filter @programish/bridge build`.",
            entry.display()
        ));
    }
    let mut command = Command::new("node");
    command
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: don't flash a console for the sidecar on Windows.
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|e| format!("Failed to start `node` (is Node.js installed and on PATH?): {e}"))
}

/// Starts the sidecar if it isn't already running. Idempotent.
#[tauri::command]
pub fn bridge_start(app: AppHandle, state: State<'_, BridgeState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "bridge state poisoned")?;

    // A crashed sidecar must be restartable, so check liveness instead of trusting the Option.
    if let Some(running) = guard.as_mut() {
        if matches!(running.child.try_wait(), Ok(None)) {
            return Ok(());
        }
        *guard = None;
    }

    let mut child = spawn_bridge()?;
    let stdin = child.stdin.take().ok_or("bridge stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("bridge stderr unavailable")?;

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            // Emit failures only mean the window is gone; nothing useful to do.
            let _ = app.emit(LINE_EVENT, line);
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("{line}");
        }
    });

    *guard = Some(Running { child, stdin });
    Ok(())
}

/// Writes one protocol line to the sidecar's stdin.
#[tauri::command]
pub fn bridge_send(state: State<'_, BridgeState>, line: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "bridge state poisoned")?;
    let running = guard.as_mut().ok_or("bridge is not running")?;
    let line = line.trim_end_matches('\n');
    writeln!(running.stdin, "{line}")
        .and_then(|_| running.stdin.flush())
        .map_err(|e| format!("failed to write to bridge: {e}"))
}
