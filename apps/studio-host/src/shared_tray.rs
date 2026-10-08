use blocky_studio::tray_owner::TrayOwner;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;
struct SharedTray {
    owner: Mutex<Option<TrayOwner>>,
    pending: AtomicBool,
}
fn group() -> Result<String, String> {
    use windows_sys::Win32::System::{
        RemoteDesktop::ProcessIdToSessionId,
        StationsAndDesktops::*,
        Threading::{GetCurrentProcessId, GetCurrentThreadId},
    };
    let mut desktop = [0u16; 256];
    let mut length = 0;
    let mut session = 0;
    let handle = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    if unsafe {
        GetUserObjectInformationW(
            handle,
            UOI_NAME,
            desktop.as_mut_ptr().cast(),
            (desktop.len() * 2) as u32,
            &mut length,
        )
    } == 0
        || unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session) } == 0
    {
        return Err("BLK-WINDOW-001".into());
    }
    let desktop = String::from_utf16_lossy(
        &desktop[..desktop
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(desktop.len())],
    );
    Ok(format!(
        "{}:{session}:{desktop}",
        std::env::current_exe()
            .map_err(|_| "BLK-WINDOW-001")?
            .to_string_lossy()
    ))
}
pub fn start(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let root = blocky_studio::profile::for_app(app.handle())?.join("user");
    let group = group()?;
    app.manage(SharedTray {
        owner: Mutex::new(None),
        pending: AtomicBool::new(false),
    });
    // Initial setup is on the UI thread. Followers never construct a duplicate icon.
    if let Some(owner) = TrayOwner::claim(&root, &group)? {
        crate::window_lifecycle::build_tray(app.handle())?;
        *app.state::<SharedTray>()
            .owner
            .lock()
            .map_err(|_| "BLK-WINDOW-001")? = Some(owner);
    }
    let app = app.handle().clone();
    std::thread::Builder::new()
        .name("blocky-tray-owner".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(750));
            if app
                .state::<crate::window_lifecycle::Lifecycle>()
                .authorized
                .load(Ordering::SeqCst)
            {
                break;
            }
            let state = app.state::<SharedTray>();
            if state.owner.lock().map_or(true, |lease| lease.is_some())
                || state.pending.swap(true, Ordering::SeqCst)
            {
                continue;
            }
            let owner = TrayOwner::claim(&root, &group);
            match owner {
                Ok(Some(owner)) => {
                    if let Ok(mut slot) = state.owner.lock() {
                        *slot = Some(owner);
                    } else {
                        state.pending.store(false, Ordering::SeqCst);
                        continue;
                    }
                    let callback_app = app.clone();
                    if app
                        .run_on_main_thread(move || {
                            let state = callback_app.state::<SharedTray>();
                            if crate::window_lifecycle::build_tray(&callback_app).is_err() {
                                if let Ok(mut slot) = state.owner.lock() {
                                    *slot = None;
                                }
                            }
                            state.pending.store(false, Ordering::SeqCst);
                        })
                        .is_err()
                    {
                        if let Ok(mut slot) = state.owner.lock() {
                            *slot = None;
                        }
                        state.pending.store(false, Ordering::SeqCst);
                    }
                }
                _ => {
                    state.pending.store(false, Ordering::SeqCst);
                }
            }
        })?;
    Ok(())
}
