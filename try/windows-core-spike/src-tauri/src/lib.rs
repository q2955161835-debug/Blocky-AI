pub mod project_store;

use project_store::{HostError, ProjectRecord, ProjectStore, SaveProjectRequest};
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_project, load_project])
        .run(tauri::generate_context!())
        .expect("error while running Blocky Windows Core spike");
}
