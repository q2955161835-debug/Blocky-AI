#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
use blocky_studio::project_store;
fn main() {
    tauri::Builder::default()
        .manage(commands::Handles::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_project
        ])
        .run(tauri::generate_context!())
        .expect("Blocky Studio could not start");
}
