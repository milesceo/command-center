//! One-time copy of the stored API keys from the credential-store service the app used before
//! it was renamed to Command Center. Read old, write new, read back and compare; the old entries
//! are never modified or deleted. With `migrate.rs`, `env.rs` and `src/lib/legacy.ts` this is
//! the only place the old name may appear.

use std::path::Path;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use keyring::Entry;

use crate::secrets::{PROVIDERS, SERVICE};

/// Service name the keys were stored under before the rename.
const LEGACY_SERVICE: &str = "geeked";
/// Written in the config directory once every legacy key was copied and verified, so the old
/// entries are not read again (on macOS each read can raise a Keychain prompt).
pub const LEGACY_MARKER: &str = "migrated-keys-from-previous-name.json";

/// The few credential-store operations the key migration needs, so it can be tested with a fake.
pub trait CredentialStore {
    fn get(&self, service: &str, user: &str) -> Result<Option<String>, String>;
    fn set(&self, service: &str, user: &str, value: &str) -> Result<(), String>;
    fn delete(&self, service: &str, user: &str) -> Result<(), String>;
}

/// The operating system's store, through `keyring`.
pub struct OsStore;

impl CredentialStore for OsStore {
    fn get(&self, service: &str, user: &str) -> Result<Option<String>, String> {
        match Entry::new(service, user).and_then(|e| e.get_password()) {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, service: &str, user: &str, value: &str) -> Result<(), String> {
        Entry::new(service, user)
            .and_then(|e| e.set_password(value))
            .map_err(|e| e.to_string())
    }

    fn delete(&self, service: &str, user: &str) -> Result<(), String> {
        match Entry::new(service, user).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Copies each provider's key from the old service to the new one: read old, write new, read
/// the new entry back and compare. A key already stored under the new service is kept as is. A
/// copy that does not read back identically is removed again and reported, so a half-written
/// entry never shadows the good old one. The old entries are never modified or deleted.
/// Returns the providers whose key was copied. Never logs or returns a value.
/// Copies every provider's key it can; returns the providers copied and the failures.
fn copy_all(store: &dyn CredentialStore) -> (Vec<String>, Vec<String>) {
    let mut copied = Vec::new();
    let mut failures = Vec::new();
    for provider in PROVIDERS {
        let user = format!("api-key:{provider}");
        let result = (|| -> Result<bool, String> {
            if store.get(SERVICE, &user)?.is_some() {
                return Ok(false);
            }
            let Some(old) = store.get(LEGACY_SERVICE, &user)? else {
                return Ok(false);
            };
            store.set(SERVICE, &user, &old)?;
            if store.get(SERVICE, &user)?.as_deref() != Some(old.as_str()) {
                let _ = store.delete(SERVICE, &user);
                return Err("the copy did not read back identically".into());
            }
            Ok(true)
        })();
        match result {
            Ok(true) => copied.push(provider.to_string()),
            Ok(false) => {}
            Err(e) => failures.push(format!("{provider}: {e}")),
        }
    }
    (copied, failures)
}

/// Copies each provider's key from the old service (see `copy_all`); any failure is an error.
#[cfg(test)]
fn migrate_legacy_keys(store: &dyn CredentialStore) -> Result<Vec<String>, String> {
    let (copied, failures) = copy_all(store);
    if failures.is_empty() {
        Ok(copied)
    } else {
        Err(failures.join("; "))
    }
}

/// Runs the copy once per install: skipped when the marker exists. Normally the marker is written
/// only after every key copied cleanly, so a failure is retried on the next start. With
/// `failures_are_final` (macOS, where a failed read is usually a Keychain prompt the user
/// denied, and retrying would prompt again on every launch) the marker is written anyway and
/// lists the providers that were skipped; their keys can be entered again in Settings.
pub fn migrate_legacy_keys_once(
    config_dir: &Path,
    store: &dyn CredentialStore,
    failures_are_final: bool,
) -> Result<Option<Vec<String>>, String> {
    let marker = config_dir.join(LEGACY_MARKER);
    if marker.exists() {
        return Ok(None);
    }
    let (copied, failures) = copy_all(store);
    if !failures.is_empty() && !failures_are_final {
        return Err(failures.join("; "));
    }
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let skipped: Vec<&str> = failures
        .iter()
        .filter_map(|f| f.split(':').next())
        .collect();
    let json =
        serde_json::json!({ "from": LEGACY_SERVICE, "providers": copied, "skipped": skipped });
    std::fs::write(&marker, json.to_string()).map_err(|e| e.to_string())?;
    if failures.is_empty() {
        Ok(Some(copied))
    } else {
        Err(format!("skipped for good: {}", failures.join("; ")))
    }
}

/// Lets the key commands wait until the one-time copy has finished. On macOS the copy runs on a
/// background thread after the window opens (a Keychain prompt must not appear before the app
/// does), so the first `secret_get` could otherwise race it and miss a key.
#[derive(Default)]
pub struct KeysReady {
    done: Mutex<bool>,
    changed: Condvar,
}

/// How long a key command waits for the copy (a Keychain prompt waits on the user).
const READY_TIMEOUT: Duration = Duration::from_secs(30);

impl KeysReady {
    pub fn mark_done(&self) {
        let mut done = match self.done.lock() {
            Ok(done) => done,
            Err(poisoned) => poisoned.into_inner(),
        };
        *done = true;
        self.changed.notify_all();
    }

    /// Returns once the copy is done, or after the timeout (the command then proceeds anyway).
    pub fn wait(&self) {
        self.wait_for(READY_TIMEOUT);
    }

    /// `wait` with a given timeout. A timeout counts as done, so only the first caller ever
    /// waits for a copy that never finishes.
    fn wait_for(&self, timeout: Duration) {
        let done = match self.done.lock() {
            Ok(done) => done,
            Err(poisoned) => poisoned.into_inner(),
        };
        let (mut done, _) = match self
            .changed
            .wait_timeout_while(done, timeout, |done| !*done)
        {
            Ok(result) => result,
            Err(poisoned) => poisoned.into_inner(),
        };
        *done = true;
    }
}

/// Marks the copy done when dropped, so a panic or an early return still releases the waiters.
pub struct ReleaseOnDrop<'a>(pub &'a KeysReady);

impl Drop for ReleaseOnDrop<'_> {
    fn drop(&mut self) {
        self.0.mark_done();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// In-memory store; `corrupt_writes` makes `set` store a different value than it was given.
    #[derive(Default)]
    struct FakeStore {
        map: RefCell<HashMap<(String, String), String>>,
        corrupt_writes: bool,
    }

    impl FakeStore {
        fn with(entries: &[(&str, &str, &str)]) -> Self {
            let s = Self::default();
            for (service, user, value) in entries {
                s.map
                    .borrow_mut()
                    .insert((service.to_string(), user.to_string()), value.to_string());
            }
            s
        }
        fn value(&self, service: &str, user: &str) -> Option<String> {
            self.map
                .borrow()
                .get(&(service.to_string(), user.to_string()))
                .cloned()
        }
    }

    impl CredentialStore for FakeStore {
        fn get(&self, service: &str, user: &str) -> Result<Option<String>, String> {
            Ok(self.value(service, user))
        }
        fn set(&self, service: &str, user: &str, value: &str) -> Result<(), String> {
            let stored = if self.corrupt_writes {
                format!("{value}?")
            } else {
                value.to_string()
            };
            self.map
                .borrow_mut()
                .insert((service.to_string(), user.to_string()), stored);
            Ok(())
        }
        fn delete(&self, service: &str, user: &str) -> Result<(), String> {
            self.map
                .borrow_mut()
                .remove(&(service.to_string(), user.to_string()));
            Ok(())
        }
    }

    #[test]
    fn copies_old_keys_to_the_new_service_and_leaves_the_old_ones() {
        let store = FakeStore::with(&[
            (LEGACY_SERVICE, "api-key:xai", "xai-secret"),
            (LEGACY_SERVICE, "api-key:openai", "sk-old"),
        ]);
        let mut copied = migrate_legacy_keys(&store).unwrap();
        copied.sort();
        assert_eq!(copied, ["openai", "xai"]);
        assert_eq!(
            store.value(SERVICE, "api-key:xai").as_deref(),
            Some("xai-secret")
        );
        assert_eq!(
            store.value(SERVICE, "api-key:openai").as_deref(),
            Some("sk-old")
        );
        assert_eq!(
            store.value(LEGACY_SERVICE, "api-key:xai").as_deref(),
            Some("xai-secret")
        );
    }

    #[test]
    fn keeps_a_key_already_stored_under_the_new_service() {
        let store = FakeStore::with(&[
            (LEGACY_SERVICE, "api-key:xai", "old"),
            (SERVICE, "api-key:xai", "new"),
        ]);
        assert!(migrate_legacy_keys(&store).unwrap().is_empty());
        assert_eq!(store.value(SERVICE, "api-key:xai").as_deref(), Some("new"));
    }

    #[test]
    fn a_copy_that_does_not_verify_is_removed_and_reported() {
        let mut store = FakeStore::with(&[(LEGACY_SERVICE, "api-key:xai", "xai-secret")]);
        store.corrupt_writes = true;
        let err = migrate_legacy_keys(&store).unwrap_err();
        assert!(err.contains("xai"));
        assert!(!err.contains("xai-secret"), "errors never carry the key");
        assert_eq!(store.value(SERVICE, "api-key:xai"), None);
        assert_eq!(
            store.value(LEGACY_SERVICE, "api-key:xai").as_deref(),
            Some("xai-secret")
        );
    }

    #[test]
    fn nothing_to_copy_on_a_fresh_install() {
        assert!(migrate_legacy_keys(&FakeStore::default())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn runs_once_and_retries_after_a_failure() {
        let dir =
            std::env::temp_dir().join(format!("command-center-secrets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut failing = FakeStore::with(&[(LEGACY_SERVICE, "api-key:xai", "SECRET-VALUE")]);
        failing.corrupt_writes = true;
        assert!(migrate_legacy_keys_once(&dir, &failing, false).is_err());
        assert!(!dir.join(LEGACY_MARKER).exists());

        let store = FakeStore::with(&[(LEGACY_SERVICE, "api-key:xai", "SECRET-VALUE")]);
        assert_eq!(
            migrate_legacy_keys_once(&dir, &store, false).unwrap(),
            Some(vec!["xai".to_string()])
        );
        assert!(dir.join(LEGACY_MARKER).is_file());
        let marker = std::fs::read_to_string(dir.join(LEGACY_MARKER)).unwrap();
        assert!(
            !marker.contains("SECRET-VALUE"),
            "no key value in the marker"
        );
        assert_eq!(migrate_legacy_keys_once(&dir, &store, false).unwrap(), None);
    }

    #[test]
    fn on_macos_a_failed_read_is_final_and_names_the_provider() {
        let dir =
            std::env::temp_dir().join(format!("command-center-keys-final-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = FakeStore::with(&[(LEGACY_SERVICE, "api-key:xai", "SECRET-VALUE")]);
        store.corrupt_writes = true;
        let err = migrate_legacy_keys_once(&dir, &store, true).unwrap_err();
        assert!(err.contains("xai"));
        let marker = std::fs::read_to_string(dir.join(LEGACY_MARKER)).unwrap();
        assert!(marker.contains("\"skipped\":[\"xai\"]"), "{marker}");
        assert!(!marker.contains("SECRET-VALUE"));
        // Not attempted again.
        assert_eq!(migrate_legacy_keys_once(&dir, &store, true).unwrap(), None);
    }

    #[test]
    fn the_ready_gate_releases_waiters() {
        let ready = std::sync::Arc::new(KeysReady::default());
        let waiter = {
            let ready = ready.clone();
            std::thread::spawn(move || ready.wait())
        };
        ready.mark_done();
        waiter.join().unwrap();
        ready.wait(); // already done: returns at once
    }

    #[test]
    fn a_timed_out_wait_counts_as_done_for_everyone_after() {
        let ready = KeysReady::default();
        let started = std::time::Instant::now();
        ready.wait_for(Duration::from_millis(20));
        assert!(started.elapsed() >= Duration::from_millis(20));
        let again = std::time::Instant::now();
        ready.wait_for(Duration::from_secs(5));
        assert!(again.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn the_release_guard_marks_done_even_on_panic() {
        let ready = std::sync::Arc::new(KeysReady::default());
        let inner = ready.clone();
        let _ = std::thread::spawn(move || {
            let _release = ReleaseOnDrop(&inner);
            panic!("copy failed");
        })
        .join();
        let started = std::time::Instant::now();
        ready.wait_for(Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /// A store whose reads of the old service fail, like a denied Keychain prompt.
    struct DeniedStore;
    impl CredentialStore for DeniedStore {
        fn get(&self, service: &str, _user: &str) -> Result<Option<String>, String> {
            if service == LEGACY_SERVICE {
                Err("User canceled the operation.".into())
            } else {
                Ok(None)
            }
        }
        fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn delete(&self, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn a_denied_keychain_read_is_retried_off_macos_and_final_on_macos() {
        let dir =
            std::env::temp_dir().join(format!("command-center-keys-denied-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(migrate_legacy_keys_once(&dir, &DeniedStore, false).is_err());
        assert!(!dir.join(LEGACY_MARKER).exists(), "retried next start");
        assert!(migrate_legacy_keys_once(&dir, &DeniedStore, true).is_err());
        let marker = std::fs::read_to_string(dir.join(LEGACY_MARKER)).unwrap();
        assert!(
            marker.contains("\"skipped\":[\"claude\",\"openai\",\"xai\",\"huggingface\"]"),
            "{marker}"
        );
        assert_eq!(
            migrate_legacy_keys_once(&dir, &DeniedStore, true).unwrap(),
            None
        );
    }
}
