//! Owns the Node bridge sidecar process.
//!
//! The frontend never talks to the process directly: it calls `bridge_start` /
//! `bridge_send` and receives each stdout line as a `bridge://line` event. The
//! lines are NDJSON defined by the `@command-center/protocol` package; Rust treats
//! them as opaque strings so the protocol lives in exactly one place (TypeScript).

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

const LINE_EVENT: &str = "bridge://line";
/// Fired when the sidecar's stdout closes, so the UI can fail in-flight chats instead of hanging.
/// The payload is the generation `bridge_start` returned for that process, so an exit that arrives
/// late (after an idle stop and a fresh start) is not mistaken for the new bridge dying.
const EXIT_EVENT: &str = "bridge://exit";

struct Running {
    child: Child,
    stdin: ChildStdin,
    generation: u64,
}

#[derive(Default)]
pub struct BridgeState {
    running: Mutex<Option<Running>>,
    generations: std::sync::atomic::AtomicU64,
}

/// The lite build's search PATH, kept once `node` and `claude` were both found on it, so the login
/// shell is not read again on every start (a failed search is retried, so installing Node later
/// works without restarting the app).
static LITE_SEARCH_PATH: Mutex<Option<std::ffi::OsString>> = Mutex::new(None);

fn lite_search_path() -> std::ffi::OsString {
    if let Some(path) = LITE_SEARCH_PATH.lock().ok().and_then(|p| p.clone()) {
        return path;
    }
    crate::gui_path::search_path()
}

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

/// Written by `scripts/prepare-sidecar.mjs --lite` into `resources/bridge/`: this build bundles
/// neither Node nor the Claude runtime and uses the ones installed on the machine.
const LITE_MARKER: &str = "lite";

const LITE_NO_NODE: &str = "This lite build of Command Center uses the Node.js installed on this \
computer, but none was found. Install Node.js 22 or newer (for example `brew install node`), or use \
the full build, which brings its own.";
const LITE_NO_CLAUDE: &str = "This lite build of Command Center uses the Claude Code installed on \
this computer, but none was found. Install it (`npm i -g @anthropic-ai/claude-code`, then run \
`claude` once to sign in), or use the full build, which brings its own runtime.";

/// The installed layout: Tauri puts the external `node` binary beside the app executable and
/// copies `resources/bridge/*` (the bundled bridge and the SDK's Claude runtime) into the
/// resource directory. Nothing here needs Node, npm or the repository on the user's machine.
/// A lite build (`LITE_MARKER`) instead finds `node` and `claude` on `search_path()`, the PATH a
/// login shell would have (an app opened from the Dock does not get it), and passes that PATH on.
fn installed_launch(
    exe_dir: &Path,
    resource_dir: &Path,
    search_path: impl FnOnce() -> std::ffi::OsString,
) -> Result<Launch, String> {
    let bridge = resource_dir.join("bridge");
    let main = bridge.join("main.mjs");
    if bridge.join(LITE_MARKER).is_file() {
        // Check the bundle first: the search reads the login shell and takes a moment.
        if !main.is_file() {
            return Err(format!(
                "The bridge is missing at {}. Reinstall Command Center.",
                main.display()
            ));
        }
        return lite_launch(main, search_path());
    }
    let node = exe_dir.join(exe_name("node"));
    let claude = bridge.join(exe_name("claude"));
    for (what, path) in [
        ("Node runtime", &node),
        ("bridge", &main),
        ("Claude runtime", &claude),
    ] {
        // An empty file is a build stand-in (`--placeholder`), not a program.
        if !path.metadata().is_ok_and(|m| m.is_file() && m.len() > 0) {
            return Err(format!(
                "The {what} is missing at {}. Reinstall Command Center.",
                path.display()
            ));
        }
    }
    Ok(Launch {
        program: node,
        args: vec![main],
        env: vec![("COMMAND_CENTER_CLAUDE_EXECUTABLE", claude)],
    })
}

fn lite_launch(main: PathBuf, path: std::ffi::OsString) -> Result<Launch, String> {
    if !main.is_file() {
        return Err(format!(
            "The bridge is missing at {}. Reinstall Command Center.",
            main.display()
        ));
    }
    let node = crate::gui_path::find_in(&path, &exe_name("node")).ok_or(LITE_NO_NODE)?;
    let claude = crate::gui_path::find_in(&path, &exe_name("claude")).ok_or(LITE_NO_CLAUDE)?;
    if let Ok(mut cached) = LITE_SEARCH_PATH.lock() {
        *cached = Some(path.clone());
    }
    Ok(Launch {
        program: node,
        args: vec![main],
        env: vec![
            ("COMMAND_CENTER_CLAUDE_EXECUTABLE", claude),
            ("PATH", PathBuf::from(path)),
        ],
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
            "Bridge entry not found at {}. Run `pnpm --filter @command-center/bridge build`.",
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
    if let Some(path) = crate::env::app_env("BRIDGE_ENTRY", |k| std::env::var(k).ok()) {
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
        lite_search_path,
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

/// Starts the sidecar if it isn't already running (idempotent) and returns its generation, which
/// its exit event will carry. `async` so it runs off the main thread: a lite build may read the
/// login shell's PATH here (`lite_search_path`), and the window must stay responsive meanwhile.
#[tauri::command]
pub async fn bridge_start(app: AppHandle, state: State<'_, BridgeState>) -> Result<u64, String> {
    let mut guard = state.running.lock().map_err(|_| "bridge state poisoned")?;

    // A crashed sidecar must be restartable, so check liveness instead of trusting the Option.
    if let Some(running) = guard.as_mut() {
        if matches!(running.child.try_wait(), Ok(None)) {
            return Ok(running.generation);
        }
        *guard = None;
    }

    let mut child = spawn_bridge(&app)?;
    let stdin = child.stdin.take().ok_or("bridge stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("bridge stderr unavailable")?;
    let generation = state
        .generations
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            // Emit failures only mean the window is gone; nothing useful to do.
            let _ = app.emit(LINE_EVENT, line);
        }
        let _ = app.emit(EXIT_EVENT, generation);
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("{line}");
        }
    });

    *guard = Some(Running {
        child,
        stdin,
        generation,
    });
    Ok(generation)
}

/// Stops the sidecar on purpose (the app's idle shutdown). Closing stdin lets the bridge finish
/// cleanly; it is killed if still running a second later. The wait runs on a blocking thread, not
/// an async worker. `bridge_start` starts a fresh one.
#[tauri::command]
pub async fn bridge_stop(state: State<'_, BridgeState>) -> Result<(), String> {
    let running = state
        .running
        .lock()
        .map_err(|_| "bridge state poisoned")?
        .take();
    let Some(Running {
        mut child, stdin, ..
    }) = running
    else {
        return Ok(());
    };
    drop(stdin);
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..20 {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    })
    .await
    .map_err(|e| e.to_string())
}

/// Writes one protocol line to the sidecar's stdin.
#[tauri::command]
pub fn bridge_send(state: State<'_, BridgeState>, line: String) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|_| "bridge state poisoned")?;
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("command-center-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A full build must never search the machine's PATH.
    fn no_search() -> std::ffi::OsString {
        panic!("a full build looked for an installed node or claude")
    }

    #[test]
    fn a_lite_build_uses_the_installed_node_and_claude_and_passes_the_path_on() {
        let root = scratch("lite");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&res.join("bridge/main.mjs"));
        touch(&res.join("bridge/lite"));
        let bin = root.join("bin");
        touch(&bin.join(exe_name("node")));
        touch(&bin.join(exe_name("claude")));
        let path = std::env::join_paths([root.join("empty"), bin.clone()]).unwrap();

        let launch = installed_launch(&exe_dir, &res, || path.clone()).unwrap();
        assert_eq!(launch.program, bin.join(exe_name("node")));
        assert_eq!(launch.args, vec![res.join("bridge/main.mjs")]);
        assert_eq!(
            launch.env,
            vec![
                (
                    "COMMAND_CENTER_CLAUDE_EXECUTABLE",
                    bin.join(exe_name("claude"))
                ),
                ("PATH", PathBuf::from(path)),
            ]
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_lite_build_says_what_to_install_when_node_or_claude_is_missing() {
        let root = scratch("lite-missing");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&res.join("bridge/main.mjs"));
        touch(&res.join("bridge/lite"));
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let path = std::env::join_paths([bin.clone()]).unwrap();
        let err = installed_launch(&exe_dir, &res, || path.clone()).unwrap_err();
        assert!(err.contains("Node.js 22"), "{err}");
        // An empty placeholder is not a program.
        fs::write(bin.join(exe_name("node")), b"").unwrap();
        assert!(installed_launch(&exe_dir, &res, || path.clone())
            .unwrap_err()
            .contains("Node.js"));
        touch(&bin.join(exe_name("node")));
        let err = installed_launch(&exe_dir, &res, || path.clone()).unwrap_err();
        assert!(err.contains("claude-code"), "{err}");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_lite_build_without_the_bridge_says_reinstall_without_searching() {
        let root = scratch("lite-no-main");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&res.join("bridge/lite"));
        let err = installed_launch(&exe_dir, &res, no_search).unwrap_err();
        assert!(
            err.contains("bridge is missing") && err.contains("Reinstall"),
            "{err}"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn installed_layout_runs_the_bundled_node_with_the_bundled_runtime() {
        let root = scratch("installed");
        let (exe_dir, res) = (root.join("app"), root.join("app/resources"));
        touch(&exe_dir.join(exe_name("node")));
        touch(&res.join("bridge/main.mjs"));
        touch(&res.join("bridge").join(exe_name("claude")));

        let launch = installed_launch(&exe_dir, &res, no_search).unwrap();
        assert_eq!(launch.program, exe_dir.join(exe_name("node")));
        assert_eq!(launch.args, vec![res.join("bridge/main.mjs")]);
        assert_eq!(
            launch.env,
            vec![(
                "COMMAND_CENTER_CLAUDE_EXECUTABLE",
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

        let err = installed_launch(&exe_dir, &res, no_search).unwrap_err();
        assert!(err.contains("Claude runtime"), "{err}");
        assert!(err.contains("Reinstall"), "{err}");

        // An empty stand-in (a placeholder build) counts as missing, not as a program.
        fs::write(res.join("bridge").join(exe_name("claude")), b"").unwrap();
        let err = installed_launch(&exe_dir, &res, no_search).unwrap_err();
        assert!(err.contains("Claude runtime"), "{err}");

        fs::remove_file(res.join("bridge/main.mjs")).unwrap();
        assert!(installed_launch(&exe_dir, &res, no_search)
            .unwrap_err()
            .contains("bridge"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn verbatim_windows_prefixes_are_dropped_but_unc_paths_are_kept() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\D:\a\_temp\Command Center")),
            PathBuf::from(r"D:\a\_temp\Command Center")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
        assert_eq!(
            plain_path(PathBuf::from("/usr/lib/Command Center")),
            PathBuf::from("/usr/lib/Command Center")
        );
    }

    #[test]
    fn dev_launch_needs_the_built_bundle() {
        let err = dev_launch(PathBuf::from("/definitely/not/here.mjs")).unwrap_err();
        assert!(err.contains("pnpm --filter @command-center/bridge build"));
    }
}
