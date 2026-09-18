#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(feature = "wdio")]
mod acceptance;
mod commands;
mod knowledge_commands;
mod log_commands;
mod secret_commands;
mod task_commands;
mod terminal_commands;
mod user_commands;
mod window_lifecycle;
mod window_state;
use blocky_studio::project_store;
use tauri::Manager;
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--blocky-task-worker") => std::process::exit(blocky_studio::task_host::worker_main()),
        Some("--blocky-task-run") => std::process::exit(blocky_studio::task_host::runner_main()),
        _ => {}
    }
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window_lifecycle::restore(app);
        }));
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .manage(commands::Handles::default())
        .manage(blocky_studio::task_host::TaskHost::default())
        .manage(blocky_studio::user_terminal::UserTerminals::default())
        .manage(window_lifecycle::Lifecycle::default())
        .setup(|app| {
            app.manage(blocky_studio::knowledge::KnowledgeStore::new(
                app.path().app_local_data_dir()?.join("knowledge"),
            ));
            app.manage(blocky_studio::user_store::UserStore::new(
                app.path().app_local_data_dir()?.join("user"),
            ));
            window_state::restore(app);
            app.manage(blocky_studio::secret_store::SecretStore::new(
                app.path().app_local_data_dir()?.join("secrets"),
            ));
            app.manage(blocky_studio::log_store::LogStore::open(
                app.path()
                    .app_local_data_dir()?
                    .join("logs/diagnostics.json"),
            ));
            window_lifecycle::setup(app)
        })
        .on_window_event(window_lifecycle::window_event)
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "wdio")]
            acceptance::acceptance_round_trip,
            commands::open_project,
            knowledge_commands::knowledge_source_add,
            knowledge_commands::knowledge_sources,
            knowledge_commands::knowledge_read_source,
            knowledge_commands::knowledge_source_remove,
            knowledge_commands::knowledge_source_acl,
            knowledge_commands::knowledge_load_index,
            knowledge_commands::knowledge_save_index,
            knowledge_commands::knowledge_cancel,
            knowledge_commands::knowledge_read_document,
            knowledge_commands::knowledge_model_status,
            knowledge_commands::knowledge_model_install,
            knowledge_commands::knowledge_embed_index,
            knowledge_commands::knowledge_vector_query,
            user_commands::read_user_state,
            user_commands::write_user_state,
            user_commands::clear_user_state,
            secret_commands::import_secret,
            secret_commands::secret_status,
            secret_commands::remove_secret,
            commands::open_migration,
            commands::save_migration,
            commands::save_project,
            commands::validate_patch,
            commands::authorize_surface,
            task_commands::start_task,
            task_commands::task_status,
            task_commands::cancel_task,
            task_commands::attach_user_terminal,
            task_commands::settle_tasks,
            terminal_commands::create_terminal,
            terminal_commands::read_terminal,
            terminal_commands::write_terminal,
            terminal_commands::resize_terminal,
            terminal_commands::close_terminal,
            window_lifecycle::authorize_run,
            window_lifecycle::set_window_preferences,
            window_lifecycle::hide_window,
            window_lifecycle::begin_exit,
            window_lifecycle::finish_exit,
            log_commands::append_diagnostics,
            log_commands::configure_diagnostics,
            log_commands::diagnostic_stats,
            log_commands::read_diagnostics,
            log_commands::clear_diagnostics,
            log_commands::export_diagnostics
        ])
        .build(tauri::generate_context!())
        .expect("Blocky Studio could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app
                    .state::<window_lifecycle::Lifecycle>()
                    .authorized
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    window_lifecycle::restore(app);
                    window_lifecycle::notify(app, "close");
                }
            }
        });
}
