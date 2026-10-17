//! The PATH a macOS app opened from the Finder or the Dock does not get.
//!
//! Such an app starts with only the system PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so a Node or
//! Claude Code installed with Homebrew, npm, nvm, volta or fnm is invisible to it. The lite build
//! (no bundled Node or Claude runtime) needs those, so this reads the user's login shell PATH once
//! (bounded: the shell runs in its own process group and is killed after a timeout) and adds the
//! usual install folders. The bridge does the same for the CLIs it looks up
//! (`packages/bridge/src/providers/process.ts`); this is the Rust side of it.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MARK: &str = "__COMMAND_CENTER_PATH__";
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(3);

/// The PATH printed between the two marker lines; only absolute entries are kept.
pub fn parse_login_shell_output(stdout: &str) -> Option<String> {
    let lines: Vec<&str> = stdout.lines().map(|l| l.trim_end_matches('\r')).collect();
    let start = lines.iter().position(|l| *l == MARK)?;
    let end = start + 1 + lines[start + 1..].iter().position(|l| *l == MARK)?;
    let dirs: Vec<&str> = lines[start + 1..end]
        .iter()
        .flat_map(|l| l.split(':'))
        .filter(|d| d.starts_with('/'))
        .collect();
    (!dirs.is_empty()).then(|| dirs.join(":"))
}

/// Runs `$SHELL -ilc` (interactive login, so `~/.zprofile` and `~/.zshrc` run) and reads its
/// exported PATH. `printenv` prints it colon-joined in every shell, fish included. Everything is
/// bounded by one deadline: stdout is drained on its own thread (a background job started by an rc
/// file can keep the pipe open after the shell exits, and a chatty rc file must not fill the pipe),
/// the answer is taken as soon as both markers arrive, and on the deadline the shell's whole process
/// group is killed (interactive shells ignore SIGTERM).
#[cfg(unix)]
pub fn login_shell_path(shell: &Path, timeout: Duration) -> Option<String> {
    use std::os::unix::process::CommandExt;
    use std::sync::mpsc;
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg(format!("echo {MARK}; /usr/bin/printenv PATH; echo {MARK}"))
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    out.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if let Some(path) = parse_login_shell_output(&out) {
                        let _ = tx.send(Some(path));
                        return;
                    }
                }
            }
        }
        let _ = tx.send(parse_login_shell_output(&out));
    });
    let deadline = Instant::now() + timeout;
    let result = rx
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()
        .flatten();
    // Whatever happened, nothing of the shell may outlive this call.
    let _ = Command::new("/bin/kill")
        .args(["-KILL", &format!("-{}", child.id())])
        .stderr(Stdio::null())
        .status();
    let _ = child.wait();
    result
}

#[cfg(not(unix))]
pub fn login_shell_path(_shell: &Path, _timeout: Duration) -> Option<String> {
    None
}

/// Folders tools usually live in on macOS, after the login shell's PATH.
pub fn extra_dirs(home: &Path, nvm_versions: &[String]) -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local/bin"),
        home.join(".npm-global/bin"),
        home.join(".volta/bin"),
        home.join("Library/Application Support/fnm/aliases/default/bin"),
    ];
    let mut versions: Vec<&String> = nvm_versions
        .iter()
        .filter(|v| v.starts_with('v') && v[1..].split('.').all(|n| n.parse::<u32>().is_ok()))
        .collect();
    versions.sort_by_key(|v| {
        v[1..]
            .split('.')
            .map(|n| n.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    for v in versions.into_iter().rev() {
        dirs.push(home.join(".nvm/versions/node").join(v).join("bin"));
    }
    dirs
}

/// The current PATH, then the login shell's, then `extra`, without duplicates.
pub fn merge(current: Option<OsString>, login: Option<String>, extra: Vec<PathBuf>) -> OsString {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();
    let login_dirs = login
        .map(|l| l.split(':').map(PathBuf::from).collect::<Vec<_>>())
        .unwrap_or_default();
    let current_dirs = current
        .map(|c| std::env::split_paths(&c).collect::<Vec<_>>())
        .unwrap_or_default();
    for dir in current_dirs.into_iter().chain(login_dirs).chain(extra) {
        if !dir.as_os_str().is_empty() && seen.insert(dir.clone()) {
            out.push(dir);
        }
    }
    std::env::join_paths(out).unwrap_or_default()
}

/// The full search PATH for this machine. Reads the login shell, so it can take a moment: callers
/// run it off the main thread and cache it (`bridge.rs` `lite_search_path`).
pub fn search_path() -> OsString {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|s| s.is_absolute())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
    let login = login_shell_path(&shell, LOGIN_SHELL_TIMEOUT);
    let extra = home
        .map(|h| {
            let versions = std::fs::read_dir(h.join(".nvm/versions/node"))
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            extra_dirs(&h, &versions)
        })
        .unwrap_or_default();
    merge(std::env::var_os("PATH"), login, extra)
}

/// The first non-empty, executable file called `name` in `path`.
pub fn find_in(path: &OsString, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join(name))
        .find(|p| {
            p.metadata()
                .is_ok_and(|m| m.is_file() && m.len() > 0 && is_executable(&m))
        })
}

#[cfg(unix)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_meta: &std::fs::Metadata) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_between_the_markers_and_keeps_absolute_entries() {
        let out = format!(
            "hello\n{MARK}\n/opt/homebrew/bin:.:rel/bin:/Users/a/.cargo/bin\n{MARK}\nbye\n"
        );
        assert_eq!(
            parse_login_shell_output(&out).as_deref(),
            Some("/opt/homebrew/bin:/Users/a/.cargo/bin")
        );
        assert_eq!(parse_login_shell_output(""), None);
        assert_eq!(
            parse_login_shell_output(&format!("{MARK}\n/usr/bin\n")),
            None
        );
        assert_eq!(
            parse_login_shell_output(&format!("{MARK}\n./x\n{MARK}\n")),
            None
        );
        assert_eq!(
            parse_login_shell_output(&format!("{MARK}\r\n/usr/bin\r\n{MARK}\r\n")).as_deref(),
            Some("/usr/bin")
        );
    }

    #[test]
    fn extra_dirs_lists_homebrew_user_bins_and_nvm_newest_first() {
        let dirs = extra_dirs(
            Path::new("/Users/a"),
            &[
                "v18.1.0".into(),
                "v22.12.0".into(),
                "system".into(),
                "v22.2.0".into(),
            ],
        );
        assert_eq!(dirs[0], PathBuf::from("/opt/homebrew/bin"));
        let nvm: Vec<_> = dirs
            .iter()
            .filter(|d| d.to_string_lossy().contains(".nvm"))
            .collect();
        assert_eq!(
            nvm,
            [
                &PathBuf::from("/Users/a/.nvm/versions/node/v22.12.0/bin"),
                &PathBuf::from("/Users/a/.nvm/versions/node/v22.2.0/bin"),
                &PathBuf::from("/Users/a/.nvm/versions/node/v18.1.0/bin"),
            ]
        );
    }

    #[test]
    fn merge_of_nothing_is_empty_and_a_split_path_is_joined() {
        assert!(merge(None, None, vec![]).is_empty());
        assert_eq!(
            parse_login_shell_output(&format!("{MARK}\n/a/bin\n/b/bin\n{MARK}\n")).as_deref(),
            Some("/a/bin:/b/bin")
        );
    }

    #[cfg(unix)]
    #[test]
    fn find_in_skips_an_empty_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("command-center-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("node"), b"").unwrap();
        std::fs::set_permissions(dir.join("node"), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_in(&std::env::join_paths([dir]).unwrap(), "node"), None);
    }

    #[test]
    fn merge_keeps_order_and_drops_duplicates() {
        let merged = merge(
            Some(OsString::from("/usr/bin:/bin")),
            Some("/opt/homebrew/bin:/usr/bin".into()),
            vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/x")],
        );
        assert_eq!(merged, OsString::from("/usr/bin:/bin:/opt/homebrew/bin:/x"));
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_that_hangs_is_killed_after_the_timeout() {
        let dir = std::env::temp_dir().join(format!("command-center-hang-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shell = dir.join("hang.sh");
        std::fs::write(&shell, "#!/bin/sh\nsleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert_eq!(login_shell_path(&shell, Duration::from_millis(200)), None);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn a_background_job_holding_the_pipe_does_not_block_the_answer() {
        let dir = std::env::temp_dir().join(format!("command-center-bg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shell = dir.join("bg.sh");
        // Ignores its arguments: starts a job that inherits stdout, then prints the markers.
        std::fs::write(
            &shell,
            format!("#!/bin/sh\nsleep 30 &\necho {MARK}\necho /usr/bin:/bin\necho {MARK}\n"),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert_eq!(
            login_shell_path(&shell, Duration::from_secs(5)).as_deref(),
            Some("/usr/bin:/bin")
        );
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[cfg(unix)]
    #[test]
    fn find_in_skips_files_that_are_not_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("command-center-exec-{}", std::process::id()));
        let (a, b) = (dir.join("a"), dir.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("node"), b"x").unwrap();
        std::fs::set_permissions(a.join("node"), std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::write(b.join("node"), b"x").unwrap();
        std::fs::set_permissions(b.join("node"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::join_paths([a, b.clone()]).unwrap();
        assert_eq!(find_in(&path, "node"), Some(b.join("node")));
    }

    #[cfg(unix)]
    #[test]
    fn reads_a_real_posix_shell() {
        if let Some(path) = login_shell_path(Path::new("/bin/sh"), Duration::from_secs(5)) {
            assert!(path.split(':').all(|d| d.starts_with('/')));
        }
    }
}
