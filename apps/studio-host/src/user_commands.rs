use blocky_studio::user_store::UserStore;
use serde_json::Value;
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    Ok(())
}
#[tauri::command]
pub fn patch_ui_preferences(window:tauri::WebviewWindow,store:tauri::State<'_,UserStore>,id:String,value:Value)->Result<Value,String>{
    main_only(&window)?;store.patch_ui_preferences(&id,value)
}
#[tauri::command]
pub fn read_user_state(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, UserStore>,
    kind: String,
    id: String,
) -> Result<Option<Value>, String> {
    main_only(&window)?;
    store.read(&kind, &id)
}
#[tauri::command]
pub fn write_user_state(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, UserStore>,
    kind: String,
    id: String,
    value: Value,
) -> Result<(), String> {
    main_only(&window)?;
    store.write(&kind, &id, value)
}
#[tauri::command]
pub fn clear_user_state(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, UserStore>,
    kind: String,
    id: String,
) -> Result<(), String> {
    main_only(&window)?;
    store.clear(&kind, &id)
}
