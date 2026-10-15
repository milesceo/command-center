//! One-time move of the user's data from the app's old name to Geeked.
//!
//! Tauri keeps app data under a folder named after the bundle identifier, so renaming the app
//! (`dev.engineerlish.programish` -> `com.engineerlish.geeked`) would otherwise start with an
//! empty database and an empty webview profile. On startup, before the window exists, this
//! copies the old data to the new locations and verifies every copied file byte for byte.
//! Only then is a marker written. Nothing in the old locations is ever modified or deleted.
//!
//! This module (with `src/lib/legacy-storage.ts`) is the only place the old name may appear.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

/// Bundle identifier folder name the previous releases used.
const OLD_IDENTIFIER: &str = "dev.engineerlish.programish";
/// SQLite database file name before the rename, and after it.
const OLD_DB: &str = "programish.db";
const NEW_DB: &str = "geeked.db";
/// SQLite sidecar files that belong to the database while it is in WAL mode.
const DB_SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];
/// Written in the new config directory once everything below is copied and verified.
pub const MARKER: &str = "migrated-from-previous-name.json";
/// Webview localStorage (settings, theme, PIN record). Windows only: that is where WebView2
/// keeps a profile, and where this app's frontend state lived.
const WEBVIEW_STORAGE: [&str; 3] = ["EBWebView", "Default", "Local Storage"];

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub from: String,
    pub status: Status,
    pub files: Vec<CopiedFile>,
    pub completed_at_unix: u64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Old data was found, copied and verified.
    Migrated,
    /// There was nothing at the old location (a fresh install).
    NothingToMigrate,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CopiedFile {
    pub from: String,
    pub to: String,
    pub bytes: u64,
}

/// The four directories involved. `*_new` come from Tauri's path resolver; the old ones are
/// siblings named after the old identifier.
#[derive(Debug, Clone)]
pub struct Locations {
    pub config_new: PathBuf,
    pub config_old: PathBuf,
    pub local_new: PathBuf,
    pub local_old: PathBuf,
}

impl Locations {
    pub fn from_new(config_new: PathBuf, local_new: PathBuf) -> Option<Self> {
        let config_old = config_new.parent()?.join(OLD_IDENTIFIER);
        let local_old = local_new.parent()?.join(OLD_IDENTIFIER);
        Some(Self {
            config_new,
            config_old,
            local_new,
            local_old,
        })
    }
}

/// Runs the migration if it has not completed before. Safe to call on every start: it returns
/// quickly once the marker exists, and an interrupted run simply repeats (copies are written to
/// temporary names and only renamed into place after verification).
pub fn run(loc: &Locations) -> Result<Option<Marker>, String> {
    let marker_path = loc.config_new.join(MARKER);
    if marker_path.exists() {
        return Ok(None);
    }
    fs::create_dir_all(&loc.config_new).map_err(|e| format!("create data folder: {e}"))?;

    let mut files = Vec::new();
    let old_db = loc.config_old.join(OLD_DB);
    if old_db.is_file() {
        for suffix in DB_SUFFIXES {
            let from = loc.config_old.join(format!("{OLD_DB}{suffix}"));
            if !from.is_file() {
                continue;
            }
            let to = loc.config_new.join(format!("{NEW_DB}{suffix}"));
            files.push(copy_verified(&from, &to)?);
        }
        check_sqlite_header(&loc.config_new.join(NEW_DB))?;
    }

    if cfg!(windows) {
        let from_dir = WEBVIEW_STORAGE
            .iter()
            .fold(loc.local_old.clone(), |p, part| p.join(part));
        if from_dir.is_dir() {
            let to_dir = WEBVIEW_STORAGE
                .iter()
                .fold(loc.local_new.clone(), |p, part| p.join(part));
            copy_tree_verified(&from_dir, &to_dir, &mut files)?;
        }
    }

    let marker = Marker {
        from: OLD_IDENTIFIER.to_string(),
        status: if files.is_empty() {
            Status::NothingToMigrate
        } else {
            Status::Migrated
        },
        files,
        completed_at_unix: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    let json = serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?;
    fs::write(&marker_path, json).map_err(|e| format!("write migration marker: {e}"))?;
    Ok(Some(marker))
}

fn check_sqlite_header(db: &Path) -> Result<(), String> {
    let mut head = [0u8; 16];
    File::open(db)
        .and_then(|mut f| f.read_exact(&mut head))
        .map_err(|e| format!("read {}: {e}", db.display()))?;
    if &head != b"SQLite format 3\0" {
        return Err(format!("{} is not a SQLite database", db.display()));
    }
    Ok(())
}

/// Copies one file to `to` through a temporary name, verifies the copy equals the source (and
/// that the source did not change while copying), then moves it into place. An existing
/// destination is never overwritten: if it already equals the source the file counts as done,
/// otherwise the migration stops with an error and the old data stays authoritative.
fn copy_verified(from: &Path, to: &Path) -> Result<CopiedFile, String> {
    let record = |bytes| CopiedFile {
        from: from.display().to_string(),
        to: to.display().to_string(),
        bytes,
    };
    if to.exists() {
        return if same_contents(from, to).map_err(|e| e.to_string())? {
            Ok(record(fs::metadata(to).map_err(|e| e.to_string())?.len()))
        } else {
            Err(format!(
                "{} already exists with different contents; leaving both untouched \n                 (rename it and restart to retry)",
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
    fs::rename(&tmp, to).map_err(|e| format!("place {}: {e}", to.display()))?;
    Ok(record(before.len()))
}

fn copy_tree_verified(from: &Path, to: &Path, out: &mut Vec<CopiedFile>) -> Result<(), String> {
    for entry in fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = to.join(entry.file_name());
        if path.is_dir() {
            copy_tree_verified(&path, &target, out)?;
        } else if entry.file_name() != "LOCK" {
            // LevelDB's LOCK file is a process lock, not data; the new profile makes its own.
            out.push(copy_verified(&path, &target)?);
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

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("geeked-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn layout(root: &Path) -> Locations {
        Locations::from_new(
            root.join("Roaming").join("com.engineerlish.geeked"),
            root.join("Local").join("com.engineerlish.geeked"),
        )
        .unwrap()
    }

    fn sqlite_bytes(tail: &[u8]) -> Vec<u8> {
        let mut v = b"SQLite format 3\0".to_vec();
        v.extend_from_slice(tail);
        v
    }

    #[test]
    fn copies_database_and_wal_verifies_and_leaves_the_old_data_alone() {
        let root = scratch("copy");
        let loc = layout(&root);
        fs::create_dir_all(&loc.config_old).unwrap();
        let main = sqlite_bytes(&[7; 5000]);
        fs::write(loc.config_old.join(OLD_DB), &main).unwrap();
        fs::write(loc.config_old.join("programish.db-wal"), b"wal-bytes").unwrap();

        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.status, Status::Migrated);
        assert_eq!(fs::read(loc.config_new.join(NEW_DB)).unwrap(), main);
        assert_eq!(
            fs::read(loc.config_new.join("geeked.db-wal")).unwrap(),
            b"wal-bytes"
        );
        assert!(loc.config_new.join(MARKER).is_file());
        // The old data is untouched.
        assert_eq!(fs::read(loc.config_old.join(OLD_DB)).unwrap(), main);
        assert!(loc.config_old.join("programish.db-wal").is_file());
        // No temporary leftovers.
        assert!(fs::read_dir(&loc.config_new).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("migrating")));
    }

    #[test]
    fn second_run_is_a_no_op() {
        let root = scratch("twice");
        let loc = layout(&root);
        fs::create_dir_all(&loc.config_old).unwrap();
        fs::write(loc.config_old.join(OLD_DB), sqlite_bytes(b"x")).unwrap();
        assert!(run(&loc).unwrap().is_some());
        assert!(run(&loc).unwrap().is_none());
    }

    #[test]
    fn fresh_install_records_that_there_was_nothing_to_move() {
        let root = scratch("fresh");
        let loc = layout(&root);
        let marker = run(&loc).unwrap().expect("ran");
        assert_eq!(marker.status, Status::NothingToMigrate);
        assert!(marker.files.is_empty());
        assert!(loc.config_new.join(MARKER).is_file());
    }

    #[test]
    fn never_overwrites_a_different_existing_database_and_writes_no_marker() {
        let root = scratch("conflict");
        let loc = layout(&root);
        fs::create_dir_all(&loc.config_old).unwrap();
        fs::create_dir_all(&loc.config_new).unwrap();
        fs::write(loc.config_old.join(OLD_DB), sqlite_bytes(b"old")).unwrap();
        fs::write(loc.config_new.join(NEW_DB), sqlite_bytes(b"newer data")).unwrap();

        assert!(run(&loc).is_err());
        assert_eq!(
            fs::read(loc.config_new.join(NEW_DB)).unwrap(),
            sqlite_bytes(b"newer data")
        );
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[test]
    fn rejects_a_source_that_is_not_sqlite() {
        let root = scratch("notdb");
        let loc = layout(&root);
        fs::create_dir_all(&loc.config_old).unwrap();
        fs::write(loc.config_old.join(OLD_DB), b"garbage").unwrap();
        assert!(run(&loc).is_err());
        assert!(!loc.config_new.join(MARKER).exists());
    }

    #[test]
    fn an_identical_destination_counts_as_already_copied() {
        let root = scratch("resume");
        let loc = layout(&root);
        fs::create_dir_all(&loc.config_old).unwrap();
        fs::create_dir_all(&loc.config_new).unwrap();
        let db = sqlite_bytes(b"same");
        fs::write(loc.config_old.join(OLD_DB), &db).unwrap();
        fs::write(loc.config_new.join(NEW_DB), &db).unwrap();
        assert_eq!(run(&loc).unwrap().unwrap().status, Status::Migrated);
    }

    #[cfg(windows)]
    #[test]
    fn copies_webview_local_storage_without_the_lock_file() {
        let root = scratch("web");
        let loc = layout(&root);
        let store = WEBVIEW_STORAGE
            .iter()
            .fold(loc.local_old.clone(), |p, part| p.join(part))
            .join("leveldb");
        fs::create_dir_all(&store).unwrap();
        fs::write(store.join("000003.log"), b"settings").unwrap();
        fs::write(store.join("LOCK"), b"").unwrap();

        run(&loc).unwrap();
        let dest = WEBVIEW_STORAGE
            .iter()
            .fold(loc.local_new.clone(), |p, part| p.join(part))
            .join("leveldb");
        assert_eq!(fs::read(dest.join("000003.log")).unwrap(), b"settings");
        assert!(!dest.join("LOCK").exists());
    }

    /// Manual check against a copy of real data: set `GEEKED_MIGRATION_SAMPLE` to a folder that
    /// holds `Roaming/dev.engineerlish.programish` (and optionally `Local/...`), then run
    /// `cargo test -- --ignored real_data_sample`.
    #[test]
    #[ignore]
    fn real_data_sample() {
        let sample = PathBuf::from(std::env::var("GEEKED_MIGRATION_SAMPLE").expect("sample dir"));
        let out = scratch("sample-out");
        let loc = Locations {
            config_old: sample.join("Roaming").join(OLD_IDENTIFIER),
            local_old: sample.join("Local").join(OLD_IDENTIFIER),
            config_new: out.join("Roaming").join("com.engineerlish.geeked"),
            local_new: out.join("Local").join("com.engineerlish.geeked"),
        };
        let marker = run(&loc).unwrap().expect("ran");
        println!("{marker:#?}\nnew data in {}", out.display());
    }
}
