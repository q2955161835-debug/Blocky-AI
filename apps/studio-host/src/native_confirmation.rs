mod placement;
#[cfg(windows)]
mod windows;

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
