mod bridge;
mod data;
mod lock;
mod migrate;
mod preview;
mod secrets;
mod system;

use tauri::{Manager, WebviewWindowBuilder};

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection string the frontend passes to `Database.load` (see src/lib/db.ts).
const DB_URL: &str = "sqlite:geeked.db";

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
    ]
}

/// Copies data from the app's former name, once. A failure is logged and retried on the next
/// start; the app still opens, on whatever data the new location has.
fn migrate_previous_data(app: &tauri::AppHandle) {
    let path = app.path();
    let (Ok(config), Ok(local)) = (path.app_config_dir(), path.app_local_data_dir()) else {
        return;
    };
    let Some(loc) = migrate::Locations::from_new(config, local) else {
        return;
    };
    match migrate::run(&loc) {
        Ok(Some(marker)) => eprintln!(
            "[geeked] migrated {} file(s) from {}",
            marker.files.len(),
            marker.from
        ),
        Ok(None) => {}
        Err(e) => eprintln!("[geeked] data migration did not complete: {e}"),
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
        .register_uri_scheme_protocol("preview", preview::handle)
        .setup(|app| {
            // The window is created here, not from the config (`create: false`), so the data
            // from before the rename is in place before the webview opens its profile.
            migrate_previous_data(app.handle());
            if let Ok(dir) = app.path().app_config_dir() {
                app.state::<system::SystemState>().set(system::load(&dir));
            }
            system::build_tray(app.handle())?;
            for config in &app.config().app.windows {
                WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            Ok(())
        })
        .on_window_event(system::on_window_event)
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send,
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
            system::system_set_close_behavior
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geeked");
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
