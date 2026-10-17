//! One-time move of the user's data from the app's earlier names to Command Center.
//!
//! Tauri keeps app data under a folder named after the bundle identifier, so renaming the app
//! (`dev.engineerlish.programish` -> `com.engineerlish.geeked` -> `com.milesceo.commandcenter`)
//! would otherwise start with an empty database and an empty webview profile. On startup, before
//! the window exists, this copies the newest earlier install's data to the new locations and
//! verifies every copied file byte for byte. Only then is a marker written. Nothing in the old
//! locations is ever modified or deleted.
//!
//! The migrations are chained by picking a source, not by running twice: a Geeked install
//! already holds whatever it migrated from programish, so it wins when both exist, and a
//! programish install that never ran Geeked is copied directly.
//!
//! Webview storage is carried over on Windows (WebView2) and macOS (WKWebView). Linux
//! (WebKitGTK) is not migrated: no earlier release shipped there.
//!
//! This module (with `legacy_keys.rs`, `env.rs` and `src/lib/legacy.ts`) is the only place the old names may
//! appear.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

/// One earlier install: its bundle identifier folder, database file and the config files the Rust
/// side kept beside the database (copied under the same names).
#[derive(Debug, Clone, Copy)]
struct Source {
    identifier: &'static str,
    db: &'static str,
    config_files: &'static [&'static str],
}

/// Earlier names, newest first. The first one with data is the one copied.
const SOURCES: [Source; 2] = [
    Source {
        identifier: "com.engineerlish.geeked",
        db: "geeked.db",
        // The Argon2id PIN record and lockout (`lock.rs`) and the close choice (`system.rs`).
        config_files: &["lock.json", "system.json"],
    },
    Source {
        identifier: "dev.engineerlish.programish",
        db: "programish.db",
        config_files: &[],
    },
];
/// SQLite database file name now.
const NEW_DB: &str = "command-center.db";
/// SQLite sidecar files that belong to the database while it is in WAL mode.
const DB_SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];
/// Written in the new config directory once everything below is copied and verified.
pub const MARKER: &str = "migrated-from-previous-name.json";
/// Webview localStorage (settings, theme, prefs) on Windows: where WebView2 keeps the profile,
/// under the local data directory.
const WEBVIEW2_STORAGE: [&str; 3] = ["EBWebView", "Default", "Local Storage"];
/// Webview localStorage on macOS: WKWebView keeps each app's website data under
/// `~/Library/WebKit/<bundle identifier>/WebsiteData`. `Default` holds the salt and the per-origin
/// folders (newer WebKit), `LocalStorage` the older flat layout; both are copied whole.
const WEBKIT_STORAGE: [&str; 2] = ["Default", "LocalStorage"];

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub from: String,
    pub status: Status,
    pub files: Vec<CopiedFile>,
    pub completed_at_unix: u64,
    /// Why the migration was skipped (`Status::Skipped` only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Old data was found, copied and verified.
    Migrated,
    /// There was nothing at any old location (a fresh install).
    NothingToMigrate,
    /// The migration failed and the user chose to start without the old data.
    Skipped,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CopiedFile {
    pub from: String,
    pub to: String,
    pub bytes: u64,
}

/// The new directories, from Tauri's path resolver. Old ones are siblings named after each old
/// identifier. `website_data_new` is the macOS WebKit folder (`.../WebKit/<id>/WebsiteData`);
/// `None` elsewhere.
#[derive(Debug, Clone)]
pub struct Locations {
    pub config_new: PathBuf,
    pub local_new: PathBuf,
    pub website_data_new: Option<PathBuf>,
}

/// The same three folders for one earlier identifier.
#[derive(Debug, Clone)]
struct OldLocations {
    config: PathBuf,
    local: PathBuf,
    website_data: Option<PathBuf>,
}

impl Locations {
    pub fn from_new(
        config_new: PathBuf,
        local_new: PathBuf,
        website_data_new: Option<PathBuf>,
    ) -> Option<Self> {
        config_new.parent()?;
        local_new.parent()?;
        if let Some(web) = &website_data_new {
            web.parent()?.parent()?;
        }
        Some(Self {
            config_new,
            local_new,
            website_data_new,
        })
    }

    fn old(&self, identifier: &str) -> OldLocations {
        let sibling = |p: &Path| p.parent().map(|d| d.join(identifier)).unwrap_or_default();
        OldLocations {
            config: sibling(&self.config_new),
            local: sibling(&self.local_new),
            // `.../WebKit/<id>/WebsiteData`: swap the `<id>` folder.
            website_data: self.website_data_new.as_ref().and_then(|web| {
                let leaf = web.file_name()?;
                Some(web.parent()?.parent()?.join(identifier).join(leaf))
            }),
        }
    }
}

/// The newest earlier install that left anything behind, with its folders.
fn pick_source(loc: &Locations) -> Option<(Source, OldLocations)> {
    let with_old = || SOURCES.iter().map(|s| (*s, loc.old(s.identifier)));
    // A database is the strongest sign of a real install; fall back to any leftover folder.
    with_old()
        .find(|(s, old)| old.config.join(s.db).is_file())
        .or_else(|| {
            with_old().find(|(_, old)| {
                old.config.is_dir()
                    || old.local.is_dir()
                    || old.website_data.as_ref().is_some_and(|w| w.is_dir())
            })
        })
}

/// Every (old, new) file pair to copy from `src`, in order. The database comes first so its
/// header can be checked before anything is placed.
fn plan(
    loc: &Locations,
    src: &Source,
    old: &OldLocations,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let mut pairs = Vec::new();
    if old.config.join(src.db).is_file() {
        for suffix in DB_SUFFIXES {
            let from = old.config.join(format!("{}{suffix}", src.db));
            if from.is_file() {
                pairs.push((from, loc.config_new.join(format!("{NEW_DB}{suffix}"))));
            }
        }
    }
    for name in src.config_files {
        let from = old.config.join(name);
        if from.is_file() {
            pairs.push((from, loc.config_new.join(name)));
        }
    }
    if cfg!(windows) {
        let from_dir = join_all(&old.local, &WEBVIEW2_STORAGE);
        if from_dir.is_dir() {
            collect_tree(
                &from_dir,
                &join_all(&loc.local_new, &WEBVIEW2_STORAGE),
                &mut pairs,
            )?;
        }
    }
    if let (Some(from_web), Some(to_web)) = (&old.website_data, &loc.website_data_new) {
        for part in WEBKIT_STORAGE {
            let from_dir = from_web.join(part);
            if from_dir.is_dir() {
                collect_tree(&from_dir, &to_web.join(part), &mut pairs)?;
            }
        }
    }
    Ok(pairs)
}

/// Fails when the earlier app still has its data open: a copy then would be a torn snapshot
/// (SQLite plus its WAL, or a live LevelDB). Only Windows can tell cheaply: SQLite and LevelDB
/// keep their files open with sharing, so an exclusive open fails while the old app runs.
#[cfg(windows)]
fn ensure_not_in_use(pairs: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    for (from, _) in pairs {
        let busy = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(from)
            .is_err();
        if busy {
            return Err(format!(
                "{} is in use: the previous version of the app is still running",
                from.display()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn ensure_not_in_use(_pairs: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    // No earlier release shipped outside Windows; the per-file stability check still applies.
    Ok(())
}

/// Runs the migration if it has not completed before. Safe to call on every start: it returns
/// quickly once the marker exists. It is all or nothing: every file is first copied to a
/// temporary name and verified, and only when all of them are does anything move into place. A
/// failure leaves no new file behind, so the next start can retry from a clean slate (as long as
/// the app is not opened on an empty profile in between; see `lib.rs`).
pub fn run(loc: &Locations) -> Result<Option<Marker>, String> {
    let marker_path = loc.config_new.join(MARKER);
    if marker_path.exists() {
        return Ok(None);
    }
    fs::create_dir_all(&loc.config_new).map_err(|e| format!("create data folder: {e}"))?;

    let mut files = Vec::new();
    let source = pick_source(loc);
    if let Some((src, old)) = &source {
        let pairs = plan(loc, src, old)?;
        ensure_not_in_use(&pairs)?;
        let mut staged = Vec::new();
        let result = (|| -> Result<(), String> {
            for (from, to) in &pairs {
                staged.push(stage_verified(from, to)?);
            }
            if let Some(Staged::Copied { tmp, to, .. }) = staged.first() {
                if to.file_name().is_some_and(|n| n == NEW_DB) {
                    check_sqlite_header(tmp)?;
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            discard(&staged);
            return Err(e);
        }
        files = place_all(staged)?;
    }

    write_marker(
        &marker_path,
        Marker {
            from: source
                .map(|(s, _)| s.identifier.to_string())
                .unwrap_or_default(),
            status: if files.is_empty() {
                Status::NothingToMigrate
            } else {
                Status::Migrated
            },
            files,
            completed_at_unix: now_unix(),
            reason: None,
        },
    )
    .map(Some)
}

/// Records that the user chose to start without the earlier data after `run` failed, so the
/// migration is not attempted again over the data the new install is about to create.
pub fn skip(loc: &Locations, reason: &str) -> Result<Marker, String> {
    fs::create_dir_all(&loc.config_new).map_err(|e| format!("create data folder: {e}"))?;
    write_marker(
        &loc.config_new.join(MARKER),
        Marker {
            from: pick_source(loc)
                .map(|(s, _)| s.identifier.to_string())
                .unwrap_or_default(),
            status: Status::Skipped,
            files: Vec::new(),
            completed_at_unix: now_unix(),
            reason: Some(reason.to_string()),
        },
    )
}

fn write_marker(path: &Path, marker: Marker) -> Result<Marker, String> {
    let json = serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("write migration marker: {e}"))?;
    Ok(marker)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn join_all(base: &Path, parts: &[&str]) -> PathBuf {
    parts
        .iter()
        .fold(base.to_path_buf(), |p, part| p.join(part))
}

fn check_sqlite_header(db: &Path) -> Result<(), String> {
    let mut head = [0u8; 16];
    let read = File::open(db).and_then(|mut f| f.read_exact(&mut head));
    if let Err(e) = read {
        return Err(if e.kind() == io::ErrorKind::UnexpectedEof {
            format!(
                "{} is empty or truncated, not a SQLite database",
                db.display()
            )
        } else {
            format!("read {}: {e}", db.display())
        });
    }
    if &head != b"SQLite format 3\0" {
        return Err(format!("{} is not a SQLite database", db.display()));
    }
    Ok(())
}

/// One file after staging: already identical at the destination, or copied to `tmp` and verified.
enum Staged {
    Present(CopiedFile),
    Copied {
        tmp: PathBuf,
        to: PathBuf,
        record: CopiedFile,
    },
}

/// Copies one file to a temporary name beside `to` and verifies the copy equals the source (and
/// that the source did not change while copying). An existing destination is never
/// overwritten: if it already equals the source the file counts as done, otherwise this fails
/// and the old data stays authoritative.
fn stage_verified(from: &Path, to: &Path) -> Result<Staged, String> {
    let record = |bytes| CopiedFile {
        from: from.display().to_string(),
        to: to.display().to_string(),
        bytes,
    };
    if to.exists() {
        return if same_contents(from, to).map_err(|e| e.to_string())? {
            Ok(Staged::Present(record(
                fs::metadata(to).map_err(|e| e.to_string())?.len(),
            )))
        } else {
            Err(format!(
                "{} already exists with different contents; leaving both untouched \
                 (rename it and restart to retry)",
                to.display()
            ))
        };
    }
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    let before = fs::metadata(from).map_err(|e| format!("stat {}: {e}", from.display()))?;
    let tmp = to.with_extension(format!(
        "{}migrating",
        to.extension()
            .map(|e| format!("{}.", e.to_string_lossy()))
            .unwrap_or_default()
    ));
    fs::copy(from, &tmp).map_err(|e| format!("copy {}: {e}", from.display()))?;
    let verified = same_contents(from, &tmp).map_err(|e| e.to_string());
    let after = fs::metadata(from).map_err(|e| format!("stat {}: {e}", from.display()))?;
    let stable = before.len() == after.len() && before.modified().ok() == after.modified().ok();
    if !matches!(verified, Ok(true)) || !stable {
        let _ = fs::remove_file(&tmp);
        return Err(match verified {
            Err(e) => e,
            Ok(false) => format!("verification of {} failed", to.display()),
            Ok(true) => format!(
                "{} changed while it was being copied; close the old app and retry",
                from.display()
            ),
        });
    }
    Ok(Staged::Copied {
        tmp,
        to: to.to_path_buf(),
        record: record(before.len()),
    })
}

/// Removes every temporary copy (after a failure while staging).
fn discard(staged: &[Staged]) {
    for s in staged {
        if let Staged::Copied { tmp, .. } = s {
            let _ = fs::remove_file(tmp);
        }
    }
}

/// Moves every staged copy into place. If a rename fails, the files this run already placed are
/// removed again (they did not exist before: staging checked) along with the remaining temporary
/// copies, so a failure still leaves nothing new behind.
fn place_all(staged: Vec<Staged>) -> Result<Vec<CopiedFile>, String> {
    let mut placed: Vec<PathBuf> = Vec::new();
    let mut files = Vec::new();
    let mut iter = staged.into_iter();
    while let Some(item) = iter.next() {
        match item {
            Staged::Present(record) => files.push(record),
            Staged::Copied { tmp, to, record } => {
                if let Err(e) = fs::rename(&tmp, &to) {
                    let _ = fs::remove_file(&tmp);
                    for p in &placed {
                        let _ = fs::remove_file(p);
                    }
                    discard(&iter.collect::<Vec<_>>());
                    return Err(format!("place {}: {e}", to.display()));
                }
                placed.push(to);
                files.push(record);
            }
        }
    }
    Ok(files)
}

fn collect_tree(from: &Path, to: &Path, out: &mut Vec<(PathBuf, PathBuf)>) -> Result<(), String> {
    for entry in fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = to.join(entry.file_name());
        // `file_type` does not follow symlinks: a linked folder (or a loop) is skipped, never walked.
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_tree(&path, &target, out)?;
        } else if entry.file_name() != "LOCK" {
            // LevelDB's LOCK file is a process lock, not data; the new profile makes its own.
            out.push((path, target));
        }
    }
    Ok(())
}

fn same_contents(a: &Path, b: &Path) -> io::Result<bool> {
    if fs::metadata(a)?.len() != fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (File::open(a)?, File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let n = fa.read(&mut ba)?;
        if n == 0 {
            return Ok(true);
        }
        fb.read_exact(&mut bb[..n])?;
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW_ID: &str = "com.milesceo.commandcenter";
    const GEEKED: Source = SOURCES[0];
    const PROGRAMISH: Source = SOURCES[1];

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "command-center-migrate-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn layout(root: &Path) -> Locations {
        Locations::from_new(
            root.join("Roaming").join(NEW_ID),
            root.join("Local").join(NEW_ID),
            Some(root.join("WebKit").join(NEW_ID).join("WebsiteData")),
        )
        .unwrap()
    }

    fn sqlite_bytes(tail: &[u8]) -> Vec<u8> {
        let mut v = b"SQLite format 3\0".to_vec();
        v.extend_from_slice(tail);
        v
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn no_temporaries(dir: &Path) -> bool {
        fs::read_dir(dir).unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .contains("migrating")
        })
    }

    #[test]
    fn old_folders_are_siblings_of_the_new_ones() {
        let loc = layout(Path::new("/r"));
        let old = loc.old(GEEKED.identifier);
        assert_eq!(old.config, Path::new("/r/Roaming/com.engineerlish.geeked"));
        assert_eq!(old.local, Path::new("/r/Local/com.engineerlish.geeked"));
        assert_eq!(
            old.website_data.unwrap(),
            Path::new("/r/WebKit/com.engineerlish.geeked/WebsiteData")
        );
    }

    #[test]
    fn copies_a_geeked_install_with_its_pin_and_close_choice() {
        let root = scratch("geeked");
        let loc = layout(&root);
        let old = loc.old(GEEKED.identifier);
        let main = sqlite_bytes(&[7; 5000]);
        write(&old.config.join("geeked.db"), &main);
        write(&old.config.join("geeked.db-wal"), b"wal-bytes");
        write(
            &old.config.join("lock.json"),
            b"{\"phc\":\"$argon2id$...\"}",
        );
        write(&old.config.join("system.json"), b"{\"close\":\"tray\"}");
        write(&old.config.join(MARKER), b"{\"from\":\"from-programish\"}");

        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.status, Status::Migrated);
        assert_eq!(marker.from, GEEKED.identifier);
        assert_eq!(fs::read(loc.config_new.join(NEW_DB)).unwrap(), main);
        assert_eq!(
            fs::read(loc.config_new.join("command-center.db-wal")).unwrap(),
            b"wal-bytes"
        );
        assert_eq!(
            fs::read(loc.config_new.join("lock.json")).unwrap(),
            b"{\"phc\":\"$argon2id$...\"}"
        );
        assert_eq!(
            fs::read(loc.config_new.join("system.json")).unwrap(),
            b"{\"close\":\"tray\"}"
        );
        assert!(loc.config_new.join(MARKER).is_file());
        assert!(!fs::read_to_string(loc.config_new.join(MARKER))
            .unwrap()
            .contains("from-programish"));
        // The old data is untouched, and the old install's own marker is not carried over.
        assert_eq!(fs::read(old.config.join("geeked.db")).unwrap(), main);
        assert!(old.config.join("lock.json").is_file());
        assert!(no_temporaries(&loc.config_new));
    }

    #[test]
    fn copies_a_programish_install_that_never_ran_geeked() {
        let root = scratch("programish");
        let loc = layout(&root);
        let old = loc.old(PROGRAMISH.identifier);
        let main = sqlite_bytes(b"oldest");
        write(&old.config.join("programish.db"), &main);
        write(&old.config.join("programish.db-shm"), b"shm");

        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.from, PROGRAMISH.identifier);
        assert_eq!(fs::read(loc.config_new.join(NEW_DB)).unwrap(), main);
        assert_eq!(
            fs::read(loc.config_new.join("command-center.db-shm")).unwrap(),
            b"shm"
        );
        assert!(old.config.join("programish.db").is_file());
    }

    #[test]
    fn prefers_the_newer_install_when_both_exist() {
        let root = scratch("both");
        let loc = layout(&root);
        write(
            &loc.old(PROGRAMISH.identifier).config.join("programish.db"),
            &sqlite_bytes(b"oldest"),
        );
        write(
            &loc.old(GEEKED.identifier).config.join("geeked.db"),
            &sqlite_bytes(b"newer"),
        );

        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.from, GEEKED.identifier);
        assert_eq!(
            fs::read(loc.config_new.join(NEW_DB)).unwrap(),
            sqlite_bytes(b"newer")
        );
    }

    #[test]
    fn an_install_with_a_database_beats_an_empty_newer_folder() {
        let root = scratch("empty-newer");
        let loc = layout(&root);
        fs::create_dir_all(loc.old(GEEKED.identifier).config).unwrap();
        write(
            &loc.old(PROGRAMISH.identifier).config.join("programish.db"),
            &sqlite_bytes(b"real"),
        );
        assert_eq!(
            run(&loc).unwrap().unwrap().from,
            PROGRAMISH.identifier.to_string()
        );
    }

    #[test]
    fn second_run_is_a_no_op() {
        let root = scratch("twice");
        let loc = layout(&root);
        write(
            &loc.old(GEEKED.identifier).config.join("geeked.db"),
            &sqlite_bytes(b"x"),
        );
        assert!(run(&loc).unwrap().is_some());
        assert!(run(&loc).unwrap().is_none());
    }

    #[test]
    fn fresh_install_records_that_there_was_nothing_to_move() {
        let root = scratch("fresh");
        let loc = layout(&root);
        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.status, Status::NothingToMigrate);
        assert_eq!(marker.from, "");
        assert!(marker.files.is_empty());
        assert!(loc.config_new.join(MARKER).is_file());
    }

    #[test]
    fn never_overwrites_a_different_existing_database_and_writes_no_marker() {
        let root = scratch("conflict");
        let loc = layout(&root);
        write(
            &loc.old(GEEKED.identifier).config.join("geeked.db"),
            &sqlite_bytes(b"old"),
        );
        write(&loc.config_new.join(NEW_DB), &sqlite_bytes(b"newer data"));

        assert!(run(&loc).is_err());
        assert_eq!(
            fs::read(loc.config_new.join(NEW_DB)).unwrap(),
            sqlite_bytes(b"newer data")
        );
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[test]
    fn never_overwrites_a_pin_record_already_set_under_the_new_name() {
        let root = scratch("pin-conflict");
        let loc = layout(&root);
        write(&loc.old(GEEKED.identifier).config.join("lock.json"), b"old");
        write(&loc.config_new.join("lock.json"), b"new");
        assert!(run(&loc).is_err());
        assert_eq!(fs::read(loc.config_new.join("lock.json")).unwrap(), b"new");
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[test]
    fn a_failure_part_way_leaves_nothing_new_and_a_later_run_succeeds() {
        let root = scratch("all-or-nothing");
        let loc = layout(&root);
        let old = loc.old(GEEKED.identifier);
        write(&old.config.join("geeked.db"), &sqlite_bytes(b"chats"));
        write(&old.config.join("lock.json"), b"pin");
        // A conflicting file for the second step: the database would be staged first.
        write(&loc.config_new.join("lock.json"), b"different");

        assert!(run(&loc).is_err());
        let left: Vec<_> = fs::read_dir(&loc.config_new)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            left,
            ["lock.json"],
            "no database, no temporaries, no marker"
        );

        // The user moves the conflicting file away; the next start migrates everything.
        fs::remove_file(loc.config_new.join("lock.json")).unwrap();
        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.status, Status::Migrated);
        assert_eq!(marker.files.len(), 2);
        assert_eq!(fs::read(loc.config_new.join("lock.json")).unwrap(), b"pin");
    }

    #[test]
    fn skipping_records_the_reason_and_stops_further_attempts() {
        let root = scratch("skip");
        let loc = layout(&root);
        write(
            &loc.old(GEEKED.identifier).config.join("geeked.db"),
            &sqlite_bytes(b"x"),
        );
        let marker = skip(&loc, "in use").unwrap();
        assert_eq!(marker.status, Status::Skipped);
        assert_eq!(marker.reason.as_deref(), Some("in use"));
        assert_eq!(marker.from, GEEKED.identifier);
        assert!(run(&loc).unwrap().is_none());
        assert!(!loc.config_new.join(NEW_DB).exists());
    }

    #[test]
    fn a_zero_byte_database_fails_clearly_and_leaves_nothing() {
        let root = scratch("zero");
        let loc = layout(&root);
        write(&loc.old(GEEKED.identifier).config.join("geeked.db"), b"");
        let err = run(&loc).unwrap_err();
        assert!(err.contains("empty or truncated"), "{err}");
        assert!(no_temporaries(&loc.config_new));
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_folders_in_webview_storage_are_not_followed() {
        let root = scratch("symlink");
        let loc = layout(&root);
        let old_web = loc.old(GEEKED.identifier).website_data.unwrap();
        write(&old_web.join("Default").join("salt"), b"salt");
        // A loop back to the parent would recurse forever if followed.
        std::os::unix::fs::symlink(
            old_web.join("Default"),
            old_web.join("Default").join("loop"),
        )
        .unwrap();
        run(&loc).unwrap();
        let new_default = loc.website_data_new.clone().unwrap().join("Default");
        assert!(new_default.join("salt").is_file());
        assert!(!new_default.join("loop").exists());
    }

    #[test]
    fn rejects_a_source_that_is_not_sqlite() {
        let root = scratch("notdb");
        let loc = layout(&root);
        write(
            &loc.old(GEEKED.identifier).config.join("geeked.db"),
            b"garbage",
        );
        assert!(run(&loc).is_err());
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[test]
    fn an_identical_destination_counts_as_already_copied() {
        let root = scratch("resume");
        let loc = layout(&root);
        let db = sqlite_bytes(b"same");
        write(&loc.old(GEEKED.identifier).config.join("geeked.db"), &db);
        write(&loc.config_new.join(NEW_DB), &db);
        assert_eq!(run(&loc).unwrap().unwrap().status, Status::Migrated);
    }

    #[test]
    fn copies_webkit_website_data_when_given_a_webkit_folder() {
        let root = scratch("webkit");
        let loc = layout(&root);
        let old_web = loc.old(GEEKED.identifier).website_data.unwrap();
        write(&old_web.join("Default").join("salt"), b"salt");
        write(
            &old_web
                .join("Default")
                .join("abc")
                .join("abc")
                .join("LocalStorage")
                .join("localstorage.sqlite3"),
            b"prefs",
        );
        write(
            &old_web
                .join("LocalStorage")
                .join("tauri_localhost_0.localstorage"),
            b"flat",
        );
        write(&old_web.join("IndexedDB").join("other"), b"not copied");

        run(&loc).unwrap();
        let new_web = loc.website_data_new.clone().unwrap();
        assert_eq!(
            fs::read(new_web.join("Default").join("salt")).unwrap(),
            b"salt"
        );
        assert_eq!(
            fs::read(
                new_web
                    .join("Default/abc/abc/LocalStorage")
                    .join("localstorage.sqlite3")
            )
            .unwrap(),
            b"prefs"
        );
        assert!(new_web
            .join("LocalStorage")
            .join("tauri_localhost_0.localstorage")
            .is_file());
        assert!(!new_web.join("IndexedDB").exists());
        assert!(old_web.join("Default").join("salt").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn copies_webview_local_storage_without_the_lock_file() {
        let root = scratch("web");
        let loc = layout(&root);
        let store = join_all(&loc.old(GEEKED.identifier).local, &WEBVIEW2_STORAGE).join("leveldb");
        write(&store.join("000003.log"), b"settings");
        write(&store.join("LOCK"), b"");

        run(&loc).unwrap();
        let dest = join_all(&loc.local_new, &WEBVIEW2_STORAGE).join("leveldb");
        assert_eq!(fs::read(dest.join("000003.log")).unwrap(), b"settings");
        assert!(!dest.join("LOCK").exists());
    }

    /// Manual check against a copy of real data: set `COMMAND_CENTER_MIGRATION_SAMPLE` to a
    /// folder that holds `Roaming/<old identifier>` (and optionally `Local/...` and
    /// `WebKit/<old identifier>/WebsiteData`), then run
    /// `cargo test -- --ignored real_data_sample`. The sample is copied to a scratch folder
    /// first, so it is only ever read.
    #[test]
    #[ignore]
    fn real_data_sample() {
        let sample =
            PathBuf::from(std::env::var("COMMAND_CENTER_MIGRATION_SAMPLE").expect("sample dir"));
        let out = scratch("sample-out");
        let mut pairs = Vec::new();
        collect_tree(&sample, &out, &mut pairs).unwrap();
        for (from, to) in pairs {
            write(&to, &fs::read(from).unwrap());
        }
        let marker = run(&layout(&out)).unwrap().expect("ran");
        println!("{marker:#?}\nnew data in {}", out.display());
    }
}
