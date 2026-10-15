//! The app lock: PIN hashing, verification and attempt rate-limiting, all on the Rust side.
//!
//! The PIN is never stored. What is stored is an Argon2id PHC string (it carries its own random
//! salt and parameters) in `lock.json` inside the app config directory, together with the
//! failed-attempt counter and the time until which attempts are refused, so the delay survives
//! a restart and cannot be reset by editing webview storage.
//!
//! This is a screen lock, not disk encryption: the chat database is a plain SQLite file.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub const PIN_MIN: usize = 4;
pub const PIN_MAX: usize = 8;
const FILE: &str = "lock.json";
/// Wrong attempts allowed before waiting starts.
const FREE_ATTEMPTS: u32 = 5;
const BASE_DELAY_SECS: u64 = 30;
const MAX_DELAY_SECS: u64 = 300;

/// Seconds to wait after `failures` consecutive wrong PINs: none for the first few, then 30 s
/// doubling up to 5 minutes.
pub fn delay_secs(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let doublings = (failures - FREE_ATTEMPTS).min(10);
    (BASE_DELAY_SECS << doublings).min(MAX_DELAY_SECS)
}

/// 4 to 8 characters (Unicode scalar values); letters, digits and symbols are all allowed.
pub fn pin_is_valid(pin: &str) -> bool {
    let n = pin.chars().count();
    (PIN_MIN..=PIN_MAX).contains(&n) && !pin.chars().any(char::is_control)
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Record {
    /// Argon2id PHC string; `None` when no PIN is set.
    phc: Option<String>,
    failures: u32,
    /// Epoch milliseconds until which verification is refused.
    locked_until_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    pub has_pin: bool,
    pub failures: u32,
    pub locked_until_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerifyOutcome {
    /// No PIN is set, so there is nothing to check.
    NoPin,
    Ok,
    Wrong,
    /// Too many attempts; `locked_until_ms` says when trying reopens.
    Wait,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub outcome: VerifyOutcome,
    pub failures: u32,
    pub locked_until_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The lock state behind a directory. `clock` is injectable so tests control time.
pub struct LockStore {
    path: PathBuf,
    clock: fn() -> u64,
}

impl LockStore {
    pub fn new(dir: &Path) -> Self {
        Self::with_clock(dir, now_ms)
    }

    pub fn with_clock(dir: &Path, clock: fn() -> u64) -> Self {
        Self {
            path: dir.join(FILE),
            clock,
        }
    }

    fn read(&self) -> Record {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn write(&self, record: &Record) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("create lock folder: {e}"))?;
        }
        let json = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
        // Write beside the file and rename, so a crash never leaves a half-written record.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("write lock: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("write lock: {e}"))
    }

    pub fn status(&self) -> LockStatus {
        let r = self.read();
        LockStatus {
            has_pin: r.phc.is_some(),
            failures: r.failures,
            locked_until_ms: r.locked_until_ms,
        }
    }

    /// Sets or replaces the PIN. Callers verify the old one first when replacing.
    pub fn set_pin(&self, pin: &str) -> Result<(), String> {
        if !pin_is_valid(pin) {
            return Err(format!("Use {PIN_MIN} to {PIN_MAX} characters."));
        }
        let salt = SaltString::generate(&mut OsRng);
        let phc = Argon2::default()
            .hash_password(pin.as_bytes(), &salt)
            .map_err(|e| format!("hash PIN: {e}"))?
            .to_string();
        self.write(&Record {
            phc: Some(phc),
            failures: 0,
            locked_until_ms: 0,
        })
    }

    pub fn verify(&self, pin: &str) -> Result<VerifyResult, String> {
        let mut record = self.read();
        let now = (self.clock)();
        let result = |outcome, r: &Record| VerifyResult {
            outcome,
            failures: r.failures,
            locked_until_ms: r.locked_until_ms,
        };
        let Some(phc) = record.phc.clone() else {
            return Ok(result(VerifyOutcome::NoPin, &record));
        };
        if record.locked_until_ms > now {
            return Ok(result(VerifyOutcome::Wait, &record));
        }
        let parsed =
            PasswordHash::new(&phc).map_err(|e| format!("stored PIN is unreadable: {e}"))?;
        if Argon2::default()
            .verify_password(pin.as_bytes(), &parsed)
            .is_ok()
        {
            record.failures = 0;
            record.locked_until_ms = 0;
            self.write(&record)?;
            return Ok(result(VerifyOutcome::Ok, &record));
        }
        record.failures = record.failures.saturating_add(1);
        let wait = delay_secs(record.failures);
        record.locked_until_ms = if wait > 0 { now + wait * 1000 } else { 0 };
        self.write(&record)?;
        let outcome = if wait > 0 {
            VerifyOutcome::Wait
        } else {
            VerifyOutcome::Wrong
        };
        Ok(result(outcome, &record))
    }

    /// Removes the PIN and the attempt counters (the caller has already verified or is wiping).
    pub fn clear(&self) -> Result<(), String> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("remove lock: {e}")),
        }
    }
}

// ----------------------------------------------------------------- commands

/// Serializes commands so two verifications cannot both read the same failure count.
#[derive(Default)]
pub struct LockGuard(Mutex<()>);

fn store(app: &AppHandle) -> Result<LockStore, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(LockStore::new(&dir))
}

#[tauri::command]
pub fn lock_status(app: AppHandle) -> Result<LockStatus, String> {
    Ok(store(&app)?.status())
}

#[tauri::command]
pub async fn lock_set_pin(
    app: AppHandle,
    guard: State<'_, LockGuard>,
    pin: String,
) -> Result<(), String> {
    let store = store(&app)?;
    let _g = guard.0.lock().map_err(|e| e.to_string())?;
    // Argon2 is deliberately slow; this is an async command so it runs off the main thread.
    store.set_pin(&pin)
}

#[tauri::command]
pub async fn lock_verify(
    app: AppHandle,
    guard: State<'_, LockGuard>,
    pin: String,
) -> Result<VerifyResult, String> {
    let store = store(&app)?;
    let _g = guard.0.lock().map_err(|e| e.to_string())?;
    store.verify(&pin)
}

/// Replaces the PIN after verifying the current one.
#[tauri::command]
pub async fn lock_change(
    app: AppHandle,
    guard: State<'_, LockGuard>,
    current: String,
    next: String,
) -> Result<VerifyResult, String> {
    let store = store(&app)?;
    let _g = guard.0.lock().map_err(|e| e.to_string())?;
    let result = store.verify(&current)?;
    if result.outcome == VerifyOutcome::Ok {
        store.set_pin(&next)?;
    }
    Ok(result)
}

/// Removes the PIN after verifying it.
#[tauri::command]
pub async fn lock_remove(
    app: AppHandle,
    guard: State<'_, LockGuard>,
    current: String,
) -> Result<VerifyResult, String> {
    let store = store(&app)?;
    let _g = guard.0.lock().map_err(|e| e.to_string())?;
    let result = store.verify(&current)?;
    if result.outcome == VerifyOutcome::Ok {
        store.clear()?;
    }
    Ok(result)
}

/// "Forgot PIN": drops the PIN and the attempt counters without checking anything. The caller
/// (the UI, after an explicit warning) also erases the local chats and API keys.
#[tauri::command]
pub fn lock_wipe(app: AppHandle) -> Result<(), String> {
    store(&app)?.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    // Per-thread so tests running in parallel never see each other's time.
    thread_local! {
        static CLOCK: Cell<u64> = const { Cell::new(1_000_000) };
    }
    fn clock() -> u64 {
        CLOCK.with(Cell::get)
    }
    fn set_clock(ms: u64) {
        CLOCK.with(|c| c.set(ms));
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("geeked-lock-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pin_rules_allow_letters_digits_and_symbols_from_4_to_8() {
        assert!(pin_is_valid("1234"));
        assert!(pin_is_valid("aB3$"));
        assert!(pin_is_valid("p@ss-w0rd".get(..8).unwrap()));
        assert!(pin_is_valid("ünï€!"));
        assert!(!pin_is_valid("123"));
        assert!(!pin_is_valid("123456789"));
        assert!(!pin_is_valid("ab\tcd"));
        assert!(!pin_is_valid(""));
    }

    #[test]
    fn delays_start_after_the_free_attempts_and_cap_at_five_minutes() {
        assert_eq!(delay_secs(0), 0);
        assert_eq!(delay_secs(4), 0);
        assert_eq!(delay_secs(5), 30);
        assert_eq!(delay_secs(6), 60);
        assert_eq!(delay_secs(7), 120);
        assert_eq!(delay_secs(8), 240);
        assert_eq!(delay_secs(9), 300);
        assert_eq!(delay_secs(500), 300);
    }

    #[test]
    fn stores_an_argon2id_hash_and_never_the_pin() {
        let dir = scratch("hash");
        let store = LockStore::with_clock(&dir, clock);
        store.set_pin("Tr33$").unwrap();
        let phc = store.read().phc.unwrap();
        assert!(phc.starts_with("$argon2id$"), "{phc}");
        let raw = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!raw.contains("Tr33$"));
        // Salted: the same PIN hashes differently each time.
        store.set_pin("Tr33$").unwrap();
        assert_ne!(store.read().phc.unwrap(), phc);
    }

    #[test]
    fn verifies_the_right_pin_and_rejects_others() {
        let dir = scratch("verify");
        let store = LockStore::with_clock(&dir, clock);
        assert_eq!(store.verify("1234").unwrap().outcome, VerifyOutcome::NoPin);
        store.set_pin("s3cret!").unwrap();
        assert_eq!(store.verify("s3cret!").unwrap().outcome, VerifyOutcome::Ok);
        assert_eq!(
            store.verify("S3cret!").unwrap().outcome,
            VerifyOutcome::Wrong
        );
        assert!(store.status().has_pin);
    }

    #[test]
    fn rate_limits_failures_with_increasing_delays_that_survive_a_restart() {
        let dir = scratch("limit");
        set_clock(10_000_000);
        let store = LockStore::with_clock(&dir, clock);
        store.set_pin("abcd").unwrap();
        for _ in 0..4 {
            assert_eq!(store.verify("nope!").unwrap().outcome, VerifyOutcome::Wrong);
        }
        // The fifth failure starts the first delay.
        let fifth = store.verify("nope!").unwrap();
        assert_eq!(fifth.outcome, VerifyOutcome::Wait);
        assert_eq!(fifth.locked_until_ms, 10_000_000 + 30_000);

        // Even the right PIN is refused while waiting, and a new store (a restart) agrees.
        let restarted = LockStore::with_clock(&dir, clock);
        assert_eq!(
            restarted.verify("abcd").unwrap().outcome,
            VerifyOutcome::Wait
        );
        assert_eq!(restarted.status().failures, 5);

        // After the delay the right PIN works and resets the counters.
        set_clock(10_000_000 + 30_001);
        let ok = restarted.verify("abcd").unwrap();
        assert_eq!(ok.outcome, VerifyOutcome::Ok);
        assert_eq!((ok.failures, ok.locked_until_ms), (0, 0));
    }

    #[test]
    fn the_next_failure_after_a_delay_doubles_it() {
        let dir = scratch("double");
        set_clock(50_000_000);
        let store = LockStore::with_clock(&dir, clock);
        store.set_pin("abcd").unwrap();
        for _ in 0..5 {
            store.verify("bad!").unwrap();
        }
        set_clock(50_000_000 + 30_001);
        let sixth = store.verify("bad!").unwrap();
        assert_eq!(sixth.outcome, VerifyOutcome::Wait);
        assert_eq!(sixth.locked_until_ms, 50_000_000 + 30_001 + 60_000);
    }

    #[test]
    fn clearing_removes_the_pin_and_counters() {
        let dir = scratch("clear");
        let store = LockStore::with_clock(&dir, clock);
        store.set_pin("abcd").unwrap();
        store.verify("zzzz").unwrap();
        store.clear().unwrap();
        assert_eq!(
            store.status(),
            LockStatus {
                has_pin: false,
                failures: 0,
                locked_until_ms: 0
            }
        );
        assert!(!dir.join(FILE).exists());
        store.clear().unwrap(); // idempotent
    }

    #[test]
    fn rejects_an_invalid_new_pin_without_touching_the_old_one() {
        let dir = scratch("invalid");
        let store = LockStore::with_clock(&dir, clock);
        store.set_pin("abcd").unwrap();
        let before = store.read().phc;
        assert!(store.set_pin("ab").is_err());
        assert_eq!(store.read().phc, before);
    }

    #[test]
    fn a_corrupt_file_counts_as_no_pin() {
        let dir = scratch("corrupt");
        fs::write(dir.join(FILE), "not json").unwrap();
        let store = LockStore::with_clock(&dir, clock);
        assert!(!store.status().has_pin);
    }
}
