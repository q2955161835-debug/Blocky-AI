use serde::{Deserialize, Serialize};
use windows_sys::Win32::{
    Foundation::*, Security::*, System::Threading::*, UI::WindowsAndMessaging::*,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub identity: String,
    pub window: usize,
    pub process_id: u32,
    pub created: u64,
    pub class_name: String,
    pub title: String,
}
struct Owned(HANDLE);
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn token(process: HANDLE) -> Result<Owned, String> {
    let mut value = std::ptr::null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut value) } == 0 {
        return Err("BLK-RPA-TARGET-001".into());
    }
    Ok(Owned(value))
}
fn user(token: &Owned) -> Result<Vec<usize>, String> {
    let mut size = 0;
    unsafe {
        GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut size);
    }
    if size == 0 || size > 65536 {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let mut data = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            data.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    Ok(data)
}
fn allowed_process(process: HANDLE) -> Result<(), String> {
    let remote = token(process)?;
    let local = token(unsafe { GetCurrentProcess() })?;
    let theirs = user(&remote)?;
    let ours = user(&local)?;
    let same = unsafe {
        EqualSid(
            (*(theirs.as_ptr().cast::<TOKEN_USER>())).User.Sid,
            (*(ours.as_ptr().cast::<TOKEN_USER>())).User.Sid,
        )
    } != 0;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut bytes = 0;
    let queried = unsafe {
        GetTokenInformation(
            remote.0,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut bytes,
        )
    } != 0;
    if !same || !queried || elevation.TokenIsElevated != 0 {
        return Err("BLK-RPA-PERM-002".into());
    }
    Ok(())
}
pub fn inspect(window: usize) -> Result<Target, String> {
    let hwnd = window as HWND;
    if window == 0
        || unsafe { IsWindow(hwnd) } == 0
        || unsafe { IsWindowVisible(hwnd) } == 0
        || unsafe { GetAncestor(hwnd, GA_ROOT) } != hwnd
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let process = Owned(handle);
    allowed_process(process.0)?;
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) } == 0
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let created = (created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64;
    let mut title = [0u16; 512];
    let mut class_name = [0u16; 256];
    let title_len =
        unsafe { GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32) }.max(0) as usize;
    let class_len = unsafe { GetClassNameW(hwnd, class_name.as_mut_ptr(), class_name.len() as i32) }
        .max(0) as usize;
    if class_len == 0 {
        return Err("BLK-RPA-TARGET-001".into());
    }
    Ok(Target {
        identity: format!("windows:{window:x}:{pid}:{created:x}"),
        window,
        process_id: pid,
        created,
        title: String::from_utf16_lossy(&title[..title_len]),
        class_name: String::from_utf16_lossy(&class_name[..class_len]),
    })
}
pub fn verify(target: &Target) -> Result<(), String> {
    let current = inspect(target.window)?;
    // Titles can change during a legitimate flow; process creation time and the
    // UIA root runtime ID (checked in the worker) bind the actual target.
    if current.identity != target.identity || current.class_name != target.class_name {
        return Err("BLK-RPA-TARGET-001".into());
    }
    Ok(())
}
pub fn list() -> Vec<Target> {
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
        let result = unsafe { &mut *(data as *mut Vec<Target>) };
        if result.len() >= 128 {
            return 0;
        }
        if let Ok(target) = inspect(hwnd as usize) {
            if !target.title.is_empty() && target.process_id != std::process::id() {
                result.push(target);
            }
        }
        1
    }
    let mut result = Vec::new();
    unsafe {
        EnumWindows(Some(visit), (&mut result as *mut Vec<Target>) as LPARAM);
    }
    result
}
