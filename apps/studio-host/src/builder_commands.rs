use blocky_studio::builder::{BuilderHost, BuilderStart};
use serde_json::Value;
use tauri::Manager;
#[tauri::command]
pub fn builder_evidence(window: tauri::WebviewWindow, request_id: String) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| "BLK-BUILDER-STATE")?;
    blocky_studio::builder::dispatch(
        root,
        &serde_json::json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"builder-evidence","requestId":request_id}),
    )
}
#[tauri::command]
pub async fn builder_run(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, BuilderHost>,
    start: BuilderStart,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| "BLK-BUILDER-STATE")?;
    let preview = host.preflight(&root, &start)?;
    let digest = start.digest()?;
    if start.mode == "live" {
        let description = format!(
            "构建助手将向 DeepSeek 发送目标模块积木、目录、选择与诊断。\n项目：{}\n模型：{}\n最多 {} 次请求，每次输出上限 1024 tokens；不自动重试。\n创建应用界面：{}\n候选仍需你审查接受才会修改项目。\n请求摘要：{}",
            preview["projectName"],
            preview["modelId"],
            start.max_turns,
            start.request.create_surface,
            digest
        );
        if rfd::AsyncMessageDialog::new()
            .set_title("批准构建模型请求")
            .set_description(description)
            .set_buttons(rfd::MessageButtons::YesNo)
            .show()
            .await
            != rfd::MessageDialogResult::Yes
        {
            return Err("BLK-PERM-001".into());
        }
    }
    crate::window_lifecycle::visible(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.run(root, start, &digest))
        .await
        .map_err(|_| "BLK-BUILDER-STATE".to_string())?
}
#[tauri::command]
pub fn builder_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, BuilderHost>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.cancel(&request_id)
}
