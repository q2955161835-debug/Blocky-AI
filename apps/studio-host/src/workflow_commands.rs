use blocky_studio::workflow::host::WorkflowHost;
use serde_json::Value;
use tauri::Manager;
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("BLK-WORKFLOW-BINDING".into())
    }
}
#[tauri::command]
pub async fn workflow_open(window: tauri::WebviewWindow, request: Value) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::window_lifecycle::visible(&window)?;
        window.state::<WorkflowHost>().open(&request)
    })
    .await
    .map_err(|_| "BLK-WORKFLOW-CHANNEL")?
}
#[tauri::command]
pub async fn workflow_request(
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    main_window(&window)?;
    let settlement = matches!(request["operation"].as_str(), Some("close" | "cancel"))
        || (request["operation"] == "commit"
            && matches!(
                request["action"]["kind"].as_str(),
                Some("complete" | "uncertain" | "pause")
            ));
    if !settlement {
        crate::window_lifecycle::visible(&window)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !settlement {
            crate::window_lifecycle::visible(&window)?;
        }
        window.state::<WorkflowHost>().request(&request)
    })
    .await
    .map_err(|_| "BLK-WORKFLOW-CHANNEL")?
}
#[tauri::command]
pub async fn workflow_query(window: tauri::WebviewWindow, request: Value) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || window.state::<WorkflowHost>().query(&request))
        .await
        .map_err(|_| "BLK-WORKFLOW-CHANNEL")?
}
#[tauri::command]
pub async fn workflow_decide(
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::window_lifecycle::visible(&window)?;
        window.state::<WorkflowHost>().decide(&request)
    })
    .await
    .map_err(|_| "BLK-WORKFLOW-CHANNEL")?
}
