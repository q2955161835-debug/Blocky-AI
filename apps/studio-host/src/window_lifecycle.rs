use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Lifecycle {
    pub closing: AtomicBool,
    pub authorized: AtomicBool,
    minimize_to_tray: AtomicBool,
}
pub fn visible(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || window.state::<Lifecycle>().closing.load(Ordering::SeqCst)
        || !window.is_visible().map_err(|_| "BLK-WINDOW-001")?
        || window.is_minimized().map_err(|_| "BLK-WINDOW-001")?
    {
        return Err("BLK-WINDOW-001".into());
    }
    Ok(())
}
pub fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
pub fn notify(app: &tauri::AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("blocky:window", action);
    }
}
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    app.state::<Lifecycle>()
        .minimize_to_tray
        .store(true, Ordering::SeqCst);
    let restore_item = MenuItem::with_id(app, "restore", "打开 Blocky Studio", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停 / 继续问答运行", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "运行日志", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&restore_item, &pause, &logs, &exit])?;
    TrayIconBuilder::with_id("blocky-tray")
        .icon(
            app.default_window_icon()
                .ok_or("missing tray icon")?
                .clone(),
        )
        .tooltip("Blocky Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "restore" => restore(app),
            "pause" => notify(app, "pause"),
            "logs" => {
                restore(app);
                notify(app, "logs");
            }
            "exit" => {
                restore(app);
                notify(app, "close");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let state = window.state::<Lifecycle>();
    if matches!(
        event,
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
    ) {
        crate::window_state::save(window, false);
    }
    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
        crate::window_state::save(window, true);
    }
    match event {
        tauri::WindowEvent::CloseRequested { api, .. }
            if !state.authorized.load(Ordering::SeqCst) =>
        {
            api.prevent_close();
            let _ = window.emit("blocky:window", "close");
        }
        tauri::WindowEvent::Resized(_)
            if state.minimize_to_tray.load(Ordering::SeqCst)
                && window.is_minimized().unwrap_or(false) =>
        {
            let _ = window.hide();
        }
        _ => {}
    }
}
#[tauri::command]
pub fn authorize_run(window: tauri::WebviewWindow) -> Result<(), String> {
    visible(&window)
}
#[tauri::command]
pub fn set_window_preferences(
    window: tauri::WebviewWindow,
    minimize_to_tray: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-WINDOW-001".into());
    }
    window
        .state::<Lifecycle>()
        .minimize_to_tray
        .store(minimize_to_tray, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    visible(&window)?;
    window.hide().map_err(|_| "BLK-WINDOW-001".into())
}
#[tauri::command]
pub fn begin_exit(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-WINDOW-001".into());
    }
    window
        .state::<Lifecycle>()
        .closing
        .store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub fn finish_exit(
    window: tauri::WebviewWindow,
    tasks: tauri::State<'_, blocky_studio::task_host::TaskHost>,
    logs: tauri::State<'_, blocky_studio::log_store::LogStore>,
    terminals: tauri::State<'_, blocky_studio::user_terminal::UserTerminals>,
) -> Result<(), String> {
    if window.label() != "main" || !window.state::<Lifecycle>().closing.load(Ordering::SeqCst) {
        return Err("BLK-WINDOW-001".into());
    }
    tasks.shutdown()?;
    window.state::<blocky_studio::rpa::RpaHost>().shutdown()?;
    window.state::<blocky_studio::builder::BuilderHost>().shutdown()?;
    window
        .state::<blocky_studio::agent_data::AgentData>()
        .shutdown()?;
    window
        .state::<blocky_studio::provider::ProviderHost>()
        .shutdown()?;
    terminals.settle()?;
    logs.flush()?;
    window
        .state::<Lifecycle>()
        .authorized
        .store(true, Ordering::SeqCst);
    window.app_handle().exit(0);
    Ok(())
}
