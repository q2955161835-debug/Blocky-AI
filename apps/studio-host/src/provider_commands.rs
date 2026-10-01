use blocky_studio::provider::gateway::GatewayRequest;
use blocky_studio::provider::{ProviderHost, ProviderRequest};
use serde_json::Value;
use tauri::Manager;
#[tauri::command]
pub fn provider_model_preflight(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    request: GatewayRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    host.model_preflight(
        &blocky_studio::profile::for_app(window.app_handle())?,
        &request,
    )
}
#[tauri::command]
pub async fn provider_model_call(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    request: GatewayRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let preview = host.model_preflight(&root, &request)?;
    let digest = preview["requestDigest"]
        .as_str()
        .ok_or("BLK-MODEL-CONFIG")?
        .to_owned();
    let destination = host.model_destination(&root, &request, &digest)?;
    let description = format!(
        "模型：{}\n资源：{}\n地址：{}\n输入：{} bytes\n图片：{}\n工具：{}\n输出上限：{} tokens\n请求摘要：{}",
        preview["modelId"],
        request.resource_id,
        destination,
        preview["inputBytes"],
        preview["imageCount"],
        preview["toolNames"],
        request.max_output_tokens,
        digest
    );
    if !blocky_studio::native_confirmation::yes_no(&window, "批准模型请求", description).await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.model_call(root, request, &digest))
        .await
        .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
#[tauri::command]
pub fn provider_preflight(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    request: ProviderRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    host.preflight(
        &blocky_studio::profile::for_app(window.app_handle())?,
        &request,
    )
}
#[tauri::command]
pub async fn provider_call(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    request: ProviderRequest,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let preview = host.preflight(&root, &request)?;
    let digest = request.digest()?;
    let roles = request
        .messages
        .iter()
        .map(|m| format!("{}: {} bytes", m.role, m.content.len()))
        .collect::<Vec<_>>()
        .join("\n");
    let description = format!(
        "发送至 {}\n地址：{}\n项目：{}\n资源：{}\n模型：{}\n输入：{} bytes\n输出上限：{} tokens\n超时：{} ms\n消息范围：\n{}\n请求摘要：{}",
        if request.provider_name() == "xirang" {
            "息壤"
        } else {
            "DeepSeek"
        },
        request.endpoint(),
        request.project_id,
        request.resource_id,
        request.model_id,
        preview["inputBytes"],
        request.max_output_tokens,
        request.timeout_ms,
        roles,
        digest
    );
    if !blocky_studio::native_confirmation::yes_no(&window, "批准模型请求", description).await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.call(root, request, &digest))
        .await
        .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
#[tauri::command]
pub fn provider_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.cancel(&request_id)
}
