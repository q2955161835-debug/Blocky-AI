use blocky_studio::{
    project_store::ProjectFiles,
    task_host::{TaskHost, TaskRequest, TaskSnapshot},
};
fn main_visible(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::window_lifecycle::visible(window)?;
    if window.label() != "main" {
        return Err("BLK-TERM-003".into());
    }
    if !window.is_visible().map_err(|_| "BLK-WINDOW-001")?
        || window.is_minimized().map_err(|_| "BLK-WINDOW-001")?
    {
        return Err("BLK-WINDOW-001".into());
    }
    Ok(())
}
#[tauri::command]
pub fn start_task(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, TaskHost>,
    request: TaskRequest,
    files: ProjectFiles,
) -> Result<String, String> {
    main_visible(&window)?;
    host.start(request, files)
}
#[tauri::command]
pub fn task_status(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, TaskHost>,
    request_id: String,
) -> Result<TaskSnapshot, String> {
    if window.label() != "main" {
        return Err("BLK-TERM-003".into());
    }
    host.snapshot(&request_id)
}
#[tauri::command]
pub fn cancel_task(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, TaskHost>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-TERM-003".into());
    }
    host.cancel(&request_id)
}
#[tauri::command]
pub fn attach_user_terminal() -> Result<(), String> {
    Err("BLK-TERM-003".into())
}
#[tauri::command]
pub fn settle_tasks(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, TaskHost>,
) -> Result<(), String> {
    use tauri::Manager;
    if window.label() != "main"
        || !window
            .state::<crate::window_lifecycle::Lifecycle>()
            .closing
            .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("BLK-WINDOW-001".into());
    }
    host.shutdown()
}
