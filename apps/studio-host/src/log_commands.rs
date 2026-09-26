use blocky_studio::log_store::{Diagnostics, ExportFilter, LogStore, Record, Scope, Stats};
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-LOG-004".into());
    }
    Ok(())
}
#[tauri::command]
pub fn append_diagnostics(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
    records: Vec<Record>,
    dropped: Option<u64>,
    dropped_important: Option<u64>,
) -> Result<(), String> {
    main_only(&window)?;
    store.append_with_losses(
        records,
        dropped.unwrap_or(0),
        dropped_important.unwrap_or(0),
    )
}
#[tauri::command]
pub fn read_diagnostics(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
    channel: Option<String>,
) -> Result<Diagnostics, String> {
    main_only(&window)?;
    store.read(channel.as_deref())
}
#[tauri::command]
pub fn clear_diagnostics(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
) -> Result<(), String> {
    main_only(&window)?;
    store.clear()
}
#[tauri::command]
pub async fn export_diagnostics(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
    channel: Option<String>,
    from_timestamp: Option<String>,
    to_timestamp: Option<String>,
    scope: Option<Scope>,
) -> Result<bool, String> {
    main_only(&window)?;
    let value = store.read_filtered(ExportFilter {
        channel,
        from_timestamp,
        to_timestamp,
        scope,
    })?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("导出诊断摘要")
        .set_file_name("blocky-diagnostics.json")
        .add_filter("诊断文件", &["json"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let bytes = serde_json::to_vec_pretty(&value).map_err(|_| "BLK-LOG-004")?;
    // The native picker owns the target choice and overwrite confirmation.
    let parent = file.path().parent().ok_or("BLK-LOG-004")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "BLK-LOG-004")?;
    use std::io::Write;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "BLK-LOG-004")?;
    temporary.persist(file.path()).map_err(|_| "BLK-LOG-004")?;
    Ok(true)
}
#[tauri::command]
pub fn configure_diagnostics(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
    days: u16,
    max_bytes: u64,
) -> Result<Stats, String> {
    main_only(&window)?;
    store.configure(days, max_bytes)?;
    store.stats()
}
#[tauri::command]
pub fn diagnostic_stats(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LogStore>,
) -> Result<Stats, String> {
    main_only(&window)?;
    store.stats()
}
