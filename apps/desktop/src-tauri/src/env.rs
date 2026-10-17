//! The app's own environment variables. They are named `COMMAND_CENTER_*`; for one release the
//! names from before the rename (`GEEKED_*`) still work, with a deprecation warning on stderr
//! (printed once per variable), so existing scripts keep running. Remove the fallback in the
//! release after next. With `migrate.rs` and `legacy_keys.rs` this is one of the few places the
//! old name may appear.

use std::collections::HashSet;
use std::sync::Mutex;

static WARNED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Reads `COMMAND_CENTER_<name>`, falling back to `GEEKED_<name>`. An empty or blank value counts as unset.
pub fn app_env(name: &str, get: impl Fn(&str) -> Option<String>) -> Option<String> {
    let set = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    if let Some(value) = set(get(&format!("COMMAND_CENTER_{name}"))) {
        return Some(value);
    }
    let legacy = format!("GEEKED_{name}");
    let value = set(get(&legacy))?;
    let first = WARNED
        .lock()
        .map(|mut w| w.get_or_insert_with(HashSet::new).insert(legacy.clone()))
        .unwrap_or(true);
    if first {
        eprintln!(
            "[command-center] {legacy} is deprecated and will stop working in a future release; \
             use COMMAND_CENTER_{name}."
        );
    }
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_current_name_and_falls_back_to_the_old_one() {
        let both = |k: &str| match k {
            "COMMAND_CENTER_BRIDGE_ENTRY" => Some("/new".to_string()),
            "GEEKED_BRIDGE_ENTRY" => Some("/old".to_string()),
            _ => None,
        };
        assert_eq!(app_env("BRIDGE_ENTRY", both).as_deref(), Some("/new"));
        let old = |k: &str| (k == "GEEKED_BRIDGE_ENTRY").then(|| "/old".to_string());
        assert_eq!(app_env("BRIDGE_ENTRY", old).as_deref(), Some("/old"));
        assert_eq!(app_env("BRIDGE_ENTRY", |_| None), None);
    }

    #[test]
    fn an_empty_value_counts_as_unset() {
        let empty_new = |k: &str| match k {
            "COMMAND_CENTER_X" => Some(String::new()),
            "GEEKED_X" => Some("/old".to_string()),
            _ => None,
        };
        assert_eq!(app_env("X", empty_new).as_deref(), Some("/old"));
        assert_eq!(app_env("Y", |_| Some(String::new())), None);
        assert_eq!(app_env("Z", |_| Some("  ".to_string())), None);
    }
}
