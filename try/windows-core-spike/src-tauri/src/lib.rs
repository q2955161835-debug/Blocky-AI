pub mod deepseek;
pub mod document_store;
pub mod project_store;

use deepseek::DeepSeekRequestRegistry;
#[cfg(not(feature = "wdio"))]
use deepseek::{cancel_deepseek_completion, deepseek_chat_completion};
use document_store::{DocumentError, DocumentRecord, DocumentStore, SaveDocumentRequest};
use project_store::{HostError, ProjectRecord, ProjectStore, SaveProjectRequest};
use std::sync::Arc;
use tauri::Manager;

#[cfg(not(feature = "wdio"))]
fn load_local_deepseek_env() {
    let spike_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent();
    if let Some(path) = spike_root.map(|root| root.join(".env"))
        && path.is_file()
    {
        let _ = dotenvy::from_path(path);
    }
}

fn store_for(app: &tauri::AppHandle) -> Result<ProjectStore, HostError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| HostError::io("PROJECT_APP_DATA_DIR_FAILED", error))?;
    Ok(ProjectStore::new(
        app_data_dir.join("BlockySpike").join("projects"),
    ))
}

#[tauri::command]
fn save_project(
    app: tauri::AppHandle,
    request: SaveProjectRequest,
) -> Result<ProjectRecord, HostError> {
    store_for(&app)?.save(request)
}

#[tauri::command]
fn load_project(app: tauri::AppHandle, project_id: String) -> Result<ProjectRecord, HostError> {
    store_for(&app)?.load(&project_id)
}

fn document_task_failed() -> DocumentError {
    DocumentError {
        code: "DOCUMENT_TASK_FAILED",
        message: "项目文件操作失败，请重试",
    }
}

#[tauri::command]
async fn open_project_document(
    store: tauri::State<'_, Arc<DocumentStore>>,
) -> Result<Option<DocumentRecord>, DocumentError> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.open_with_dialog())
        .await
        .map_err(|_| document_task_failed())?
}

#[tauri::command]
async fn save_project_document(
    store: tauri::State<'_, Arc<DocumentStore>>,
    request: SaveDocumentRequest,
) -> Result<Option<DocumentRecord>, DocumentError> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.save_with_dialog(request))
        .await
        .map_err(|_| document_task_failed())?
}

#[tauri::command]
fn clear_project_document_association(
    store: tauri::State<'_, Arc<DocumentStore>>,
) -> Result<(), DocumentError> {
    store.clear_association()
}

#[cfg(feature = "wdio")]
#[tauri::command]
fn wdio_prepare_document_dialog(
    store: tauri::State<'_, Arc<DocumentStore>>,
    fixture: String,
) -> Result<(), DocumentError> {
    store.prepare_wdio_dialog_fixture(&fixture)
}

#[cfg(feature = "wdio")]
#[tauri::command]
fn wdio_request_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .close()
        .map_err(|_| "WDIO_NATIVE_CLOSE_FAILED".to_owned())
}

#[cfg(feature = "wdio")]
#[tauri::command]
async fn wdio_create_close_sentinel(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("wdio-close-sentinel").is_some() {
        return Ok(());
    }
    let sentinel_url = "about:blank"
        .parse()
        .map_err(|_| "WDIO_CLOSE_SENTINEL_URL_FAILED".to_owned())?;
    tauri::WebviewWindowBuilder::new(
        &app,
        "wdio-close-sentinel",
        tauri::WebviewUrl::External(sentinel_url),
    )
    .visible(false)
    .focusable(false)
    .build()
    .map(|_| ())
    .map_err(|_| "WDIO_CLOSE_SENTINEL_FAILED".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(feature = "wdio"))]
    load_local_deepseek_env();

    let builder = tauri::Builder::default();

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let builder = builder
        .manage(Arc::new(DocumentStore::new()))
        .manage(DeepSeekRequestRegistry::default());

    #[cfg(not(feature = "wdio"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        save_project,
        load_project,
        open_project_document,
        save_project_document,
        clear_project_document_association,
        deepseek_chat_completion,
        cancel_deepseek_completion
    ]);

    #[cfg(feature = "wdio")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        save_project,
        load_project,
        open_project_document,
        save_project_document,
        clear_project_document_association,
        wdio_prepare_document_dialog,
        wdio_request_window_close,
        wdio_create_close_sentinel
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Blocky Windows Core spike");
}
