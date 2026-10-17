//! Where the app keeps its data, so Settings can show it and open the folder.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Same file name as `DB_URL` in lib.rs (`sqlite:command-center.db`).
pub const DB_FILE: &str = "command-center.db";

#[derive(Serialize)]
pub struct DataLocation {
    pub dir: String,
    pub db_file: String,
}

/// The SQL plugin resolves relative `sqlite:` paths against the app config directory.
fn locate(config_dir: PathBuf) -> DataLocation {
    DataLocation {
        dir: config_dir.display().to_string(),
        db_file: config_dir.join(DB_FILE).display().to_string(),
    }
}

#[tauri::command]
pub fn data_location(app: AppHandle) -> Result<DataLocation, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(locate(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_file_sits_inside_the_directory() {
        let found = locate(PathBuf::from("cfg"));
        assert_eq!(found.dir, "cfg");
        assert!(found.db_file.starts_with("cfg"));
        assert!(found.db_file.ends_with(DB_FILE));
    }
}
