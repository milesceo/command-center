//! Owns the Node bridge sidecar process.
//!
//! The frontend never talks to the process directly: it calls `bridge_start` /
//! `bridge_send` and receives each stdout line as a `bridge://line` event. The
//! lines are NDJSON defined by the `@programish/protocol` package; Rust treats
//! them as opaque strings so the protocol lives in exactly one place (TypeScript).

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

const LINE_EVENT: &str = "bridge://line";
/// Fired when the sidecar's stdout closes, so the UI can fail in-flight chats instead of hanging.
const EXIT_EVENT: &str = "bridge://exit";

struct Running {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct BridgeState(Mutex<Option<Running>>);

/// How to start the bridge: a program, its arguments and extra environment.
#[derive(Debug, PartialEq, Eq)]
struct Launch {
    program: PathBuf,
    args: Vec<PathBuf>,
    env: Vec<(&'static str, PathBuf)>,
}

/// Tauri can hand back Windows paths in verbatim form (`\\?\D:\app\...`). Node resolves those
/// wrongly (it fails with `EISDIR: lstat 'D:'`), so drop the prefix; UNC paths keep theirs.
fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path,
    }
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// The installed layout: Tauri puts the external `node` binary beside the app executable and
/// copies `resources/bridge/*` (the bundled bridge and the SDK's Claude runtime) into the
/// resource directory. Nothing here needs Node, npm or the repository on the user's machine.
fn installed_launch(exe_dir: &Path, resource_dir: &Path) -> Result<Launch, String> {
    let node = exe_dir.join(exe_name("node"));
    let bridge = resource_dir.join("bridge");
    let main = bridge.join("main.mjs");
    let claude = bridge.join(exe_name("claude"));
    for (what, path) in [
        ("Node runtime", &node),
        ("bridge", &main),
        ("Claude runtime", &claude),
    ] {
        if !path.is_file() {
            return Err(format!(
                "The {what} is missing at {}. Reinstall Programish.",
                path.display()
            ));
        }
    }
    Ok(Launch {
        program: node,
        args: vec![main],
        env: vec![("PROGRAMISH_CLAUDE_EXECUTABLE", claude)],
    })
}

/// The first real `node` on PATH. Windows' CreateProcess searches the app's own folder before
/// PATH, and `tauri dev` leaves an empty placeholder `node.exe` there (error 193), so a bare
/// `node` would pick that up. Empty files are skipped for the same reason.
fn find_on_path(base: &str) -> Option<PathBuf> {
    let name = exe_name(base);
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(&name))
        .find(|p| p.metadata().is_ok_and(|m| m.is_file() && m.len() > 0))
}

/// Development: the workspace bundle run by the `node` on PATH, with the SDK finding its own runtime.
fn dev_launch(entry: PathBuf) -> Result<Launch, String> {
    if !entry.exists() {
        return Err(format!(
            "Bridge entry not found at {}. Run `pnpm --filter @programish/bridge build`.",
            entry.display()
        ));
    }
    Ok(Launch {
        program: find_on_path("node").unwrap_or_else(|| PathBuf::from("node")),
        args: vec![entry],
        env: vec![],
    })
}

fn resolve_launch(app: &AppHandle) -> Result<Launch, String> {
    if let Ok(path) = std::env::var("PROGRAMISH_BRIDGE_ENTRY") {
        return dev_launch(PathBuf::from(path));
    }
    if cfg!(debug_assertions) {
        return dev_launch(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../packages/bridge/dist/main.mjs"),
        );
    }
    let exe = std::env::current_exe().map_err(|e| format!("Cannot locate the app: {e}"))?;
    let exe_dir = exe.parent().ok_or("Cannot locate the app folder.")?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot locate the app resources: {e}"))?;
    installed_launch(
        &plain_path(exe_dir.to_path_buf()),
        &plain_path(resource_dir),
    )
}

fn spawn_bridge(app: &AppHandle) -> Result<Child, String> {
    let launch = resolve_launch(app)?;
    let mut command = Command::new(&launch.program);
    command
        .args(&launch.args)
        .envs(launch.env.iter().map(|(k, v)| (*k, v)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: don't flash a console for the sidecar on Windows.
        command.creation_flags(0x0800_0000);
    }

    command.spawn().map_err(|e| {
        format!(
            "Failed to start the bridge ({}): {e}",
            launch.program.display()
        )
    })
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

    let mut child = spawn_bridge(&app)?;
    let stdin = child.stdin.take().ok_or("bridge stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("bridge stderr unavailable")?;

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            // Emit failures only mean the window is gone; nothing useful to do.
            let _ = app.emit(LINE_EVENT, line);
        }
        let _ = app.emit(EXIT_EVENT, ());
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("programish-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn installed_layout_runs_the_bundled_node_with_the_bundled_runtime() {
        let root = scratch("installed");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&exe_dir.join(exe_name("node")));
        touch(&res.join("bridge/main.mjs"));
        touch(&res.join("bridge").join(exe_name("claude")));

        let launch = installed_launch(&exe_dir, &res).unwrap();
        assert_eq!(launch.program, exe_dir.join(exe_name("node")));
        assert_eq!(launch.args, vec![res.join("bridge/main.mjs")]);
        assert_eq!(
            launch.env,
            vec![(
                "PROGRAMISH_CLAUDE_EXECUTABLE",
                res.join("bridge").join(exe_name("claude"))
            )]
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_missing_piece_is_named_in_the_error() {
        let root = scratch("missing");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&exe_dir.join(exe_name("node")));
        touch(&res.join("bridge/main.mjs"));

        let err = installed_launch(&exe_dir, &res).unwrap_err();
        assert!(err.contains("Claude runtime"), "{err}");
        assert!(err.contains("Reinstall"), "{err}");

        fs::remove_file(res.join("bridge/main.mjs")).unwrap();
        assert!(installed_launch(&exe_dir, &res)
            .unwrap_err()
            .contains("bridge"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn verbatim_windows_prefixes_are_dropped_but_unc_paths_are_kept() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\D:\a\_temp\Programish")),
            PathBuf::from(r"D:\a\_temp\Programish")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
        assert_eq!(
            plain_path(PathBuf::from("/usr/lib/Programish")),
            PathBuf::from("/usr/lib/Programish")
        );
    }

    #[test]
    fn dev_launch_needs_the_built_bundle() {
        let err = dev_launch(PathBuf::from("/definitely/not/here.mjs")).unwrap_err();
        assert!(err.contains("pnpm --filter @programish/bridge build"));
    }
}
