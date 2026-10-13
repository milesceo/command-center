mod bridge;
mod preview;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection string the frontend passes to `Database.load` (see src/lib/db.ts).
const DB_URL: &str = "sqlite:programish.db";

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
    ]
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
        .manage(bridge::BridgeState::default())
        .manage(preview::PreviewStore::default())
        .register_uri_scheme_protocol("preview", preview::handle)
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send,
            preview::preview_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running Programish");
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
