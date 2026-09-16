use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;
static LAST_SAVE: AtomicU64 = AtomicU64::new(0);
pub fn save(window: &tauri::Window, force: bool) {
    if window.label() != "main" || window.is_minimized().unwrap_or(true) {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis() as u64)
        .unwrap_or(0);
    if !force && now.saturating_sub(LAST_SAVE.load(Ordering::Relaxed)) < 500 {
        return;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    if size.width < 640 || size.height < 480 {
        return;
    }
    let value = json!({"schemaVersion":"blocky.window/v1", "x":position.x,"y":position.y,"width":size.width,"height":size.height,"maximized":window.is_maximized().unwrap_or(false)});
    if window
        .state::<blocky_studio::user_store::UserStore>()
        .write("window", "main", value)
        .is_ok()
    {
        LAST_SAVE.store(now, Ordering::Relaxed);
    }
}
pub fn restore(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let store = app.state::<blocky_studio::user_store::UserStore>();
    let Ok(Some(value)) = store.read("window", "main") else {
        return;
    };
    if value["schemaVersion"] != "blocky.window/v1" {
        return;
    }
    let Some(x) = value["x"].as_i64().and_then(|v| i32::try_from(v).ok()) else {
        return;
    };
    let Some(y) = value["y"].as_i64().and_then(|v| i32::try_from(v).ok()) else {
        return;
    };
    let Some(width) = value["width"].as_u64().and_then(|v| u32::try_from(v).ok()) else {
        return;
    };
    let Some(height) = value["height"].as_u64().and_then(|v| u32::try_from(v).ok()) else {
        return;
    };
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let target = monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            (x as i64) >= p.x as i64
                && (y as i64) >= p.y as i64
                && (x as i64) < p.x as i64 + s.width as i64
                && (y as i64) < p.y as i64 + s.height as i64
        })
        .or(monitors.first());
    if let Some(monitor) = target {
        let p = monitor.position();
        let s = monitor.size();
        let w = width.max(640).min(s.width.saturating_sub(32).max(1));
        let h = height.max(480).min(s.height.saturating_sub(80).max(1));
        let max_x =
            (p.x as i64 + s.width.saturating_sub(w + 16) as i64).min(i32::MAX as i64) as i32;
        let max_y =
            (p.y as i64 + s.height.saturating_sub(h + 64) as i64).min(i32::MAX as i64) as i32;
        let _ = window.set_size(tauri::PhysicalSize::new(w, h));
        let _ = window.set_position(tauri::PhysicalPosition::new(
            x.clamp(p.x, max_x),
            y.clamp(p.y, max_y),
        ));
        if value["maximized"] == true {
            let _ = window.maximize();
        }
    }
}
