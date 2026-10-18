//! System behavior: what closing the window does, the tray icon, and the macOS app menu.
//!
//! The close behavior lives here (not only in the webview) so it applies the moment the window
//! exists, and so "minimize to tray" works even if the webview is busy. It is kept in
//! `system.json` in the app config directory and set from Settings through a command.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};

const FILE: &str = "system.json";
/// The main window's label (the default for the single window in tauri.conf.json).
const MAIN: &str = "main";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    /// Closing the window quits the app.
    Quit,
    /// Closing the window hides it to the tray; "Quit" in the tray menu really exits.
    Tray,
}

#[derive(Debug, Serialize, Deserialize)]
struct Saved {
    close_behavior: CloseBehavior,
}

/// Shared with the window-event handler, which runs on another thread.
#[derive(Default)]
pub struct SystemState {
    close_to_tray: AtomicBool,
}

impl SystemState {
    pub fn set(&self, behavior: CloseBehavior) {
        self.close_to_tray
            .store(behavior == CloseBehavior::Tray, Ordering::SeqCst);
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }
}

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn load(dir: &Path) -> CloseBehavior {
    fs::read_to_string(file(dir))
        .ok()
        .and_then(|text| serde_json::from_str::<Saved>(&text).ok())
        .map(|s| s.close_behavior)
        .unwrap_or(CloseBehavior::Quit)
}

pub fn save(dir: &Path, behavior: CloseBehavior) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&Saved {
        close_behavior: behavior,
    })
    .map_err(|e| e.to_string())?;
    fs::write(file(dir), text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn system_set_close_behavior(
    app: AppHandle,
    state: State<'_, SystemState>,
    behavior: CloseBehavior,
) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    save(&dir, behavior)?;
    state.set(behavior);
    Ok(())
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = app.emit("command-center://window-visible", true);
    }
}

/// Builds the tray icon and its menu. Called once from setup.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Open Command Center").build(app)?;
    let new_chat = MenuItemBuilder::with_id("new-chat", "New chat").build(app)?;
    let lock = MenuItemBuilder::with_id("lock", "Lock").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &new_chat, &lock, &quit])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("command-center")
        .tooltip("Command Center")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "new-chat" => {
                show_main(app);
                let _ = app.emit("command-center://new-chat", ());
            }
            "lock" => {
                let _ = app.emit("command-center://lock", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if cfg!(target_os = "macos") {
        // A template image: macOS uses only its alpha and tints it for the light or dark menu bar.
        let icon =
            tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?;
        builder = builder.icon(icon).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// The standard macOS menu bar: the app menu (About, Settings, Services, Hide, Quit), Edit (so
/// copy, paste and undo reach the webview through the usual shortcuts) and Window. Settings
/// opens the app's own Settings view through `command-center://settings`.
#[cfg(target_os = "macos")]
pub fn build_app_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadataBuilder, PredefinedMenuItem, SubmenuBuilder};

    let about = AboutMetadataBuilder::new()
        .name(Some("Command Center"))
        .version(Some(app.package_info().version.to_string()))
        .build();
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Command Center")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Command Center"),
            Some(about),
        )?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Command Center"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Command Center"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "settings" {
            show_main(app);
            let _ = app.emit("command-center://settings", ());
        }
    });
    Ok(())
}

/// What macOS says about power, for the performance tier (`effectiveTier` in the app).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerState {
    /// False where it cannot be read (other platforms, `pmset` missing).
    pub known: bool,
    pub on_battery: bool,
    pub low_power: bool,
}

/// `pmset -g batt` names the source: "Now drawing from 'Battery Power'" or "'AC Power'".
pub fn on_battery_from_pmset(batt: &str) -> bool {
    batt.contains("'Battery Power'")
}

/// `pmset -g` lists `lowpowermode 1` while Low Power Mode is on.
pub fn low_power_from_pmset(settings: &str) -> bool {
    settings.lines().any(|line| {
        let mut words = line.split_whitespace();
        words.next() == Some("lowpowermode") && words.next() == Some("1")
    })
}

/// Reads the power source and Low Power Mode (macOS; about 10 ms, the app asks once a minute).
#[tauri::command]
pub async fn system_power_state() -> PowerState {
    let unknown = PowerState {
        known: false,
        on_battery: false,
        low_power: false,
    };
    if !cfg!(target_os = "macos") {
        return unknown;
    }
    let read = |args: &[&str]| {
        std::process::Command::new("/usr/bin/pmset")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    match (read(&["-g", "batt"]), read(&["-g"])) {
        (Some(batt), Some(settings)) => PowerState {
            known: true,
            on_battery: on_battery_from_pmset(&batt),
            low_power: low_power_from_pmset(&settings),
        },
        _ => unknown,
    }
}

/// App-level events. On macOS, clicking the Dock icon while the window is hidden (closed to the
/// tray) shows it again, as Mac apps do.
pub fn on_run_event(app: &AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        show_main(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// Window-event hook: with "minimize to tray" the close button hides the window instead.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<SystemState>();
        if window.label() == MAIN && state.close_to_tray() {
            api.prevent_close();
            let _ = window.hide();
            let _ = window
                .app_handle()
                .emit("command-center://window-visible", false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "command-center-system-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn reads_the_power_source_and_low_power_mode_from_pmset() {
        assert!(on_battery_from_pmset(
            "Now drawing from 'Battery Power'\n -InternalBattery-0\t69%; discharging;"
        ));
        assert!(!on_battery_from_pmset("Now drawing from 'AC Power'\n"));
        assert!(!on_battery_from_pmset(""));
        assert!(low_power_from_pmset(
            "System-wide power settings:\n lowpowermode         1\n"
        ));
        assert!(!low_power_from_pmset(" lowpowermode         0\n"));
        assert!(!low_power_from_pmset(" powermode 1\n"));
    }

    #[test]
    fn power_state_serializes_in_camel_case_for_the_app() {
        let v = serde_json::to_value(PowerState {
            known: true,
            on_battery: true,
            low_power: false,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "known": true, "onBattery": true, "lowPower": false })
        );
        assert!(!on_battery_from_pmset("Now drawing from 'UPS Power'\n"));
        assert!(!low_power_from_pmset(" lowpowermode 10\n"));
    }

    #[test]
    fn defaults_to_quit_and_round_trips() {
        let dir = scratch("roundtrip");
        assert_eq!(load(&dir), CloseBehavior::Quit);
        save(&dir, CloseBehavior::Tray).unwrap();
        assert_eq!(load(&dir), CloseBehavior::Tray);
        save(&dir, CloseBehavior::Quit).unwrap();
        assert_eq!(load(&dir), CloseBehavior::Quit);
    }

    #[test]
    fn a_corrupt_file_falls_back_to_quit() {
        let dir = scratch("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(file(&dir), "{").unwrap();
        assert_eq!(load(&dir), CloseBehavior::Quit);
    }

    #[test]
    fn the_shared_flag_follows_the_setting() {
        let state = SystemState::default();
        assert!(!state.close_to_tray());
        state.set(CloseBehavior::Tray);
        assert!(state.close_to_tray());
        state.set(CloseBehavior::Quit);
        assert!(!state.close_to_tray());
    }
}
