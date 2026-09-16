// Microsoft ConPTY lifetime/pipe guidance:
// https://learn.microsoft.com/windows/console/creating-a-pseudoconsole-session
// Null standard handles prevent inherited redirected handles bypassing ConPTY:
// https://github.com/microsoft/terminal/discussions/15814
use super::*;
use std::{
    fs::File,
    io::{Read, Write},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    ptr::{null, null_mut},
    sync::mpsc,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    System::{Console::*, IO::CancelSynchronousIo, JobObjects::*, Pipes::CreatePipe, Threading::*},
};
struct Handle(isize);
impl Handle {
    fn raw(&self) -> HANDLE {
        self.0 as HANDLE
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.raw());
        }
    }
}
struct Console(Option<isize>);
impl Drop for Console {
    fn drop(&mut self) {
        if let Some(pc) = self.0.take() {
            unsafe {
                ClosePseudoConsole(pc);
            }
        }
    }
}
struct Attributes {
    _storage: Vec<usize>,
    ptr: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.ptr);
        }
    }
}
fn wide(s: &std::ffi::OsStr) -> Result<Vec<u16>, String> {
    let mut w: Vec<u16> = s.encode_wide().collect();
    if w.contains(&0) {
        return Err(INVALID.into());
    }
    w.push(0);
    Ok(w)
}
fn pipe() -> Result<(Handle, Handle), String> {
    unsafe {
        let (mut r, mut w) = (null_mut(), null_mut());
        if CreatePipe(&mut r, &mut w, null(), 0) == 0 {
            return Err(FAILED.into());
        }
        Ok((Handle(r as isize), Handle(w as isize)))
    }
}
pub(super) fn resize(pc: isize, rows: u16, cols: u16) -> Result<(), String> {
    unsafe {
        if ResizePseudoConsole(
            pc,
            COORD {
                X: cols as i16,
                Y: rows as i16,
            },
        ) < 0
        {
            Err(FAILED.into())
        } else {
            Ok(())
        }
    }
}
pub(super) fn launch(
    profile: Profile,
    cwd: &Path,
    budget: usize,
    rows: u16,
    cols: u16,
    timeout: Option<u64>,
    state: Arc<Mutex<Snapshot>>,
) -> Result<Session, String> {
    // Resolve OS shells from the native system directory, never PATH or project content.
    let mut system = [0u16; 32768];
    let n = unsafe {
        windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
            system.as_mut_ptr(),
            system.len() as u32,
        )
    } as usize;
    if n == 0 || n >= system.len() {
        return Err(FAILED.into());
    }
    let system = std::path::PathBuf::from(String::from_utf16_lossy(&system[..n]));
    let (exe, args) = match profile {
        Profile::Cmd => (system.join("cmd.exe"), " /D /Q"),
        Profile::PowerShell => (
            system.join("WindowsPowerShell/v1.0/powershell.exe"),
            " -NoLogo -NoProfile -NoExit",
        ),
    };
    let application = wide(exe.as_os_str())?;
    let mut command = wide(std::ffi::OsStr::new(&format!(
        "\"{}\"{}",
        exe.display(),
        args
    )))?;
    let directory = wide(cwd.as_os_str())?;
    let (input_read, input_write) = pipe()?;
    let (output_read, output_write) = pipe()?;
    let mut pc = 0;
    if unsafe {
        CreatePseudoConsole(
            COORD {
                X: cols as i16,
                Y: rows as i16,
            },
            input_read.raw(),
            output_write.raw(),
            0,
            &mut pc,
        )
    } < 0
    {
        return Err(FAILED.into());
    }
    let mut console_guard = Console(Some(pc));
    let job = unsafe { CreateJobObjectW(null(), null()) };
    if job.is_null() {
        return Err(FAILED.into());
    }
    let job = Handle(job as isize);
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job.raw(),
            JobObjectExtendedLimitInformation,
            &limits as *const _ as _,
            std::mem::size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(FAILED.into());
    }
    let mut size = 0;
    unsafe {
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
    }
    let mut storage = vec![0usize; size.div_ceil(std::mem::size_of::<usize>())];
    let ptr = storage.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    if unsafe { InitializeProcThreadAttributeList(ptr, 1, 0, &mut size) } == 0 {
        return Err(FAILED.into());
    }
    let attributes = Attributes {
        _storage: storage,
        ptr,
    };
    if unsafe {
        UpdateProcThreadAttribute(
            attributes.ptr,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
            pc as _,
            std::mem::size_of_val(&pc),
            null_mut(),
            null(),
        )
    } == 0
    {
        return Err(FAILED.into());
    }
    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.lpAttributeList = attributes.ptr;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            null(),
            directory.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        )
    } == 0
    {
        return Err(FAILED.into());
    }
    let shell = Handle(process.hProcess as isize);
    let thread = Handle(process.hThread as isize);
    if unsafe { AssignProcessToJobObject(job.raw(), shell.raw()) } == 0 {
        unsafe {
            TerminateProcess(shell.raw(), 1);
            WaitForSingleObject(shell.raw(), 5000);
        }
        return Err(FAILED.into());
    }
    // Output must drain before ResumeThread and while ClosePseudoConsole waits.
    drop(input_read);
    drop(output_write);
    let mut output = unsafe { File::from_raw_handle(output_read.raw()) };
    std::mem::forget(output_read);
    let mut input = unsafe { File::from_raw_handle(input_write.raw()) };
    std::mem::forget(input_write);
    let stop = Arc::new(AtomicBool::new(false));
    let reader_state = state.clone();
    let reader = std::thread::spawn(move || {
        let mut b = [0u8; 8192];
        let mut pending = Vec::new();
        while let Ok(n) = output.read(&mut b) {
            if n == 0 {
                break;
            }
            if let Ok(mut s) = reader_state.lock() {
                append(&mut s, &mut pending, &b[..n], budget);
            }
        }
    });
    let (tx, rx) = mpsc::sync_channel::<String>(16);
    let writer_stop = stop.clone();
    let writer = std::thread::spawn(move || {
        while !writer_stop.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(s) => {
                    if writer_stop.load(Ordering::SeqCst) || input.write_all(s.as_bytes()).is_err()
                    {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
    });
    let resume = unsafe { ResumeThread(thread.raw()) };
    if let Ok(mut s) = state.lock() {
        s.process_id = process.dwProcessId;
        s.status = if resume == u32::MAX {
            "failed"
        } else {
            "running"
        }
        .into();
    }
    if resume == u32::MAX {
        stop.store(true, Ordering::SeqCst);
    }
    let console = Arc::new(Mutex::new(console_guard.0.take()));
    let monitor_console = console.clone();
    let monitor_stop = stop.clone();
    let monitor_state = state.clone();
    let worker = std::thread::spawn(move || {
        let start = Instant::now();
        let mut timed_out = false;
        loop {
            if monitor_stop.load(Ordering::SeqCst)
                || unsafe { WaitForSingleObject(shell.raw(), 20) } != WAIT_TIMEOUT
            {
                break;
            }
            if timeout.is_some_and(|t| start.elapsed() >= Duration::from_millis(t)) {
                timed_out = true;
                break;
            }
        }
        monitor_stop.store(true, Ordering::SeqCst);
        let settled = crate::process_job::settle_job(job.raw(), Duration::from_secs(2));
        // Cancel a writer blocked on a full pipe. Repeat to cover the check/write race.
        while !writer.is_finished() {
            unsafe {
                CancelSynchronousIo(writer.as_raw_handle() as _);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let _ = writer.join();
        if let Ok(mut c) = monitor_console.lock() {
            if let Some(pc) = c.take() {
                unsafe {
                    ClosePseudoConsole(pc);
                }
            }
        }
        let _ = reader.join();
        let mut code = 0;
        unsafe {
            GetExitCodeProcess(shell.raw(), &mut code);
        }
        if let Ok(mut s) = monitor_state.lock() {
            s.status = if !settled || resume == u32::MAX {
                "failed"
            } else if timed_out {
                "timed-out"
            } else {
                "exited"
            }
            .into();
            s.exit_code = Some(code);
            s.revision += 1;
        }
    });
    let session = Session {
        state,
        stop,
        input: tx,
        console,
        worker: Some(worker),
    };
    if resume == u32::MAX {
        drop(session);
        Err(FAILED.into())
    } else {
        Ok(session)
    }
}
#[cfg(test)]
pub(super) fn process_alive(pid: u32) -> bool {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | 0x00100000, 0, pid);
        if h.is_null() {
            return false;
        }
        let h = Handle(h as isize);
        WaitForSingleObject(h.raw(), 0) == WAIT_TIMEOUT
    }
}
