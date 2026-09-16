use super::*;
use std::time::{Duration, Instant};
fn cwd() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage2-pty")
}
fn disable_test_history(t: &UserTerminals, id: &str) {
    t.write(id,"Set-PSReadLineOption -HistorySaveStyle SaveNothing; Write-Output ('HISTORY_' + 'DISABLED')\r").unwrap();
    until(t, id, "HISTORY_DISABLED");
}
fn until(t: &UserTerminals, id: &str, needle: &str) -> Snapshot {
    let start = Instant::now();
    loop {
        let s = t.read(id).unwrap();
        if s.output.contains(needle) {
            return s;
        }
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "missing {needle}: {}",
            s.output
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}
#[test]
fn real_conpty_isolation_resize_and_settlement() {
    std::fs::create_dir_all(cwd()).unwrap();
    let t = UserTerminals::default();
    let a = t
        .create(Profile::Cmd, &cwd(), 65536, 24, 100, None)
        .unwrap();
    let b = t
        .create(Profile::PowerShell, &cwd(), 65536, 24, 100, None)
        .unwrap();
    disable_test_history(&t, &b.session_id);
    t.write(&a.session_id, "echo PTY_ALPHA\r").unwrap();
    until(&t, &a.session_id, "PTY_ALPHA");
    t.write(&b.session_id, "Write-Output ('PTY_' + 'BETA')\r")
        .unwrap();
    until(&t, &b.session_id, "PTY_BETA");
    assert!(!t.read(&a.session_id).unwrap().output.contains("PTY_BETA"));
    t.resize(&b.session_id, 35, 120).unwrap();
    t.write(
        &b.session_id,
        "Write-Output ('SIZE_' + [Console]::WindowWidth + '_' + [Console]::WindowHeight)\r",
    )
    .unwrap();
    until(&t, &b.session_id, "SIZE_120_35");
    t.close(&a.session_id).unwrap();
    assert!(!native::process_alive(a.process_id));
    t.settle().unwrap();
    assert!(!native::process_alive(b.process_id));
    assert_eq!(t.active_count(), 0);
}
#[test]
fn bounds_and_overflow() {
    std::fs::create_dir_all(cwd()).unwrap();
    let t = UserTerminals::default();
    assert!(t.create(Profile::Cmd, &cwd(), 1, 24, 80, None).is_err());
    assert!(t.create(Profile::Cmd, &cwd(), 4096, 0, 80, None).is_err());
    let s = t
        .create(Profile::PowerShell, &cwd(), 4096, 24, 80, Some(20000))
        .unwrap();
    disable_test_history(&t, &s.session_id);
    assert!(t.write(&s.session_id, &"a".repeat(16385)).is_err());
    assert!(t.resize(&s.session_id, 24, 1001).is_err());
    t.write(
        &s.session_id,
        "1..500 | ForEach-Object { Write-Output ('x' * 100) }; Write-Output ('OVER_' + 'DONE')\r",
    )
    .unwrap();
    let out = until(&t, &s.session_id, "OVER_DONE");
    assert!(out.output.len() <= 4096);
    assert!(out.dropped_bytes > 0);
    t.settle().unwrap();
}
#[test]
fn utf8_split_and_tail_boundaries() {
    let mut state = Snapshot {
        session_id: "test".into(),
        profile: Profile::Cmd,
        process_id: 0,
        status: "running".into(),
        rows: 24,
        cols: 80,
        output: String::new(),
        output_bytes: 0,
        dropped_bytes: 0,
        revision: 0,
        exit_code: None,
    };
    let mut pending = Vec::new();
    for byte in "你好🙂世界".as_bytes() {
        append(&mut state, &mut pending, &[*byte], 10);
    }
    assert_eq!(state.output, "🙂世界");
    assert!(pending.is_empty());
    assert_eq!(state.dropped_bytes, 6);
}
#[test]
fn descendants_timeout_drop_and_capacity() {
    std::fs::create_dir_all(cwd()).unwrap();
    let t = UserTerminals::default();
    let s = t
        .create(Profile::PowerShell, &cwd(), 65536, 24, 160, None)
        .unwrap();
    disable_test_history(&t, &s.session_id);
    t.write(&s.session_id,"$p=Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru; $p.Id | Set-Content -LiteralPath './terminal-child-pid.txt'; Write-Output ('CHILD_' + 'READY')\r").unwrap();
    until(&t, &s.session_id, "CHILD_READY");
    let child: u32 = std::fs::read_to_string(cwd().join("terminal-child-pid.txt"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(native::process_alive(child));
    t.close(&s.session_id).unwrap();
    assert!(!native::process_alive(child));
    std::fs::remove_file(cwd().join("terminal-child-pid.txt")).unwrap();
    let timed = t
        .create(Profile::Cmd, &cwd(), 4096, 24, 80, Some(100))
        .unwrap();
    let start = Instant::now();
    while t.read(&timed.session_id).unwrap().status == "running" {
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(t.read(&timed.session_id).unwrap().status, "timed-out");
    assert!(!native::process_alive(timed.process_id));
    t.close(&timed.session_id).unwrap();
    let mut pids = Vec::new();
    for _ in 0..8 {
        pids.push(
            t.create(Profile::Cmd, &cwd(), 4096, 24, 80, None)
                .unwrap()
                .process_id,
        );
    }
    assert!(t.create(Profile::Cmd, &cwd(), 4096, 24, 80, None).is_err());
    drop(t);
    for pid in pids {
        assert!(!native::process_alive(pid));
    }
}
#[test]
fn saturated_input_close_and_natural_exit() {
    std::fs::create_dir_all(cwd()).unwrap();
    let t = UserTerminals::default();
    let s = t
        .create(Profile::PowerShell, &cwd(), 4096, 24, 80, None)
        .unwrap();
    disable_test_history(&t, &s.session_id);
    t.write(
        &s.session_id,
        "Write-Output ('SLEEP_' + 'READY'); Start-Sleep -Seconds 60\r",
    )
    .unwrap();
    until(&t, &s.session_id, "SLEEP_READY");
    let data = "x".repeat(16384);
    for _ in 0..50 {
        let _ = t.write(&s.session_id, &data);
    }
    let start = Instant::now();
    t.close(&s.session_id).unwrap();
    assert!(start.elapsed() < Duration::from_secs(10));
    assert!(!native::process_alive(s.process_id));
    let s = t.create(Profile::Cmd, &cwd(), 4096, 24, 80, None).unwrap();
    t.write(&s.session_id, "exit\r").unwrap();
    let start = Instant::now();
    while t.read(&s.session_id).unwrap().status == "running" {
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(t.read(&s.session_id).unwrap().status, "exited");
    assert!(!native::process_alive(s.process_id));
}
