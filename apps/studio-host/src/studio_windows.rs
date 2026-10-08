//! Switch only between this executable's windows in the current desktop/profile.
use serde::Serialize;
use tauri::Manager;
use windows_sys::Win32::{Foundation::*, System::Threading::*, UI::WindowsAndMessaging::*};
#[derive(Serialize)]
pub struct StudioWindow { id: String, title: String, current: bool }
struct Search { property: Vec<u16>, exe: String, current: HWND, found: Vec<StudioWindow> }
fn property(app: &tauri::AppHandle) -> Result<Vec<u16>, String> {
    let root = blocky_studio::profile::for_app(app)?;
    Ok(format!("BlockyStudio.Profile.{}", blocky_studio::profile::identity(&root)).encode_utf16().chain([0]).collect())
}
pub fn register(app: &tauri::App) -> Result<(), String> {
    let handle = app.handle();
    let window = app.get_webview_window("main").ok_or("BLK-WINDOW-001")?;
    let hwnd = window.hwnd().map_err(|_| "BLK-WINDOW-001")?.0;
    if unsafe { SetPropW(hwnd, property(handle)?.as_ptr(), 1usize as HANDLE) } == 0 { return Err("BLK-WINDOW-001".into()); }
    Ok(())
}
fn same_executable(hwnd: HWND, expected: &str) -> bool {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid); }
    if pid == 0 { return false; }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() { return false; }
    let mut text = vec![0u16; 32768]; let mut size = text.len() as u32;
    let success = unsafe { QueryFullProcessImageNameW(process, 0, text.as_mut_ptr(), &mut size) };
    unsafe { CloseHandle(process); }
    success != 0 && String::from_utf16_lossy(&text[..size as usize]).to_lowercase() == expected
}
unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> i32 {
    let search = unsafe { &mut *(param as *mut Search) };
    if search.found.len() >= 32 { return 0; }
    if unsafe { GetPropW(hwnd, search.property.as_ptr()) } != 1usize as HANDLE || !same_executable(hwnd, &search.exe) { return 1; }
    let mut text = [0u16; 1024];
    let size = unsafe { GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32) }.max(0) as usize;
    search.found.push(StudioWindow { id: (hwnd as usize).to_string(), title: String::from_utf16_lossy(&text[..size]), current: hwnd == search.current });
    1
}
fn list(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> Result<Vec<StudioWindow>, String> {
    if window.label() != "main" { return Err("BLK-PERM-001".into()); }
    let mut search = Search {property: property(app)?, exe: std::env::current_exe().map_err(|_| "BLK-WINDOW-001")?.to_string_lossy().to_lowercase(), current: window.hwnd().map_err(|_| "BLK-WINDOW-001")?.0, found: vec![]};
    unsafe { EnumWindows(Some(visit), (&mut search as *mut Search) as LPARAM); }
    Ok(search.found)
}
#[tauri::command]
pub fn studio_windows(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Vec<StudioWindow>, String> {
    crate::window_lifecycle::visible(&window)?;
    list(&window, &app)
}
#[tauri::command]
pub fn focus_studio_window(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    crate::window_lifecycle::visible(&window)?;
    if !list(&window, &app)?.iter().any(|item| item.id == id) { return Err("BLK-PERM-001".into()); }
    let hwnd = id.parse::<usize>().map_err(|_| "BLK-PERM-001")? as HWND;
    // Show restores hidden tray windows; SW_RESTORE is only needed for minimized windows.
    unsafe { ShowWindow(hwnd, if IsIconic(hwnd) != 0 { SW_RESTORE } else { SW_SHOW }); }
    if unsafe { SetForegroundWindow(hwnd) } == 0 { return Err("BLK-WINDOW-001".into()); }
    Ok(())
}
