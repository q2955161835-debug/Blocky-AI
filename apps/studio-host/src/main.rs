#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod task_commands;
use blocky_studio::project_store;
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--blocky-task-worker") => std::process::exit(blocky_studio::task_host::worker_main()),
        Some("--blocky-task-run") => std::process::exit(blocky_studio::task_host::runner_main()),
        _ => {}
    }
    let builder = tauri::Builder::default();
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .manage(commands::Handles::default())
        .manage(blocky_studio::task_host::TaskHost::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::save_project,
            commands::validate_patch,
            commands::authorize_surface,
            task_commands::start_task,
            task_commands::task_status,
            task_commands::cancel_task,
            task_commands::attach_user_terminal
        ])
        .run(tauri::generate_context!())
        .expect("Blocky Studio could not start");
}
