use blocky_studio::project_store::{self, ProjectFiles};
use tauri::Manager;
// Entire module and registration are removed without the wdio feature.
#[tauri::command]
pub fn acceptance_round_trip(
    window: tauri::WebviewWindow,
    files: ProjectFiles,
) -> Result<ProjectFiles, String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    let folder = blocky_studio::profile::for_app(window.app_handle())?.join("acceptance");
    std::fs::create_dir_all(&folder).map_err(|_| "BLK-HOST-001")?;
    let path = folder.join("full.blocky");
    project_store::save_archive(&path, &files)?;
    project_store::read_archive(&path)
}
