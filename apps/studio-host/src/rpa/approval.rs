//! A bounded native review window. Long plans remain fully readable in a scrollable control.
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::{COLOR_WINDOW, DEFAULT_GUI_FONT, GetStockObject},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetFocus, SetFocus},
        WindowsAndMessaging::*,
    },
};
const APPROVE: usize = 1;
const CANCEL: usize = 2;
struct State {
    approved: bool,
    approve: HWND,
    cancel: HWND,
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn bounds(work: RECT) -> Result<(i32, i32, i32, i32), String> {
    let width = (i64::from(work.right) - i64::from(work.left) - 48).min(960);
    let height = (i64::from(work.bottom) - i64::from(work.top) - 48).min(740);
    if width < 480 || height < 320 {
        return Err("BLK-RPA-UIA-001".into());
    }
    Ok((
        work.left.saturating_add(24),
        work.top.saturating_add(24),
        width as i32,
        height as i32,
    ))
}
unsafe extern "system" fn procedure(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let state = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut State };
    match msg {
        WM_NCCREATE => {
            let creation = unsafe { &*(lparam as *const CREATESTRUCTW) };
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, creation.lpCreateParams as isize);
            }
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_COMMAND if !state.is_null() && (wparam >> 16) == BN_CLICKED as usize => {
            let state = unsafe { &mut *state };
            let button = wparam & 0xffff;
            if button == APPROVE && lparam as HWND == state.approve && !state.approve.is_null() {
                state.approved = true;
                unsafe {
                    DestroyWindow(hwnd);
                }
            } else if button == CANCEL && lparam as HWND == state.cancel && !state.cancel.is_null()
            {
                unsafe {
                    DestroyWindow(hwnd);
                }
            }
            0
        }
        WM_CLOSE => {
            unsafe {
                DestroyWindow(hwnd);
            }
            0
        }
        WM_DESTROY => {
            unsafe {
                PostQuitMessage(0);
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}
pub(super) fn show(description: &str) -> Result<bool, String> {
    if description.is_empty() || description.len() > 32768 || description.contains('\0') {
        return Err("BLK-RPA-INPUT-001".into());
    }
    unsafe {
        let description = description.replace("\r\n", "\n").replace('\n', "\r\n");
        let mut work = RECT::default();
        if SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut work as *mut RECT).cast(), 0) == 0 {
            return Err("BLK-RPA-UIA-001".into());
        }
        let (x, y, width, height) = bounds(work)?;
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide("BlockyAttendedConsent");
        let atom = RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hbrBackground: (COLOR_WINDOW + 1) as usize as _,
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            ..Default::default()
        });
        if atom == 0 {
            return Err("BLK-RPA-UIA-001".into());
        }
        let mut state = State {
            approved: false,
            approve: std::ptr::null_mut(),
            cancel: std::ptr::null_mut(),
        };
        let window = CreateWindowExW(
            WS_EX_CONTROLPARENT,
            class.as_ptr(),
            wide("确认有人值守自动化").as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
            x,
            y,
            width,
            height,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            (&mut state as *mut State).cast(),
        );
        if window.is_null() {
            UnregisterClassW(class.as_ptr(), instance);
            return Err("BLK-RPA-UIA-001".into());
        }
        let mut client = RECT::default();
        GetClientRect(window, &mut client);
        let (w, h) = (client.right, client.bottom);
        let label = CreateWindowExW(
            0,
            wide("STATIC").as_ptr(),
            wide("请核对目标与操作。仅本次授权有效。").as_ptr(),
            WS_CHILD | WS_VISIBLE,
            20,
            16,
            w - 40,
            26,
            window,
            10usize as HMENU,
            instance,
            std::ptr::null(),
        );
        let edit = CreateWindowExW(
            WS_EX_CLIENTEDGE,
            wide("EDIT").as_ptr(),
            wide(&description).as_ptr(),
            WS_CHILD
                | WS_VISIBLE
                | WS_TABSTOP
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            20,
            50,
            w - 40,
            h - 120,
            window,
            11usize as HMENU,
            instance,
            std::ptr::null(),
        );
        state.approve = CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("允许本次操作").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
            w - 320,
            h - 52,
            170,
            32,
            window,
            APPROVE as HMENU,
            instance,
            std::ptr::null(),
        );
        state.cancel = CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("取消").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
            w - 130,
            h - 52,
            110,
            32,
            window,
            CANCEL as HMENU,
            instance,
            std::ptr::null(),
        );
        if [label, edit, state.approve, state.cancel]
            .iter()
            .any(|handle| handle.is_null())
        {
            DestroyWindow(window);
            UnregisterClassW(class.as_ptr(), instance);
            return Err("BLK-RPA-UIA-001".into());
        }
        for child in [label, edit, state.approve, state.cancel] {
            SendMessageW(
                child,
                WM_SETFONT,
                GetStockObject(DEFAULT_GUI_FONT) as usize,
                1,
            );
        }
        ShowWindow(window, SW_SHOW);
        SetForegroundWindow(window);
        SetFocus(state.cancel);
        let mut message = MSG::default();
        let valid = loop {
            let result = GetMessageW(&mut message, std::ptr::null_mut(), 0, 0);
            if result <= 0 {
                break result == 0;
            }
            // Escape always cancels, including focus in the read-only plan.
            if message.message == WM_KEYDOWN && message.wParam == 0x1b {
                DestroyWindow(window);
                continue;
            }
            if message.message == WM_KEYDOWN && message.wParam == 0x0d {
                if GetFocus() == state.approve {
                    SendMessageW(state.approve, 0x00f5, 0, 0); // BM_CLICK on the explicitly focused approval.
                } else {
                    DestroyWindow(window);
                }
                continue;
            }
            if IsDialogMessageW(window, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        };
        if IsWindow(window) != 0 {
            DestroyWindow(window);
        }
        UnregisterClassW(class.as_ptr(), instance);
        if valid {
            Ok(state.approved)
        } else {
            Err("BLK-RPA-UIA-001".into())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_review_fits_top_left_and_rejects_unreadable_work_areas() {
        assert_eq!(
            bounds(RECT {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1400
            })
            .unwrap(),
            (24, 24, 960, 740)
        );
        assert_eq!(
            bounds(RECT {
                left: -1920,
                top: 0,
                right: 0,
                bottom: 1080
            })
            .unwrap(),
            (-1896, 24, 960, 740)
        );
        assert!(
            bounds(RECT {
                left: 0,
                top: 0,
                right: 480,
                bottom: 320
            })
            .is_err()
        );
    }
}

#[cfg(test)]
#[path = "approval_tests.rs"]
mod native_tests;
