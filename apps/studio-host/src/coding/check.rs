use super::files::{self, Scope};
use serde_json::{Value, json};
use std::{io::Read, process::{Command, Stdio}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};

/** Parse a verified snapshot; never execute repository code or resolve its imports. */
pub(super) fn check(scope: &Scope, path: &str, kind: &str, cancel: &AtomicBool) -> Result<Value, String> {
    if cancel.load(Ordering::SeqCst) { return Err("BLK-CODING-CANCELLED".into()); }
    let snapshot = scope.read(path)?;
    let text = snapshot["text"].as_str().ok_or("BLK-CODING-FILE")?;
    if !["json", "javascript"].contains(&kind) { return Err("BLK-CODING-CHECK".into()); }
    if kind == "json" {
        let parsed = serde_json::from_str::<Value>(text);
        let (ok, line, column) = match parsed { Ok(_) => (crate::strict_json::parse(text.as_bytes()).is_ok(), 0, 0), Err(error) => (false, error.line(), error.column()) };
        return Ok(json!({"ok":ok,"kind":kind,"path":path,"digest":snapshot["digest"],"exitCode":if ok {0}else{1},"code":if ok {"OK"}else{"BLK-CODING-JSON-SYNTAX"},"line":line,"column":column}));
    }
    let (node, _) = super::cli::assets()?;
    let stage = tempfile::tempdir().map_err(|_| "BLK-CODING-CHECK")?;
    let file = stage.path().join("source.mjs");
    std::fs::write(&file, text).map_err(|_| "BLK-CODING-CHECK")?;
    let mut command = Command::new(node);
    command.args(["--check", "source.mjs"]).current_dir(stage.path()).env_clear().stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    if let Some(root) = std::env::var_os("SystemRoot") { command.env("SystemRoot", root); }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000200); }
    let mut child = command.spawn().map_err(|_| "BLK-CODING-CHECK")?;
    #[cfg(windows)]
    let job = match crate::process_job::attach(&child) { Ok(job) => job, Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error); } };
    let mut pipe = child.stderr.take().ok_or("BLK-CODING-CHECK")?;
    let reader = std::thread::spawn(move || { let mut bytes = Vec::new(); let read = pipe.by_ref().take(32769).read_to_end(&mut bytes); (read, bytes) });
    let began = Instant::now();
    let status = loop {
        if cancel.load(Ordering::SeqCst) { break Err("BLK-CODING-CANCELLED"); }
        if began.elapsed() > Duration::from_secs(15) { break Err("BLK-CODING-TIMEOUT"); }
        match child.try_wait() { Ok(Some(status)) => break Ok(status), Ok(None) => std::thread::sleep(Duration::from_millis(20)), Err(_) => break Err("BLK-CODING-CHECK") }
    };
    #[cfg(windows)] let settled = job.settle();
    #[cfg(not(windows))] let settled = status.is_ok() || child.kill().is_ok();
    let waited = child.wait().is_ok();
    let (read, bytes) = reader.join().map_err(|_| "BLK-CODING-CHECK")?;
    if !settled || !waited { return Err("BLK-CODING-SETTLE".into()); }
    let status = status.map_err(str::to_owned)?;
    if read.is_err() || bytes.len() > 32768 { return Err("BLK-CODING-BUDGET".into()); }
    let stderr = String::from_utf8_lossy(&bytes);
    let line = stderr.lines().find_map(|line| line.split_once("source.mjs:").and_then(|(_, line)| line.trim().parse::<u32>().ok())).unwrap_or(0);
    let ok = status.success();
    Ok(json!({"ok":ok,"kind":kind,"path":path,"digest":files::digest(text),"exitCode":status.code().unwrap_or(-1),"code":if ok {"OK"}else{"BLK-CODING-JS-SYNTAX"},"line":line}))
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn json_check_reports_real_result_and_refuses_escapes_and_secrets() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("valid.json"), "{\"a\":1}").unwrap();
        std::fs::write(dir.path().join("bad.json"), "{\"a\":}").unwrap();
        std::fs::write(dir.path().join(".env"), "hidden").unwrap();
        let scope = Scope::new(dir.path()).unwrap(); let cancel = AtomicBool::new(false);
        assert_eq!(check(&scope,"valid.json","json",&cancel).unwrap()["ok"],true);
        assert_eq!(check(&scope,"bad.json","json",&cancel).unwrap()["ok"],false);
        assert!(check(&scope,"../valid.json","json",&cancel).is_err());
        assert!(check(&scope,".env","json",&cancel).is_err());
        assert!(check(&scope,"valid.json","shell",&cancel).is_err());
        cancel.store(true,Ordering::SeqCst); assert!(check(&scope,"valid.json","json",&cancel).is_err());
    }
}
