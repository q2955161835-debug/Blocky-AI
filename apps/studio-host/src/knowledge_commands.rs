use blocky_studio::knowledge::KnowledgeStore;
use serde_json::{Value, json};
fn guard(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    crate::window_lifecycle::visible(window)
}
async fn run(store: KnowledgeStore, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        blocky_studio::knowledge::dispatch(&store, &request)
    })
    .await
    .map_err(|_| "BLK-KNOW-IO".to_string())?
}
#[tauri::command]
pub async fn knowledge_source_add(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
    kind: String,
    url: Option<String>,
    r#ref: Option<String>,
) -> Result<Option<Value>, String> {
    guard(&window)?;
    let location = if kind == "url" {
        url.ok_or("BLK-KNOW-INVALID")?
    } else {
        if url.is_some() {
            return Err("BLK-KNOW-INVALID".into());
        }
        let dialog = rfd::AsyncFileDialog::new().set_title("选择知识来源");
        let picked = match kind.as_str() {
            "file" => dialog.pick_file().await,
            "directory" | "repository" => dialog.pick_folder().await,
            _ => return Err("BLK-KNOW-INVALID".into()),
        };
        let Some(picked) = picked else {
            return Ok(None);
        };
        picked.path().to_string_lossy().into_owned()
    };
    guard(&window)?;
    let mut request = json!({"operation":"knowledge-source-add","projectId":project_id,"collectionId":collection_id,"kind":kind});
    request[if kind == "url" { "url" } else { "path" }] = location.into();
    if let Some(reference) = r#ref {
        request["ref"] = reference.into();
    }
    run(store.inner().clone(), request).await.map(Some)
}
#[tauri::command]
pub async fn knowledge_sources(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"knowledge-sources","projectId":project_id,"collectionId":collection_id})).await
}
#[tauri::command]
pub async fn knowledge_read_source(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
    source_id: String,
    cursor: Option<usize>,
    snapshot_revision: Option<String>,
) -> Result<Value, String> {
    guard(&window)?;
    let mut request = json!({"operation":"knowledge-read-source","projectId":project_id,"collectionId":collection_id,"sourceId":source_id});
    if let Some(cursor) = cursor {
        request["cursor"] = cursor.into();
    }
    if let Some(revision) = snapshot_revision {
        request["snapshotRevision"] = revision.into();
    }
    run(store.inner().clone(), request).await
}
#[tauri::command]
pub async fn knowledge_source_remove(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
    source_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"knowledge-source-remove","projectId":project_id,"collectionId":collection_id,"sourceId":source_id})).await
}
#[tauri::command]
pub async fn knowledge_source_acl(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
    source_id: String,
    allowed_principals: Vec<String>,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"knowledge-source-acl","projectId":project_id,"collectionId":collection_id,"sourceId":source_id,"allowedPrincipals":allowed_principals})).await
}
#[tauri::command]
pub async fn knowledge_load_index(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"knowledge-load-index","projectId":project_id,"collectionId":collection_id})).await
}
#[tauri::command]
pub async fn knowledge_save_index(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
    expected_revision: u64,
    expected_generation: u64,
    value: Value,
) -> Result<Value, String> {
    guard(&window)?;
    run(store.inner().clone(),json!({"operation":"knowledge-save-index","projectId":project_id,"collectionId":collection_id,"expectedRevision":expected_revision,"expectedGeneration":expected_generation,"value":value})).await
}
#[tauri::command]
pub fn knowledge_cancel(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, KnowledgeStore>,
    project_id: String,
    collection_id: String,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    store.cancel(&project_id, &collection_id)?;
    Ok(json!({"cancelled":true}))
}
