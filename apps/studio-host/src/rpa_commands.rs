use blocky_studio::rpa::{self, RpaHost, protocol::Plan};
use serde_json::Value;
use tauri::Manager;
fn visible(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::window_lifecycle::visible(window)
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-RPA-PERM-001".into());
    }
    Ok(())
}
#[tauri::command]
pub fn rpa_targets(window: tauri::WebviewWindow) -> Result<Vec<rpa::target::Target>, String> {
    visible(&window)?;
    Ok(rpa::target::list())
}
#[tauri::command]
pub async fn rpa_checkpoints(window: tauri::WebviewWindow) -> Result<Vec<Value>, String> {
    visible(&window)?;
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = window
            .app_handle()
            .path()
            .app_local_data_dir()
            .map_err(|_| "BLK-RPA-JOURNAL-001")?;
        rpa::journal::Store::new(root.join("rpa/checkpoints")).summaries()
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_checkpoint(
    window: tauri::WebviewWindow,
    checkpoint_id: String,
    plan: Option<Plan>,
) -> Result<Value, String> {
    visible(&window)?;
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = window
            .app_handle()
            .path()
            .app_local_data_dir()
            .map_err(|_| "BLK-RPA-JOURNAL-001")?;
        rpa::journal::Store::new(root.join("rpa/checkpoints"))
            .inspect_plan(&checkpoint_id, plan.as_ref())
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_authorize(
    window: tauri::WebviewWindow,
    request_id: String,
    plan: Plan,
    browser: Option<rpa::BrowserStart>,
) -> Result<Value, String> {
    visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        visible(&window)?;
        let host=window.state::<RpaHost>();
        let grant = match browser{Some(browser)=>host.authorize_browser(&request_id,plan,browser)?,None=>host.authorize_attended(&request_id, plan)?};
        if let Err(code) = visible(&window) {
            if let Some(token) = grant["sessionId"].as_str() {
                window.state::<RpaHost>().stop(token)?;
            }
            return Err(code);
        }
        Ok(grant)
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_recovery_preview(
    window: tauri::WebviewWindow,
    checkpoint_id: String,
) -> Result<Value, String> {
    visible(&window)?;
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = window
            .app_handle()
            .path()
            .app_local_data_dir()
            .map_err(|_| "BLK-RPA-JOURNAL-001")?;
        rpa::journal::Store::new(root.join("rpa/checkpoints")).recovery_preview(&checkpoint_id)
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_recover(
    window: tauri::WebviewWindow,
    request_id: String,
    plan: Plan,
    recovery: rpa::recovery::Request,
) -> Result<Value, String> {
    visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        visible(&window)?;
        let grant = window
            .state::<RpaHost>()
            .recover_attended(&request_id, plan, recovery)?;
        if let Err(code) = visible(&window) {
            if let Some(token) = grant["sessionId"].as_str() {
                window.state::<RpaHost>().stop(token)?;
            }
            return Err(code);
        }
        Ok(grant)
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_cancel_authorization(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        window.state::<RpaHost>().cancel_authorization(&request_id)
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_step(
    window: tauri::WebviewWindow,
    token: String,
    step_id: String,
    manual_input: Option<String>,
) -> Result<Value, String> {
    visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        visible(&window)?;
        let host = window.state::<RpaHost>();
        let reference = host.input_reference(&token, &step_id)?;
        match reference {
            Some(input) if input.kind == "secret-ref" => Err("BLK-RPA-SENSITIVE-001".into()),
            _ => host.step(&token, &step_id, manual_input),
        }
    })
    .await
    .map_err(|_| "BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub fn rpa_status(window: tauri::WebviewWindow, token: String) -> Result<Value, String> {
    main_window(&window)?;
    window.state::<RpaHost>().status(&token)
}
#[tauri::command]
pub fn rpa_pause(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    main_window(&window)?;
    window.state::<RpaHost>().pause(&token)
}
#[tauri::command]
pub fn rpa_resume(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    visible(&window)?;
    window.state::<RpaHost>().resume(&token)
}
#[tauri::command]
pub async fn rpa_stop(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || window.state::<RpaHost>().stop(&token))
        .await
        .map_err(|_| "BLK-RPA-WORKER-001")?
}
