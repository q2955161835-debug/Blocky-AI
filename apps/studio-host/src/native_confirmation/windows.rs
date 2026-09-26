use super::placement::{Rect, position};
use std::{cell::Cell, ptr::null_mut};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    System::Threading::{GetCurrentProcessId, GetCurrentThreadId},
    UI::WindowsAndMessaging::*,
};

#[derive(Clone, Copy)]
struct State {
    owner: HWND,
    seen: bool,
    placed: bool,
}
thread_local! { static STATE: Cell<Option<State>> = const { Cell::new(None) }; }

pub(super) struct Placement(HHOOK);
impl Placement {
    pub(super) fn install(owner: HWND) -> Option<Self> {
        if !valid_owner(owner) || STATE.get().is_some() {
            return None;
        }
        // The synchronous RFD dialog is created on this blocking thread. Never hook
        // other threads/processes, and never install an application-wide hook.
        let hook =
            unsafe { SetWindowsHookExW(WH_CBT, Some(on_cbt), null_mut(), GetCurrentThreadId()) };
        if hook.is_null() {
            return None;
        }
        STATE.set(Some(State {
            owner,
            seen: false,
            placed: false,
        }));
        Some(Self(hook))
    }
    pub(super) fn placed(&self) -> bool {
        STATE
            .get()
            .is_some_and(|state| state.placed && valid_owner(state.owner))
    }
}
impl Drop for Placement {
    fn drop(&mut self) {
        unsafe {
            UnhookWindowsHookEx(self.0);
        }
        STATE.set(None);
    }
}

fn valid_owner(owner: HWND) -> bool {
    let mut process = 0;
    unsafe {
        GetWindowThreadProcessId(owner, &mut process);
        !owner.is_null()
            && process == GetCurrentProcessId()
            && IsWindowVisible(owner) != 0
            && IsIconic(owner) == 0
    }
}

fn matching_dialog(dialog: HWND, owner: HWND) -> bool {
    let mut process = 0;
    let mut class = [0u16; 32];
    unsafe {
        GetWindowThreadProcessId(dialog, &mut process);
        process == GetCurrentProcessId()
            && GetWindow(dialog, GW_OWNER) == owner
            && GetClassNameW(dialog, class.as_mut_ptr(), class.len() as i32) == 6
            && class[..6] == [35, 51, 50, 55, 55, 48] // #32770, the system dialog class
    }
}

unsafe extern "system" fn on_cbt(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HCBT_ACTIVATE as i32 {
        if let Some(mut state) = STATE.get() {
            let dialog = wparam as HWND;
            if !state.seen && matching_dialog(dialog, state.owner) {
                state.seen = true;
                state.placed = place(dialog, state.owner);
                STATE.set(Some(state));
                if !state.placed {
                    // Closing a Yes/No prompt is refusal; never synthesize Yes.
                    unsafe {
                        PostMessageW(dialog, WM_COMMAND, IDNO as WPARAM, 0);
                    }
                    return 1;
                }
            }
        }
    }
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

fn rect(value: RECT) -> Rect {
    Rect {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
    }
}
fn place(dialog: HWND, owner: HWND) -> bool {
    if !valid_owner(owner) {
        return false;
    }
    let mut owner_rect = RECT::default();
    let mut dialog_rect = RECT::default();
    let mut monitor = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        if GetWindowRect(owner, &mut owner_rect) == 0
            || GetWindowRect(dialog, &mut dialog_rect) == 0
            || GetMonitorInfoW(
                MonitorFromWindow(owner, MONITOR_DEFAULTTONEAREST),
                &mut monitor,
            ) == 0
        {
            return false;
        }
        let Some(width) = dialog_rect.right.checked_sub(dialog_rect.left) else {
            return false;
        };
        let Some(height) = dialog_rect.bottom.checked_sub(dialog_rect.top) else {
            return false;
        };
        let Some((x, y)) = position(rect(owner_rect), rect(monitor.rcWork), width, height) else {
            return false;
        };
        if SetWindowPos(
            dialog,
            null_mut(),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        ) == 0
        {
            return false;
        }
        // Read the actual result, not just the requested position.
        GetWindowRect(dialog, &mut dialog_rect) != 0
            && dialog_rect.left == x
            && dialog_rect.top == y
            && dialog_rect.right == x + width
            && dialog_rect.bottom == y + height
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A real system modal dialog, intentionally too large for its tiny owner.
    // Explicit opt-in because this test creates a visible native owner window.
    #[test]
    #[ignore = "creates a bounded native test window"]
    fn native_unplaceable_prompt_returns_no_without_user_input() {
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "Blocky placement refusal test\0".encode_utf16().collect();
            let owner = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                0,
                0,
                80,
                80,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            );
            assert!(!owner.is_null());
            let placement = Placement::install(owner).expect("valid self-owned test window");
            let message: Vec<u16> = "This owned test prompt must refuse when it cannot fit.\0"
                .encode_utf16()
                .collect();
            let started = std::time::Instant::now();
            let answer = MessageBoxW(owner, message.as_ptr(), title.as_ptr(), MB_YESNO);
            let elapsed = started.elapsed();
            let placed = placement.placed();
            drop(placement);
            DestroyWindow(owner);
            assert_eq!(answer, IDNO);
            assert!(!placed);
            assert!(
                elapsed < std::time::Duration::from_secs(2),
                "refusal must settle promptly: {elapsed:?}"
            );
            assert!(STATE.get().is_none());
        }
    }
}
