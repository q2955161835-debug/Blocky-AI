use blocky_studio::rpa::captures::{Store,Capture};
use serde_json::{Value,json};
use std::io::Write;
fn store(window:&tauri::WebviewWindow)->Result<Store,String> {
    if window.label()!="main" {return Err("BLK-RPA-PERM-001".into());}
    crate::window_lifecycle::visible(window)?;
    use tauri::Manager;
    Ok(Store::new(blocky_studio::profile::for_app(window.app_handle())?.join("rpa/captures")))
}
#[tauri::command]
pub async fn rpa_captures(window:tauri::WebviewWindow)->Result<Vec<Capture>,String> {
    tauri::async_runtime::spawn_blocking(move||store(&window)?.list()).await.map_err(|_|"BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_capture_read(window:tauri::WebviewWindow,capture_id:String)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move||store(&window)?.view(&capture_id)).await.map_err(|_|"BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_capture_delete(window:tauri::WebviewWindow,capture_id:String)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move||store(&window)?.delete(&capture_id)).await.map_err(|_|"BLK-RPA-WORKER-001")?
}
#[tauri::command]
pub async fn rpa_capture_export(window:tauri::WebviewWindow,capture_id:String)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move||{
        let captures=store(&window)?;
        // Verify before opening the native picker; no caller-supplied filesystem path.
        if !captures.list()?.iter().any(|c|c.capture_id==capture_id){return Err("BLK-RPA-CAPTURE-002".into());}
        let Some(path)=rfd::FileDialog::new().set_title("导出截图").add_filter("PNG 图片", &["png"]).set_file_name("Blocky截图.png").save_file() else {return Ok(json!({"exported":false}));};
        store(&window)?;
        let (meta,mut png)=captures.read(&capture_id)?;
        let result=(||{
            let mut file=std::fs::File::options().write(true).create_new(true).open(&path).map_err(|error|if error.kind()==std::io::ErrorKind::AlreadyExists{"BLK-RPA-CAPTURE-006"}else{"BLK-RPA-CAPTURE-001"})?;
            if file.write_all(&png).and_then(|_|file.sync_all()).is_err(){drop(file);let _=std::fs::remove_file(&path);return Err("BLK-RPA-CAPTURE-001".to_owned());}
            Ok(json!({"exported":true,"capture":meta}))
        })();
        // Image content is intentionally exported only following the native picker.
        png.fill(0);result
    }).await.map_err(|_|"BLK-RPA-WORKER-001")?
}
