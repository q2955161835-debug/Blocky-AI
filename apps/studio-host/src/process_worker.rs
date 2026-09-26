//! Host-internal worker primitive. No executable or argument is accepted from a frontend request.
//! Create suspended, inherit only private pipes, attach the Job, then explicitly resume.
use crate::{process_identity::Identity, process_job::Job};
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::SECURITY_ATTRIBUTES,
    System::{Pipes::CreatePipe, Threading::*},
};
const FAILED: &str = "BLK-WORKFLOW-OWNER";
const INVALID: &str = "BLK-WORKFLOW-INVALID";

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
fn pipe() -> Result<(OwnedHandle, OwnedHandle), String> {
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let (mut read, mut write) = (null_mut(), null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, &mut attributes, 65536) } == 0 {
        return Err(FAILED.into());
    }
    Ok(unsafe {
        (
            OwnedHandle::from_raw_handle(read as _),
            OwnedHandle::from_raw_handle(write as _),
        )
    })
}
fn wide(value: &OsStr) -> Result<Vec<u16>, String> {
    let mut result: Vec<u16> = value.encode_wide().collect();
    if result.contains(&0) {
        return Err(INVALID.into());
    }
    result.push(0);
    Ok(result)
}
fn argument(value: &OsStr) -> Result<Vec<u16>, String> {
    let mut out = vec![b'"' as u16];
    let mut slashes = 0;
    for c in value.encode_wide() {
        if c == 0 {
            return Err(INVALID.into());
        }
        if c == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        out.extend(std::iter::repeat_n(
            b'\\' as u16,
            if c == b'"' as u16 {
                slashes * 2 + 1
            } else {
                slashes
            },
        ));
        slashes = 0;
        out.push(c);
    }
    out.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    out.push(b'"' as u16);
    Ok(out)
}
fn environment() -> Vec<u16> {
    // Preserve only OS/profile locations needed by existing native adapters. Never inherit
    // Node preloads, search paths, credentials, or executable startup configuration.
    let allowed = [
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "LOCALAPPDATA",
        "APPDATA",
        "USERPROFILE",
        "TEMP",
        "TMP",
        "BLOCKY_PROFILE_DIR",
    ];
    let mut values: Vec<_> = std::env::vars_os()
        .filter(|(name, _)| {
            name.to_str()
                .is_some_and(|s| allowed.contains(&s.to_ascii_uppercase().as_str()))
        })
        .collect();
    values.sort_by_key(|(name, _)| name.to_string_lossy().to_uppercase());
    let mut block = Vec::new();
    for (name, value) in values {
        block.extend(name.encode_wide());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    if block.len() == 1 {
        block.push(0);
    }
    block
}

pub(crate) struct Worker {
    process: OwnedHandle,
    thread: OwnedHandle,
    job: Job,
    identity: Identity,
    started: bool,
    stopped: bool,
    input: Option<File>,
    output: Option<File>,
}
impl Worker {
    /// `executable` and `arguments` must come from the Host's pinned runtime launcher.
    pub(crate) fn spawn(
        executable: &Path,
        arguments: &[OsString],
        job_name: &str,
    ) -> Result<Self, String> {
        if !executable.is_absolute()
            || executable
                .extension()
                .and_then(|v| v.to_str())
                .is_none_or(|s| !s.eq_ignore_ascii_case("exe"))
            || arguments.len() > 64
        {
            return Err(INVALID.into());
        }
        let application = wide(executable.as_os_str())?;
        let mut command = argument(executable.as_os_str())?;
        for value in arguments {
            command.push(b' ' as u16);
            command.extend(argument(value)?);
        }
        if command.len() >= 32767 {
            return Err(INVALID.into());
        }
        command.push(0);
        let job = Job::named(job_name)?;
        let (input_read, input_write) = pipe()?;
        let (output_read, output_write) = pipe()?;
        for handle in [&input_write, &output_read] {
            if unsafe { SetHandleInformation(handle.as_raw_handle() as _, HANDLE_FLAG_INHERIT, 0) }
                == 0
            {
                return Err(FAILED.into());
            }
        }
        let inherited = [
            input_read.as_raw_handle() as HANDLE,
            output_write.as_raw_handle() as HANDLE,
        ];
        let mut size = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
        }
        if size == 0 || size > 65536 {
            return Err(FAILED.into());
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
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                inherited.as_ptr() as _,
                std::mem::size_of_val(&inherited),
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(FAILED.into());
        }
        let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        startup.StartupInfo.wShowWindow = 0;
        startup.StartupInfo.hStdInput = inherited[0];
        startup.StartupInfo.hStdOutput = inherited[1];
        startup.StartupInfo.hStdError = inherited[1];
        startup.lpAttributeList = attributes.ptr;
        let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let environment = environment();
        if unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED
                    | CREATE_NO_WINDOW
                    | EXTENDED_STARTUPINFO_PRESENT
                    | CREATE_UNICODE_ENVIRONMENT,
                environment.as_ptr() as _,
                null(),
                &startup.StartupInfo,
                &mut info,
            )
        } == 0
        {
            return Err(FAILED.into());
        }
        let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess as _) };
        let thread = unsafe { OwnedHandle::from_raw_handle(info.hThread as _) };
        let prepared = job
            .assign(info.hProcess)
            .and_then(|_| Identity::from_handle(info.hProcess).map_err(|_| FAILED.to_owned()));
        let identity = match prepared {
            Ok(value) => value,
            Err(code) => {
                unsafe {
                    TerminateProcess(info.hProcess, 1);
                }
                let stopped = unsafe { WaitForSingleObject(info.hProcess, 2000) } == WAIT_OBJECT_0;
                return Err(if stopped {
                    code
                } else {
                    "BLK-WORKFLOW-UNCERTAIN".into()
                });
            }
        };
        Ok(Self {
            process,
            thread,
            job,
            identity,
            started: false,
            stopped: false,
            input: Some(File::from(input_write)),
            output: Some(File::from(output_read)),
        })
    }
    pub(crate) fn identity(&self) -> &Identity {
        &self.identity
    }
    pub(crate) fn is_stopped(&self) -> bool {
        self.stopped
    }
    pub(crate) fn resume(&mut self) -> Result<(), String> {
        if self.started || self.stopped {
            return Err(FAILED.into());
        }
        if unsafe { ResumeThread(self.thread.as_raw_handle() as _) } != 1 {
            return Err(FAILED.into());
        }
        self.started = true;
        Ok(())
    }
    pub(crate) fn input(&mut self) -> Option<&mut File> {
        self.input.as_mut()
    }
    pub(crate) fn take_output(&mut self) -> Option<File> {
        self.output.take()
    }
    pub(crate) fn stop(&mut self) -> Result<(), String> {
        if self.stopped {
            return Ok(());
        }
        self.input.take();
        let tree = self.job.settle();
        let process =
            unsafe { WaitForSingleObject(self.process.as_raw_handle() as _, 500) } == WAIT_OBJECT_0;
        self.stopped = tree && process;
        if self.stopped {
            Ok(())
        } else {
            Err("BLK-WORKFLOW-UNCERTAIN".into())
        }
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
