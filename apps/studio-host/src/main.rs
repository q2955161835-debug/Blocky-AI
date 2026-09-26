#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(feature = "wdio")]
mod acceptance;
mod agent_data_commands;
mod builder_commands;
mod commands;
mod conversion_commands;
mod knowledge_commands;
mod log_commands;
mod provider_commands;
mod rpa_commands;
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
        Some("--blocky-rpa-recording-worker") => std::process::exit(blocky_studio::rpa::recording::worker_main()),
        Some("--blocky-rpa-worker") => std::process::exit(blocky_studio::rpa::worker_main()),
        Some("--blocky-task-worker") => std::process::exit(blocky_studio::task_host::worker_main()),
        Some("--blocky-task-run") => std::process::exit(blocky_studio::task_host::runner_main()),
        _ => {}
    }
    let mut selected = blocky_studio::profile::from_options(std::env::args_os().skip(1), std::env::var_os(blocky_studio::profile::VARIABLE))
        .unwrap_or_else(|code| { eprintln!("{code}"); std::process::exit(2); });
    let mut context = tauri::generate_context!();
    // Naming the default root explicitly must not create a second instance on it.
    if selected.as_ref().is_some_and(|root| blocky_studio::profile::is_default(root, &context.config().identifier)) { selected = None; }
    if let Some(root) = &selected {
        context.config_mut().identifier = blocky_studio::profile::instance_identifier(&context.config().identifier, root);
    }
    // Restore saved physical bounds before the first visible frame.
    let mut profile_windows = Vec::new();
    for window in &mut context.config_mut().app.windows {
        if window.label == "main" { window.visible = false; }
        if selected.is_some() && window.create {
            profile_windows.push(window.clone());
            window.create = false;
        }
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
        .manage(blocky_studio::builder::BuilderHost::default())
        .manage(blocky_studio::provider::ProviderHost::default())
        .manage(blocky_studio::task_host::TaskHost::default())
        .manage(blocky_studio::user_terminal::UserTerminals::default())
        .manage(window_lifecycle::Lifecycle::default())
        .setup(move |app| {
            let root = match selected { Some(root) => root, None => app.path().app_local_data_dir()? };
            app.manage(blocky_studio::profile::DataRoot(root.clone()));
            app.manage(blocky_studio::rpa::RpaHost::with_journal(
                root.join("rpa/checkpoints"),
            ));
            app.manage(blocky_studio::agent_data::AgentData::new(
                root.join("user/agent-memory"),
            ));
            app.manage(blocky_studio::conversion::ConversionStore::new(
                root.join("conversion"),
            ));
            app.manage(blocky_studio::knowledge::KnowledgeStore::new(
                root.join("knowledge"),
            ));
            app.manage(blocky_studio::user_store::UserStore::new(
                root.join("user"),
            ));
            app.manage(blocky_studio::secret_store::SecretStore::new(
                root.join("secrets"),
            ));
            app.manage(blocky_studio::log_store::LogStore::open(
                root.join("logs/diagnostics.json"),
            ));
            // Tauri's config conversion does not carry an absolute data directory
            // into WebviewAttributes. Set it on the native builder after conversion.
            for config in profile_windows {
                tauri::WebviewWindowBuilder::from_config(app, &config)?
                    .data_directory(root.join("webview2").join(&config.label))
                    .build()?;
            }
            window_state::restore(app);
            window_lifecycle::setup(app)?;
            if let Some(window) = app.get_webview_window("main") { window.show()?; }
            Ok(())
        })
        .on_window_event(window_lifecycle::window_event)
        .invoke_handler(tauri::generate_handler![
            rpa_commands::rpa_targets,
            rpa_commands::rpa_record_start,
            rpa_commands::rpa_record_status,
            rpa_commands::rpa_record_stop,
            rpa_commands::rpa_checkpoints,
            rpa_commands::rpa_checkpoint,
            rpa_commands::rpa_checkpoint_delete,
            rpa_commands::rpa_recovery_preview,
            rpa_commands::rpa_recover,
            rpa_commands::rpa_authorize,
            rpa_commands::rpa_cancel_authorization,
            rpa_commands::rpa_step,
            rpa_commands::rpa_status,
            rpa_commands::rpa_pause,
            rpa_commands::rpa_resume,
            rpa_commands::rpa_stop,
            agent_data_commands::agent_memory_authorize,
            agent_data_commands::agent_memory,
            agent_data_commands::agent_memory_cancel,
            agent_data_commands::agent_tool_preflight,
            agent_data_commands::agent_tool_call,
            agent_data_commands::agent_tool_cancel,
            agent_data_commands::agent_output_save,
            provider_commands::provider_preflight,
            provider_commands::provider_call,
            provider_commands::provider_cancel,
            #[cfg(feature = "wdio")]
            acceptance::acceptance_round_trip,
            commands::open_project,
            conversion_commands::conversion_scan,
            conversion_commands::conversion_read,
            conversion_commands::conversion_cache_load,
            conversion_commands::conversion_cache_save,
            conversion_commands::conversion_cancel,
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
            builder_commands::builder_run,
            builder_commands::builder_cancel,
            builder_commands::builder_evidence,
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
        .build(context)
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
