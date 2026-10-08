use blocky_studio::tool_gateway::{ToolHost, ToolRequest};
use serde_json::Value;
use tauri::Manager;
#[tauri::command]
pub fn tool_cleanup_status(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    host.cleanup_status(&blocky_studio::profile::for_app(window.app_handle())?)
}
#[tauri::command]
pub async fn tool_cleanup(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let status = host.cleanup_status(&root)?;
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "清理工具临时资料",
        format!(
            "清理已中断且归属明确的 {} 个隔离会话，已识别占用 {} 字节。",
            status["incompleteSessions"], status["incompleteBytes"]
        ),
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.cleanup(&root))
        .await
        .map_err(|_| "BLK-TOOL-STATE".to_owned())?
}
#[tauri::command]
pub async fn tool_preflight(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
    request: ToolRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.preflight(&root, &request))
        .await
        .map_err(|_| "BLK-TOOL-STATE".to_owned())?
}
#[tauri::command]
pub async fn tool_call(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
    request: ToolRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let operation = host.begin(&request)?;
    let preview_root = root.clone();
    let (operation, preview, destination) = tauri::async_runtime::spawn_blocking(move || {
        let preview = operation.preflight(&preview_root)?;
        let destination = operation.destination(
            &preview_root,
            preview["requestDigest"].as_str().ok_or("BLK-TOOL-CONFIG")?,
        )?;
        Ok::<_, String>((operation, preview, destination))
    })
    .await
    .map_err(|_| "BLK-TOOL-STATE".to_owned())??;
    let digest = preview["requestDigest"]
        .as_str()
        .ok_or("BLK-TOOL-CONFIG")?
        .to_owned();
    let action = match request.action.as_str() {
        "discover" => "发现可用工具和资料",
        "read-resource" => "读取所选资料",
        _ => "执行工具",
    };
    let message=format!("操作：{action}\n资源：{}\n目标：{destination}\n输入：{} bytes\n时限：{} ms\n未核实调用：{}\n请求摘要：{digest}",request.resource_id,preview["inputBytes"],request.timeout_ms,preview["unresolvedCalls"]);
    operation.check_cancel()?;
    if !blocky_studio::native_confirmation::runtime_request(&window, "批准工具请求", message).await? {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    operation.check_cancel()?;
    tauri::async_runtime::spawn_blocking(move || operation.call(&root, &digest))
        .await
        .map_err(|_| "BLK-TOOL-STATE".to_owned())?
}
#[tauri::command]
pub fn tool_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.cancel(&request_id)
}
#[tauri::command]
pub fn tool_status(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
    project_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    host.status(
        &blocky_studio::profile::for_app(window.app_handle())?,
        &project_id,
    )
}
#[tauri::command]
pub async fn tool_reconcile(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ToolHost>,
    project_id: String,
    request_id: String,
    outcome: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let preview = host.reconcile_preview(&root, &project_id, &request_id, &outcome)?;
    let digest = preview["requestDigest"].as_str().ok_or("BLK-TOOL-CONFIG")?;
    let conclusion = if outcome == "confirmed-completed" {
        "已生效"
    } else {
        "未生效"
    };
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "核实工具结果",
        format!(
            "请先检查实际目标。\n请求：{request_id}\n你将记录：{conclusion}\n这不会重发原调用。"
        ),
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    host.reconcile(&root, &project_id, &request_id, &outcome, digest)
}
