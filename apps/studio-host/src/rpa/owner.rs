//! An execution owner is a process identity, never a reusable PID alone.
use serde::{Deserialize, Serialize};
use windows_sys::Win32::{Foundation::*, System::Threading::*};

const ERROR: &str = "BLK-RPA-RECOVERY-001";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Owner {
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
fn creation(handle: HANDLE) -> Result<u64, String> {
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    if unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) } == 0 {
        return Err(ERROR.into());
    }
    Ok((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64)
}
impl Owner {
    pub fn current() -> Result<Self, String> {
        Ok(Self {
            process_id: std::process::id(),
            created: creation(unsafe { GetCurrentProcess() })?,
        })
    }
    pub fn is_alive(&self) -> Result<bool, String> {
        if self.process_id == 0 || self.created == 0 {
            return Err(ERROR.into());
        }
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                self.process_id,
            )
        };
        if handle.is_null() {
            // Access denial or an unknown query error is not evidence of exit.
            return if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                Ok(false)
            } else {
                Err(ERROR.into())
            };
        }
        let process = Process(handle);
        if creation(process.0)? != self.created {
            return Ok(false);
        }
        match unsafe { WaitForSingleObject(process.0, 0) } {
            WAIT_OBJECT_0 => Ok(false),
            WAIT_TIMEOUT => Ok(true),
            _ => Err(ERROR.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_live_owner_and_distinguishes_reused_pid() {
        let owner = Owner::current().unwrap();
        assert!(owner.is_alive().unwrap());
        assert!(
            !Owner {
                created: owner.created - 1,
                ..owner.clone()
            }
            .is_alive()
            .unwrap()
        );
        assert!(
            Owner {
                process_id: 0,
                created: 0
            }
            .is_alive()
            .is_err()
        );
    }
}
