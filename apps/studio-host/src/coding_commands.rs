use blocky_studio::coding::{CodingHost, CodingStart};
use serde_json::Value;
use tauri::{Manager, ipc::Channel};
#[tauri::command]
pub async fn coding_workspace_pick(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
) -> Result<Option<Value>, String> {
    crate::window_lifecycle::visible(&window)?;
    let parent = window.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_parent(&parent)
            .set_title("选择代码助手工作目录")
            .pick_folder()
    })
    .await
    .map_err(|_| "BLK-CODING-STATE")?;
    crate::window_lifecycle::visible(&window)?;
    path.map(|p| host.grant(&p)).transpose()
}
#[tauri::command]
pub async fn coding_run(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
    start: CodingStart,
    on_event: Channel<Value>,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let preview = host.preflight(&root, &start)?;
    let digest = preview["requestDigest"]
        .as_str()
        .ok_or("BLK-CODING-INPUT")?
        .to_owned();
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "批准代码助手任务",
        blocky_studio::coding::approval_description(&preview),
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.run(root, start, &digest, &mut |event| {
            on_event
                .send(event)
                .map_err(|_| "BLK-CODING-CHANNEL".into())
        })
    })
    .await
    .map_err(|_| "BLK-CODING-STATE".to_owned())?
}
#[tauri::command]
pub fn coding_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.cancel(&request_id)
}
#[tauri::command]
pub fn coding_undo(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
    workspace_id: String,
    change_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    host.undo(&workspace_id, &change_id)
}
#[tauri::command]
pub fn coding_validate_project(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
    request_id: String,
    original_json: String,
    project: Value,
    approved: Vec<String>,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    host.validate_project(&root, &request_id, &original_json, &project, &approved)
}

#[tauri::command]
pub fn coding_changes(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, CodingHost>,
    request_id: String,
) -> Result<Vec<Value>, String> {
    crate::window_lifecycle::visible(&window)?;
    host.changes(&request_id)
}
