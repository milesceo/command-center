//! Provider API keys in the operating system's credential store (Windows Credential Manager
//! on Windows, Keychain on macOS, the kernel keyring on Linux).
//!
//! Keys are never written to SQLite, to config files or to logs, and nothing here logs a
//! value. The webview can ask whether a key exists and can read it back to hand it to the
//! bridge for a single request; it is otherwise never kept in JavaScript state.

use keyring::Entry;
use tauri::State;

use crate::legacy_keys::KeysReady;

pub(crate) const SERVICE: &str = "command-center";

/// Providers that may have a key. Anything else is refused so the webview cannot create
/// arbitrary entries under the app's service name.
pub(crate) const PROVIDERS: [&str; 4] = ["claude", "openai", "xai", "huggingface"];

fn entry(provider: &str) -> Result<Entry, String> {
    if !PROVIDERS.contains(&provider) {
        return Err(format!("Unknown provider: {provider}"));
    }
    Entry::new(SERVICE, &format!("api-key:{provider}")).map_err(|e| e.to_string())
}

fn set(provider: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    entry(provider)?
        .set_password(key)
        .map_err(|e| e.to_string())
}

fn get(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The key commands are `async` so Tauri runs them off the main thread: they can wait on the
/// one-time copy (`KeysReady`) while a Keychain prompt is up, and the window must stay usable.
#[tauri::command]
pub async fn secret_set(
    ready: State<'_, KeysReady>,
    provider: String,
    key: String,
) -> Result<(), String> {
    ready.wait();
    set(&provider, &key)
}

#[tauri::command]
pub async fn secret_exists(ready: State<'_, KeysReady>, provider: String) -> Result<bool, String> {
    ready.wait();
    Ok(get(&provider)?.is_some())
}

#[tauri::command]
pub async fn secret_get(
    ready: State<'_, KeysReady>,
    provider: String,
) -> Result<Option<String>, String> {
    ready.wait();
    get(&provider)
}

#[tauri::command]
pub async fn secret_delete(ready: State<'_, KeysReady>, provider: String) -> Result<(), String> {
    ready.wait();
    delete(&provider)
}

/// Removes every stored key (used by "Forgot PIN" and reset).
#[tauri::command]
pub async fn secret_wipe(ready: State<'_, KeysReady>) -> Result<(), String> {
    ready.wait();
    for provider in PROVIDERS {
        delete(provider)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::mock::MockCredentialBuilder;

    #[test]
    fn rejects_unknown_providers_and_empty_keys() {
        assert!(entry("someone-else").is_err());
        assert!(set("openai", "   ").is_err());
    }

    #[test]
    fn the_mock_store_round_trips_and_missing_entries_read_as_none() {
        // The mock keeps state per entry object, so exercise the same Entry for each step.
        keyring::set_default_credential_builder(Box::new(MockCredentialBuilder {}));
        let e = Entry::new(SERVICE, "api-key:openai").unwrap();
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
        e.set_password("sk-test").unwrap();
        assert_eq!(e.get_password().unwrap(), "sk-test");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
    }
}
