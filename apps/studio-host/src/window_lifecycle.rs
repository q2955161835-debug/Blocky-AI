use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Lifecycle {
    pub closing: AtomicBool,
    pub authorized: AtomicBool,
    committing: AtomicBool,
    close_to_tray: AtomicBool,
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
    app.state::<Lifecycle>()
        .close_to_tray
        .store(true, Ordering::SeqCst);
    crate::shared_tray::start(app)
}
pub(crate) fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    if app.tray_by_id("blocky-tray").is_some() {
        return Ok(());
    }
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
            "restore" => crate::studio_windows::restore_all(app),
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
                crate::studio_windows::restore_all(tray.app_handle());
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
            if state.close_to_tray.load(Ordering::SeqCst)
                && !state.closing.load(Ordering::SeqCst)
                && window.hide().is_ok()
            {
                return;
            }
            let _ = window.emit("blocky:window", "close");
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
        // Preserve the legacy IPC/config key; this preference now applies to close.
        .close_to_tray
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
    if window.label() != "main"
        || window
            .state::<Lifecycle>()
            .committing
            .load(Ordering::SeqCst)
    {
        return Err("BLK-WINDOW-001".into());
    }
    window
        .state::<Lifecycle>()
        .closing
        .store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub fn cancel_exit(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || window
            .state::<Lifecycle>()
            .committing
            .load(Ordering::SeqCst)
    {
        return Err("BLK-WINDOW-001".into());
    }
    window
        .state::<Lifecycle>()
        .closing
        .store(false, Ordering::SeqCst);
    Ok(())
}
#[tauri::command(async)]
pub fn prepare_exit(
    window: tauri::WebviewWindow,
    logs: tauri::State<'_, blocky_studio::log_store::LogStore>,
) -> Result<(), String> {
    let state = window.state::<Lifecycle>();
    if window.label() != "main"
        || !state.closing.load(Ordering::SeqCst)
        || state.committing.load(Ordering::SeqCst)
    {
        return Err("BLK-WINDOW-001".into());
    }
    // Persist before closing any host: disk errors must leave the workbench recoverable.
    logs.flush()
}
#[tauri::command(async)]
pub fn finish_exit(
    window: tauri::WebviewWindow,
    tasks: tauri::State<'_, blocky_studio::task_host::TaskHost>,
    terminals: tauri::State<'_, blocky_studio::user_terminal::UserTerminals>,
) -> Result<(), String> {
    if window.label() != "main" || !window.state::<Lifecycle>().closing.load(Ordering::SeqCst) {
        return Err("BLK-WINDOW-001".into());
    }
    window
        .state::<Lifecycle>()
        .committing
        .store(true, Ordering::SeqCst);
    // Do not short-circuit: every owner must receive cancellation even if an earlier
    // one has not settled yet. A retry repeats only these idempotent shutdowns.
    let results = [
        window
            .state::<blocky_studio::workflow::desktop::RuntimeHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-RUNTIME"),
        window
            .state::<blocky_studio::coding::CodingHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-CODING"),
        tasks.shutdown().map_err(|_| "BLK-EXIT-TASK"),
        window
            .state::<blocky_studio::workflow::host::WorkflowHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-WORKFLOW"),
        window
            .state::<blocky_studio::rpa::RpaHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-AUTOMATION"),
        window
            .state::<blocky_studio::builder::BuilderHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-BUILDER"),
        window
            .state::<blocky_studio::tool_gateway::ToolHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-TOOLS"),
        window
            .state::<blocky_studio::agent_data::AgentData>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-DATA"),
        window
            .state::<blocky_studio::provider::ProviderHost>()
            .shutdown()
            .map_err(|_| "BLK-EXIT-PROVIDER"),
        terminals.settle().map_err(|_| "BLK-EXIT-TERMINAL"),
    ];
    if let Some(error) = results.into_iter().find_map(Result::err) {
        return Err(error.into());
    }
    window
        .state::<Lifecycle>()
        .authorized
        .store(true, Ordering::SeqCst);
    window.app_handle().exit(0);
    Ok(())
}
