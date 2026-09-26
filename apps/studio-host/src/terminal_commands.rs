use blocky_studio::user_terminal::{Profile, Snapshot, UserTerminals};
use tauri::Manager;

fn owner(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("BLK-TERM-003".into())
    }
}
#[tauri::command]
pub async fn create_terminal(
    window: tauri::WebviewWindow,
    profile: Profile,
    output_budget: usize,
) -> Result<Option<Snapshot>, String> {
    crate::window_lifecycle::visible(&window)?;
    let Some(folder) = rfd::AsyncFileDialog::new().set_parent(&window)
        .set_title("选择终端工作目录")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    crate::window_lifecycle::visible(&window)?;
    window
        .state::<UserTerminals>()
        .create(profile, folder.path(), output_budget, 24, 80, None)
        .map(Some)
}
#[tauri::command]
pub fn read_terminal(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, UserTerminals>,
    session_id: String,
) -> Result<Snapshot, String> {
    owner(&window)?;
    sessions.read(&session_id)
}
#[tauri::command]
pub fn write_terminal(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, UserTerminals>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    crate::window_lifecycle::visible(&window)?;
    sessions.write(&session_id, &input)
}
#[tauri::command]
pub fn resize_terminal(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, UserTerminals>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    owner(&window)?;
    sessions.resize(&session_id, rows, cols)
}
#[tauri::command]
pub fn close_terminal(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, UserTerminals>,
    session_id: String,
) -> Result<(), String> {
    crate::window_lifecycle::visible(&window)?;
    sessions.close(&session_id)
}
