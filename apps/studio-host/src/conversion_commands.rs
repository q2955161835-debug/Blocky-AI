use blocky_studio::conversion::ConversionStore;
use serde_json::{Value, json};
fn guard(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(window)
}
async fn run(store: ConversionStore, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        blocky_studio::conversion::dispatch(&store, &request)
    })
    .await
    .map_err(|_| "BLK-CONVERT-IO".to_string())?
}
#[tauri::command]
pub async fn conversion_scan(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, ConversionStore>,
    project_id: String,
    r#ref: Option<String>,
    subdir: Option<String>,
) -> Result<Option<Value>, String> {
    guard(&window)?;
    let picked = rfd::AsyncFileDialog::new().set_parent(&window)
        .set_title("选择要转换的仓库")
        .pick_folder()
        .await;
    let Some(picked) = picked else {
        return Ok(None);
    };
    guard(&window)?;
    let mut request = json!({"operation":"conversion-scan","projectId":project_id,"path":picked.path().to_string_lossy()});
    if let Some(value) = r#ref {
        request["ref"] = value.into();
    }
    if let Some(value) = subdir {
        request["subdir"] = value.into();
    }
    run(store.inner().clone(), request).await.map(Some)
}
#[tauri::command]
pub async fn conversion_read(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, ConversionStore>,
    project_id: String,
    artifact_id: String,
    cursor: Option<usize>,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"conversion-read","projectId":project_id,"artifactId":artifact_id,"cursor":cursor.unwrap_or(0)})).await
}
#[tauri::command]
pub async fn conversion_cache_load(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, ConversionStore>,
    project_id: String,
    snapshot_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"conversion-cache-load","projectId":project_id,"snapshotId":snapshot_id})).await
}
#[tauri::command]
pub async fn conversion_cache_save(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, ConversionStore>,
    project_id: String,
    snapshot_id: String,
    value: Value,
    analysis_cache: Option<Value>,
) -> Result<Value, String> {
    guard(&window)?;
    let mut request = json!({"operation":"conversion-cache-save","projectId":project_id,"snapshotId":snapshot_id,"value":value});
    if let Some(value) = analysis_cache {
        request["analysisCache"] = value;
    }
    run(store.inner().clone(), request).await
}
#[tauri::command]
pub fn conversion_cancel(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, ConversionStore>,
    project_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    blocky_studio::conversion::dispatch(
        store.inner(),
        &json!({"operation":"conversion-cancel","projectId":project_id}),
    )
}
