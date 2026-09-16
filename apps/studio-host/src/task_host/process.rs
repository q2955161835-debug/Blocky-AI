use super::{TaskRequest, TaskSnapshot, worker::Input};
use crate::project_store::ProjectFiles;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
#[cfg(windows)]
struct Job(isize);
#[cfg(windows)]
impl Job {
    fn settle(&self) -> bool {
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
fn attach(child: &std::process::Child) -> Result<Job, String> {
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
pub(super) fn launch(
    request: TaskRequest,
    files: ProjectFiles,
    snapshot: Arc<Mutex<TaskSnapshot>>,
    cancel: Arc<AtomicBool>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let exe = std::env::current_exe().map_err(|_| "BLK-TERM-001")?;
    let mut command = Command::new(&exe);
    command.env_clear();
    #[cfg(not(test))]
    command.arg("--blocky-task-worker");
    #[cfg(test)]
    command
        .args(["--exact", "task_host::tests::worker_entry", "--nocapture"])
        .env("BLOCKY_TASK_TEST_WORKER", "1");
    command
        .current_dir(exe.parent().ok_or("BLK-TERM-001")?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000200);
    }
    let mut child = command.spawn().map_err(|_| "BLK-TERM-001")?;
    // The trusted worker blocks on its first input line before dispatch. Attach
    // the Job before releasing that line, so no registered operation can run
    // outside its process tree. No user executable or startup profile runs here.
    #[cfg(windows)]
    let job = match attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut stdin = child.stdin.take().ok_or("BLK-TERM-001")?;
    let mut stdout = child.stdout.take().ok_or("BLK-TERM-001")?;
    let input = serde_json::to_vec(&Input {
        request: request.clone(),
        files,
    })
    .map_err(|_| "BLK-TERM-001")?;
    if stdin
        .write_all(&input)
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("BLK-TERM-001".into());
    }
    let output_snapshot = snapshot.clone();
    let budget = request.output_budget_bytes;
    let reader = std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut total = 0usize;
        let mut buffer = [0u8; 4096];
        loop {
            let Ok(count) = stdout.read(&mut buffer) else {
                break;
            };
            if count == 0 {
                break;
            }
            total = total.saturating_add(count);
            let take = count.min(budget.saturating_sub(kept.len()));
            kept.extend_from_slice(&buffer[..take]);
            let valid = match std::str::from_utf8(&kept) {
                Ok(text) => text.len(),
                Err(error) => error.valid_up_to(),
            };
            if let Ok(mut state) = output_snapshot.lock() {
                state.output = String::from_utf8_lossy(&kept[..valid]).into_owned();
                state.output_bytes = state.output.len();
                state.dropped_bytes = total - state.output_bytes;
                state.truncated = total > budget;
            }
        }
    });
    let worker = std::thread::spawn(move || {
        if let Ok(mut s) = snapshot.lock() {
            s.status = "running".into();
        }
        let start = Instant::now();
        let mut reason = None;
        let mut stop_at = None;
        let mut stdin = Some(stdin);
        let status = loop {
            if reason.is_none()
                && (cancel.load(Ordering::SeqCst)
                    || start.elapsed() >= Duration::from_millis(request.timeout_ms))
            {
                reason = Some(if cancel.load(Ordering::SeqCst) {
                    "cancelled"
                } else {
                    "timed-out"
                });
                if let Some(mut pipe) = stdin.take() {
                    let _ = pipe.write_all(b"cancel\n");
                    let _ = pipe.flush();
                }
                stop_at = Some(
                    Instant::now()
                        + Duration::from_millis(
                            super::definition_for(&request.task_id).expect("validated registered task")["cancellation"]["gracePeriodMs"]
                                .as_u64()
                                .unwrap_or(200),
                        ),
                );
            }
            if stop_at.is_some_and(|until| Instant::now() >= until) {
                let _ = child.kill();
                break child.wait();
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(error);
                }
                Ok(None) => {}
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        // Kill/wait the Job before joining stdout: descendants may still own its
        // write handle even after the registered worker has exited.
        #[cfg(windows)]
        let settled = job.settle();
        #[cfg(not(windows))]
        let settled = true;
        drop(stdin);
        let _ = reader.join();
        if let Ok(mut s) = snapshot.lock() {
            s.exit_code = status.as_ref().ok().and_then(|v| v.code());
            s.status = if !settled {
                "failed"
            } else {
                reason.unwrap_or(if status.is_ok_and(|v| v.success()) {
                    "exited"
                } else {
                    "failed"
                })
            }
            .into();
            s.active_processes = if settled { 0 } else { 1 };
        }
    });
    Ok(worker)
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{io::BufRead, os::windows::process::CommandExt};
    #[test]
    fn job_settles_a_real_descendant_before_output_reader_finishes() {
        let cwd =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage2-tasks");
        std::fs::create_dir_all(&cwd).unwrap();
        let shell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut child = Command::new(shell)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"])
            .current_dir(cwd)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let job = attach(&child).unwrap();
        let mut input = child.stdin.take().unwrap();
        input.write_all(b"$p=Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru; Write-Output $p.Id; Start-Sleep -Seconds 60\n").unwrap();
        input.flush().unwrap();
        let mut output = std::io::BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        output.read_line(&mut line).unwrap();
        let pid: u32 = line.trim().parse().unwrap();
        use windows_sys::Win32::{Foundation::*, System::Threading::*};
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | 0x00100000, 0, pid) };
        assert!(!process.is_null());
        assert_eq!(unsafe { WaitForSingleObject(process, 0) }, WAIT_TIMEOUT);
        assert!(job.settle());
        assert_eq!(unsafe { WaitForSingleObject(process, 0) }, WAIT_OBJECT_0);
        unsafe {
            CloseHandle(process);
        }
        drop(input);
        let mut remaining = String::new();
        output.read_to_string(&mut remaining).unwrap();
        child.wait().unwrap();
    }
}
