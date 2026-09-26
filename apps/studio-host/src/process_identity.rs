//! A reusable native process identity. Access failures never count as process exit.
use serde::{Deserialize, Serialize};
use windows_sys::Win32::{Foundation::*, System::Threading::*};
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Identity {
    pub process_id: u32,
    pub created: u64,
}
struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn creation(handle: HANDLE) -> Result<u64, ()> {
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    if unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) } == 0 {
        return Err(());
    }
    Ok((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64)
}
impl Identity {
    pub(crate) fn from_handle(handle: HANDLE) -> Result<Self, ()> {
        let process_id = unsafe { GetProcessId(handle) };
        if process_id == 0 {
            return Err(());
        }
        Ok(Self {
            process_id,
            created: creation(handle)?,
        })
    }
    pub fn current() -> Result<Self, ()> {
        Ok(Self {
            process_id: std::process::id(),
            created: creation(unsafe { GetCurrentProcess() })?,
        })
    }
    pub fn is_alive(&self) -> Result<bool, ()> {
        if self.process_id == 0 || self.created == 0 {
            return Err(());
        }
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                self.process_id,
            )
        };
        if handle.is_null() {
            return if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                Ok(false)
            } else {
                Err(())
            };
        }
        let process = Process(handle);
        if creation(process.0)? != self.created {
            return Ok(false);
        }
        match unsafe { WaitForSingleObject(process.0, 0) } {
            WAIT_OBJECT_0 => Ok(false),
            WAIT_TIMEOUT => Ok(true),
            _ => Err(()),
        }
    }
}
