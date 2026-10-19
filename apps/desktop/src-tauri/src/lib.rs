mod bridge;
mod data;
mod env;
mod gui_path;
mod legacy_keys;
mod lock;
mod migrate;
mod preview;
mod secrets;
mod system;

use tauri::{Manager, WebviewWindowBuilder};

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection string the frontend passes to `Database.load` (see src/lib/db.ts).
const DB_URL: &str = "sqlite:command-center.db";

/// Schema migrations, applied in order by the SQL plugin on first `load`.
/// Add new files under `migrations/` and append them here; never edit shipped ones.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema: conversations and messages",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "chat core: pinning, conversation settings, message metadata",
            sql: include_str!("../migrations/0002_chat_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "usage ledger, prompt library and projects",
            sql: include_str!("../migrations/0003_usage_prompts_projects.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "per-conversation provider",
            sql: include_str!("../migrations/0004_providers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "custom models (Model Lab)",
            sql: include_str!("../migrations/0005_custom_models.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "business plans",
            sql: include_str!("../migrations/0006_business_plans.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Copies data from the app's former names, once, before any window exists.
///
/// The migration is all or nothing, so a failure leaves the new location empty. It must stay
/// empty for a retry to work: opening the app now would create a new database and webview
/// profile that the next attempt could not overwrite. So the user is asked, with a native
/// message box (the event loop is not running yet, so the dialog plugin cannot be used), to
/// either quit and retry after closing the previous version, or start without the old data,
/// which is recorded so the migration is not attempted again.
fn migrate_previous_data(app: &tauri::AppHandle) {
    let path = app.path();
    let (Ok(config), Ok(local)) = (path.app_config_dir(), path.app_local_data_dir()) else {
        return;
    };
    // WKWebView keeps website data (localStorage) outside the app folders, keyed by identifier.
    let website_data = if cfg!(target_os = "macos") {
        path.home_dir().ok().map(|home| {
            home.join("Library")
                .join("WebKit")
                .join(&app.config().identifier)
                .join("WebsiteData")
        })
    } else {
        None
    };
    let Some(loc) = migrate::Locations::from_new(config, local, website_data) else {
        return;
    };
    match migrate::run(&loc) {
        Ok(Some(marker)) => eprintln!(
            "[command-center] migrated {} file(s) from {}",
            marker.files.len(),
            marker.from
        ),
        Ok(None) => {}
        Err(e) => {
            eprintln!("[command-center] data migration did not complete: {e}");
            let start_anyway = rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Warning)
                .set_title("Command Center could not move your data")
                .set_description(format!(
                    "Your chats, settings and PIN from the previous version were not copied:\n\n{e}\n\n\
                     If the previous version is still running, quit it (check the system tray) and \
                     start Command Center again. Nothing has been changed yet.\n\n\
                     Start without the old data instead? It stays where it is, but Command Center \
                     will not try to copy it again."
                ))
                .set_buttons(rfd::MessageButtons::OkCancelCustom(
                    "Quit".into(),
                    "Start without old data".into(),
                ))
                .show();
            if start_anyway == rfd::MessageDialogResult::Custom("Start without old data".into()) {
                if let Err(e) = migrate::skip(&loc, &e) {
                    eprintln!("[command-center] could not record the skipped migration: {e}");
                }
            } else {
                std::process::exit(0);
            }
        }
    }
}

/// Copies API keys from the old credential-store service once, then releases the key commands.
/// They are released however this ends: no config folder, an error, or a panic in the copy.
fn migrate_legacy_keys(app: &tauri::AppHandle) {
    let _release = legacy_keys::ReleaseOnDrop(app.state::<legacy_keys::KeysReady>().inner());
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let failures_are_final = cfg!(target_os = "macos");
    match legacy_keys::migrate_legacy_keys_once(&dir, &legacy_keys::OsStore, failures_are_final) {
        Ok(Some(copied)) if !copied.is_empty() => eprintln!(
            "[command-center] copied {} API key(s) from the previous name",
            copied.len()
        ),
        Ok(_) => {}
        Err(e) => eprintln!("[command-center] API key migration did not complete: {e}"),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(bridge::BridgeState::default())
        .manage(lock::LockGuard::default())
        .manage(system::SystemState::default())
        .manage(preview::PreviewStore::default())
        .manage(legacy_keys::KeysReady::default())
        .register_uri_scheme_protocol("preview", preview::handle)
        .setup(|app| {
            // The window is created here, not from the config (`create: false`), so the data
            // from before the rename is in place before the webview opens its profile.
            migrate_previous_data(app.handle());
            // API keys stored under the old credential-store service; values are never logged.
            // On macOS this waits until the window is up (below): reading another app's
            // Keychain items can raise a prompt, which must not appear before the app does.
            if !cfg!(target_os = "macos") {
                migrate_legacy_keys(app.handle());
            }
            if let Ok(dir) = app.path().app_config_dir() {
                app.state::<system::SystemState>().set(system::load(&dir));
            }
            system::build_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            system::build_app_menu(app.handle())?;
            for config in &app.config().app.windows {
                WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            if cfg!(target_os = "macos") {
                let handle = app.handle().clone();
                std::thread::spawn(move || migrate_legacy_keys(&handle));
            }
            bridge::start_at_launch_if_asked(app.handle());
            Ok(())
        })
        .on_window_event(system::on_window_event)
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send,
            bridge::bridge_stop,
            data::data_location,
            preview::preview_set,
            lock::lock_status,
            lock::lock_set_pin,
            lock::lock_verify,
            lock::lock_change,
            lock::lock_remove,
            lock::lock_wipe,
            secrets::secret_set,
            secrets::secret_exists,
            secrets::secret_get,
            secrets::secret_delete,
            secrets::secret_wipe,
            system::system_set_close_behavior,
            system::system_power_state,
            system::system_memory
        ])
        .build(tauri::generate_context!())
        .expect("error while building Command Center")
        .run(system::on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_sequential_and_nonempty() {
        for (i, m) in migrations().iter().enumerate() {
            assert_eq!(m.version, (i as i64) + 1);
            assert!(!m.sql.trim().is_empty());
        }
    }
}
