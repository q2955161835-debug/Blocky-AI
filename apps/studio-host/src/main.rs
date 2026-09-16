#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
use blocky_studio::project_store;
fn main() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .manage(commands::Handles::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_project,
            commands::validate_patch
        ])
        .run(tauri::generate_context!())
        .expect("Blocky Studio could not start");
}
