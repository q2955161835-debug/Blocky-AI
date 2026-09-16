use blocky_studio::secret_store::SecretStore;
use tauri::Manager;
#[tauri::command]
pub async fn import_secret(
    window: tauri::WebviewWindow,
    id: String,
    variable: String,
) -> Result<bool, String> {
    crate::window_lifecycle::visible(&window)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择包含秘密配置的本地 .env 文件")
        .pick_file()
        .await
    else {
        return Ok(false);
    };
    crate::window_lifecycle::visible(&window)?;
    window
        .state::<SecretStore>()
        .import_env(&id, file.path(), &variable)?;
    Ok(true)
}
#[tauri::command]
pub fn secret_status(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, SecretStore>,
    id: String,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    store.contains(&id)
}
#[tauri::command]
pub fn remove_secret(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, SecretStore>,
    id: String,
) -> Result<(), String> {
    crate::window_lifecycle::visible(&window)?;
    store.remove(&id)
}
