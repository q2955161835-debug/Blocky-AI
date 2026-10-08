mod placement;
#[cfg(windows)]
mod windows;

/// Read the persisted profile preference for every new request so that other
/// windows and reopened projects use the same mode. Never bypass Host preflight.
pub async fn runtime_request(
    window: &tauri::WebviewWindow,
    title: &str,
    description: impl Into<String>,
) -> Result<bool, String> {
    use tauri::Manager;
    if window.label() != "main" { return Err("BLK-PERM-001".into()); }
    let store = window.state::<crate::user_store::UserStore>();
    crate::permission_policy::authorize_request(&store, || yes_no(window, title, description)).await?;
    Ok(true)
}

/// Native Yes/No approval, positioned inside its visible owner on Windows.
/// Failure to establish the owner or place the prompt is a refusal.
pub async fn yes_no(
    window: &tauri::WebviewWindow,
    title: &str,
    description: impl Into<String>,
) -> bool {
    let window = window.clone();
    let title = title.to_owned();
    let description = description.into();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let placement = {
            let Ok(hwnd) = window.hwnd() else {
                return false;
            };
            let Some(placement) = windows::Placement::install(hwnd.0 as _) else {
                return false;
            };
            placement
        };
        let answer = rfd::MessageDialog::new()
            .set_parent(&window)
            .set_title(title)
            .set_description(description)
            .set_buttons(rfd::MessageButtons::YesNo)
            .show();
        #[cfg(windows)]
        if !placement.placed() {
            return false;
        }
        answer == rfd::MessageDialogResult::Yes
    })
    .await
    .unwrap_or(false)
}
