use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::HANDLE;
/// Terminate a Job and verify both process accounting and captured process handles.
pub(crate) fn settle_job(job: HANDLE, timeout: Duration) -> bool {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{OpenProcess, WaitForSingleObject},
    };
    // Job accounting can reach zero slightly before a terminating process
    // handle becomes signalled. Keep handles to the current tree and wait
    // for both facts, rather than reporting settlement prematurely.
    let mut list = vec![0usize; 4098];
    let queried = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicProcessIdList,
            list.as_mut_ptr() as _,
            (list.len() * std::mem::size_of::<usize>()) as u32,
            std::ptr::null_mut(),
        )
    };
    let mut handles: Vec<OwnedHandle> = Vec::new();
    let mut observed = queried != 0;
    if queried != 0 {
        let count = unsafe { *(list.as_ptr() as *const u32).add(1) } as usize;
        observed &= count <= 4096;
        for index in 0..count.min(4096) {
            let pid =
                unsafe { *((list.as_ptr() as *const u8).add(8) as *const usize).add(index) } as u32;
            let handle = unsafe { OpenProcess(0x00100000, 0, pid) };
            if !handle.is_null() {
                handles.push(unsafe { OwnedHandle::from_raw_handle(handle as _) });
            } else if unsafe { windows_sys::Win32::Foundation::GetLastError() }
                != windows_sys::Win32::Foundation::ERROR_INVALID_PARAMETER
            {
                // A disappeared PID is already settled. Access/other failures
                // cannot be presented as authoritative process-tree proof.
                observed = false;
            }
        }
    }
    unsafe {
        TerminateJobObject(job, 1);
    }
    let start = Instant::now();
    loop {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        };
        if ok != 0
            && info.ActiveProcesses == 0
            && handles
                .iter()
                .all(|h| unsafe { WaitForSingleObject(h.as_raw_handle() as _, 0) } == WAIT_OBJECT_0)
        {
            return observed;
        }
        if start.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(windows)]
pub(crate) struct Job(isize);
#[cfg(windows)]
impl Job {
    pub(crate) fn named(name: &str) -> Result<Self, String> {
        use windows_sys::Win32::{Foundation::*, System::JobObjects::*};
        let mut name: Vec<u16> = name.encode_utf16().collect();
        if name.contains(&0) || name.len() > 128 {
            return Err("BLK-WORKFLOW-INVALID".into());
        }
        name.push(0);
        unsafe {
            SetLastError(0);
            let handle = CreateJobObjectW(std::ptr::null(), name.as_ptr());
            if handle.is_null() {
                return Err("BLK-WORKFLOW-OWNER".into());
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return Err("BLK-WORKFLOW-OWNER".into());
            }
            let job = Job(handle as isize);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                return Err("BLK-WORKFLOW-OWNER".into());
            }
            Ok(job)
        }
    }
    pub(crate) fn assign(&self, process: HANDLE) -> Result<(), String> {
        if unsafe {
            windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(self.0 as _, process)
        } == 0
        {
            Err("BLK-WORKFLOW-OWNER".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn memory_limit(&self, bytes: usize) -> Result<(), String> {
        use windows_sys::Win32::System::JobObjects::*;
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_JOB_MEMORY;
        info.JobMemoryLimit = bytes;
        if bytes < 1024 * 1024
            || unsafe {
                SetInformationJobObject(
                    self.0 as _,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as _,
                    std::mem::size_of_val(&info) as u32,
                )
            } == 0
        {
            return Err("BLK-WORKFLOW-OWNER".into());
        }
        Ok(())
    }
    pub(crate) fn settle(&self) -> bool {
        crate::process_job::settle_job(self.0 as _, Duration::from_secs(2))
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
#[cfg(windows)]
pub(crate) fn attach(child: &std::process::Child) -> Result<Job, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err("BLK-TERM-001".into());
        }
        let job = Job(handle as isize);
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
            return Err("BLK-TERM-001".into());
        }
        Ok(job)
    }
}
