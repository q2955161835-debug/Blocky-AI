use crate::project_store::{self, ProjectFiles};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
#[derive(Default)]
pub struct Handles(pub Mutex<HashMap<String, PathBuf>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    handle: String,
    display_name: String,
    files: ProjectFiles,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    handle: String,
    display_name: String,
}
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("BLK-PERM-001".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub fn authorize_surface(
    window: tauri::WebviewWindow,
    files: ProjectFiles,
    surface_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    crate::window_lifecycle::visible(&window)?;
    if !window.is_visible().map_err(|_| "BLK-WINDOW-001")?
        || window.is_minimized().map_err(|_| "BLK-WINDOW-001")?
    {
        return Err("BLK-WINDOW-001".into());
    }
    project_store::validate_files(&files)?;
    let manifest = blocky_studio::strict_json::parse(
        files
            .get("project.json")
            .ok_or("BLK-SURFACE-002")?
            .as_bytes(),
    )?;
    if !manifest["appSurfaces"]
        .as_array()
        .ok_or("BLK-SURFACE-002")?
        .iter()
        .any(|s| s["surfaceId"] == surface_id)
    {
        return Err("BLK-SURFACE-002".into());
    }
    Ok(())
}
#[tauri::command]
pub fn validate_patch(
    window: tauri::WebviewWindow,
    user_store: tauri::State<'_, blocky_studio::user_store::UserStore>,
    original_json: String,
    patch: serde_json::Value,
    approved: Vec<String>,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let registry = user_store
        .read("resources", "app")?
        .unwrap_or(serde_json::Value::Null);
    blocky_studio::patch_guard::validate_with_registry(&original_json, &patch, &approved, &registry)
}
#[tauri::command]
pub async fn open_project(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Handles>,
) -> Result<Option<Opened>, String> {
    main_only(&window)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("打开 Blocky 项目")
        .add_filter("Blocky 项目", &["blocky"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_owned();
    let files = project_store::read_archive(&path)?;
    let handle = format!("project-{}", uuid::Uuid::new_v4());
    let display_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut handles = state.0.lock().map_err(|_| "BLK-HOST-001")?;
    if handles.len() >= 32 {
        handles.clear();
    }
    handles.insert(handle.clone(), path);
    Ok(Some(Opened {
        handle,
        display_name,
        files,
    }))
}
#[tauri::command]
pub async fn open_migration(window: tauri::WebviewWindow) -> Result<Option<ProjectFiles>, String> {
    main_only(&window)?;
    crate::window_lifecycle::visible(&window)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择要迁移的旧项目")
        .add_filter("Blocky 项目", &["blocky"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    project_store::read_migration_archive(file.path()).map(Some)
}
#[tauri::command]
pub async fn save_migration(
    window: tauri::WebviewWindow,
    files: ProjectFiles,
) -> Result<Option<Saved>, String> {
    main_only(&window)?;
    project_store::validate_files(&files)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("迁移为新项目（不覆盖原件）")
        .set_file_name("迁移后的项目.blocky")
        .add_filter("Blocky 项目", &["blocky"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    project_store::create_archive(file.path(), &files)?;
    Ok(Some(Saved {
        handle: String::new(),
        display_name: file
            .path()
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
    }))
}
#[tauri::command]
pub async fn save_project(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Handles>,
    files: ProjectFiles,
    handle: Option<String>,
) -> Result<Option<Saved>, String> {
    main_only(&window)?;
    project_store::validate_files(&files)?;
    let (path, handle) = if let Some(id) = handle {
        let path = state
            .0
            .lock()
            .map_err(|_| "BLK-HOST-001")?
            .get(&id)
            .cloned()
            .ok_or("BLK-PERM-001")?;
        (path, id)
    } else {
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_title("保存 Blocky 项目")
            .set_file_name("我的项目.blocky")
            .add_filter("Blocky 项目", &["blocky"])
            .save_file()
            .await
        else {
            return Ok(None);
        };
        (
            file.path().to_owned(),
            format!("project-{}", uuid::Uuid::new_v4()),
        )
    };
    project_store::save_archive(&path, &files)?;
    let display_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    state
        .0
        .lock()
        .map_err(|_| "BLK-HOST-001")?
        .insert(handle.clone(), path);
    Ok(Some(Saved {
        handle,
        display_name,
    }))
}
