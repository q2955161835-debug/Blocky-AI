use blocky_studio::workflow::desktop::RuntimeHost;
use serde_json::Value;
use tauri::Manager;
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("BLK-RUN-SERVICE".into())
    }
}
#[tauri::command]
pub fn runtime_session_open(window: tauri::WebviewWindow) -> Result<String, String> {
    crate::window_lifecycle::visible(&window)?;
    window.state::<RuntimeHost>().open()
}
#[tauri::command]
pub async fn runtime_run(
    window: tauri::WebviewWindow,
    session_id: String,
    run_id: String,
    request: Value,
    channel: tauri::ipc::Channel<Value>,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::window_lifecycle::visible(&window)?;
        window
            .state::<RuntimeHost>()
            .run(&session_id, &run_id, request, |frame| {
                channel.send(frame).map_err(|_| "BLK-RUN-SERVICE".into())
            })
    })
    .await
    .map_err(|_| "BLK-RUN-SERVICE")?
}
#[tauri::command]
pub fn runtime_request(
    window: tauri::WebviewWindow,
    session_id: String,
    run_id: String,
    message: Value,
) -> Result<(), String> {
    main_window(&window)?;
    if message["kind"] == "control" {
        crate::window_lifecycle::visible(&window)?;
    }
    window
        .state::<RuntimeHost>()
        .request(&session_id, &run_id, message)
}
#[tauri::command]
pub fn runtime_session_close(
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    main_window(&window)?;
    window.state::<RuntimeHost>().close(&session_id)
}
