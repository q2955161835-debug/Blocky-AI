use super::worker::Input;
use serde_json::Value;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub(super) fn run(
    input: &Input,
    timeout_ms: u64,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let mut bytes = serde_json::to_vec(input).map_err(|_| "BLK-RPA-WORKER-001")?;
    bytes.push(b'\n');
    if bytes.len() > 65536 {
        return Err("BLK-RPA-LIMIT-001".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-RPA-CANCELLED".into());
    }
    let exe = std::env::current_exe().map_err(|_| "BLK-RPA-WORKER-001")?;
    let mut command = Command::new(&exe);
    command
        .env_clear()
        .current_dir(exe.parent().ok_or("BLK-RPA-WORKER-001")?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(not(test))]
    command.arg("--blocky-rpa-worker");
    #[cfg(test)]
    command
        .args(["--exact", "rpa::tests::worker_entry", "--nocapture"])
        .env("BLOCKY_RPA_TEST_WORKER", "1");
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000200);
    let mut child = command.spawn().map_err(|_| "BLK-RPA-WORKER-001")?;
    // Worker reads stdin before any UIA call. Only release input after Job attachment.
    let job = match crate::process_job::attach(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("BLK-RPA-WORKER-001".into());
        }
    };
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = child.stdout.take().expect("piped stdout");
    let writer = std::thread::spawn(move || {
        let result = stdin.write_all(&bytes).and_then(|_| stdin.flush());
        for byte in &mut bytes {
            unsafe {
                std::ptr::write_volatile(byte, 0);
            }
        }
        result
    });
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = (&mut stdout).take(65537).read_to_end(&mut bytes);
        (result, bytes)
    });
    let started = Instant::now();
    let mut failure = None;
    let status = loop {
        if cancel.load(Ordering::SeqCst) || started.elapsed() >= Duration::from_millis(timeout_ms) {
            failure = Some(if cancel.load(Ordering::SeqCst) {
                "BLK-RPA-CANCELLED"
            } else {
                "BLK-RPA-TIMEOUT-001"
            });
            let _ = child.kill();
            break child.wait();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
        }
    };
    // Descendants can retain pipes. Settle the entire Job before joining either pipe thread.
    let settled = job.settle();
    let written = writer.join();
    let read = reader.join();
    if !settled {
        return Err("BLK-RPA-SETTLEMENT-001".into());
    }
    if let Some(code) = failure {
        return Err(code.into());
    }
    if !status.is_ok_and(|s| s.success()) || !written.is_ok_and(|r| r.is_ok()) {
        return Err("BLK-RPA-WORKER-001".into());
    }
    let (result, bytes) = read.map_err(|_| "BLK-RPA-WORKER-001")?;
    if result.is_err() || bytes.len() > 65536 {
        return Err("BLK-RPA-LIMIT-001".into());
    }
    let result = crate::strict_json::parse(&bytes).map_err(|_| "BLK-RPA-WORKER-001")?;
    if result["ok"] == true {
        Ok(result["value"].clone())
    } else {
        Err(result["code"]
            .as_str()
            .filter(|c| c.starts_with("BLK-RPA-") && c.len() < 80)
            .unwrap_or("BLK-RPA-WORKER-001")
            .into())
    }
}
