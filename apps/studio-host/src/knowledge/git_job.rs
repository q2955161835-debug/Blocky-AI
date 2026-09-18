#[cfg(windows)]
pub struct GitJob {
    _handle: std::os::windows::io::OwnedHandle,
}
#[cfg(windows)]
impl GitJob {
    pub fn attach(child: &std::process::Child) -> Result<Self, String> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err("BLK-KNOW-IO".into());
            }
            let owned = OwnedHandle::from_raw_handle(handle as _);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as _) == 0
            {
                return Err("BLK-KNOW-IO".into());
            }
            Ok(Self { _handle: owned })
        }
    }
}
