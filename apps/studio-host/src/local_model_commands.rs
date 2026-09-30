use blocky_studio::{local_models, provider::ProviderHost};
use serde_json::Value;
use tauri::Manager;
#[tauri::command]
pub async fn provider_local_model_cleanup(
    window: tauri::WebviewWindow,
    model_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    if model_id != local_models::MODEL_ID {
        return Err("BLK-LOCAL-MODEL-INVALID".into());
    }
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "清理未完成安装",
        "删除 Blocky 托管模型未完成安装的临时文件。未知文件会保留。",
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || local_models::cleanup(&root, &model_id))
        .await
        .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
#[tauri::command]
pub fn provider_local_model_catalog(window: tauri::WebviewWindow) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    local_models::catalog()
}
#[tauri::command]
pub fn provider_local_model_status(
    window: tauri::WebviewWindow,
    model_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    local_models::status(
        &blocky_studio::profile::for_app(window.app_handle())?,
        &model_id,
    )
}
#[tauri::command]
pub async fn provider_local_model_install(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    model_id: String,
    backend: String,
    request_id: String,
    import_files: bool,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let catalog = local_models::catalog()?;
    let model = catalog["models"]
        .as_array()
        .and_then(|a| a.iter().find(|m| m["modelId"] == model_id))
        .ok_or("BLK-LOCAL-MODEL-INVALID")?;
    let runtime = model["backends"]
        .as_array()
        .and_then(|a| a.iter().find(|b| b["id"] == backend))
        .ok_or("BLK-LOCAL-MODEL-INVALID")?;
    let description = format!(
        "安装 {}（{}）。\n下载大小：{} 字节。\n来源：Qwen 官方模型仓库和 llama.cpp 官方发行。安装前校验固定 SHA256。\n推理在本机运行，每次请求结束后释放进程。",
        model["displayName"], backend, runtime["downloadBytes"]
    );
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        if import_files {
            "导入本地模型"
        } else {
            "下载本地模型"
        },
        description,
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    let source = if import_files {
        let model = rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("选择 Qwen3-0.6B-Q8_0.gguf")
            .add_filter("GGUF", &["gguf"])
            .pick_file()
            .await
            .ok_or("BLK-LOCAL-MODEL-CANCELLED")?;
        crate::window_lifecycle::visible(&window)?;
        let runtime = rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("选择对应后端的 llama.cpp 发行 ZIP")
            .add_filter("ZIP", &["zip"])
            .pick_file()
            .await
            .ok_or("BLK-LOCAL-MODEL-CANCELLED")?;
        Some(local_models::InstallSource {
            model_file: model.path().into(),
            runtime_file: runtime.path().into(),
        })
    } else {
        None
    };
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.local_model_install(&root, &model_id, &backend, &request_id, source.as_ref())
    })
    .await
    .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
#[tauri::command]
pub async fn provider_local_model_verify(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, ProviderHost>,
    model_id: String,
    request_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.local_model_verify_request(&root, &model_id, &request_id)
    })
    .await
    .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
#[tauri::command]
pub async fn provider_local_model_remove(
    window: tauri::WebviewWindow,
    model_id: String,
) -> Result<Value, String> {
    crate::window_lifecycle::visible(&window)?;
    let root = blocky_studio::profile::for_app(window.app_handle())?;
    if model_id != local_models::MODEL_ID {
        return Err("BLK-LOCAL-MODEL-INVALID".into());
    }
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "卸载本地模型",
        format!("删除 Blocky 托管的模型 {} 及其推理运行库。", model_id),
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(&window)?;
    tauri::async_runtime::spawn_blocking(move || local_models::remove(&root, &model_id))
        .await
        .map_err(|_| "BLK-PROVIDER-STATE".to_string())?
}
