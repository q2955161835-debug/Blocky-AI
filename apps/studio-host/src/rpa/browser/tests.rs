use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

#[test]
fn cancellation_releases_a_pipe_reader_even_while_another_process_could_hold_its_writer() {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    let mut read = std::ptr::null_mut();
    let mut write = std::ptr::null_mut();
    assert_ne!(
        unsafe {
            windows_sys::Win32::System::Pipes::CreatePipe(
                &mut read,
                &mut write,
                std::ptr::null(),
                0,
            )
        },
        0
    );
    let mut file = unsafe { std::fs::File::from_raw_handle(read as _) };
    let _writer = unsafe { OwnedHandle::from_raw_handle(write as _) };
    let (ready, wait) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        ready.send(()).unwrap();
        let mut byte = [0];
        file.read(&mut byte)
    });
    wait.recv().unwrap();
    assert!(process::join_bounded(reader, true).is_some_and(|r| r.is_ok_and(|read| read.is_err())));
}

#[test]
fn runtime_rejects_modified_manifest_before_launch() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/stage7/browser-tests");
    std::fs::create_dir_all(&root).unwrap();
    let temp = tempfile::tempdir_in(root).unwrap();
    std::fs::write(
        temp.path().join("manifest.json"),
        b"{\"schemaVersion\":\"forged\"}",
    )
    .unwrap();
    assert_eq!(
        assets::verify(temp.path()).unwrap_err(),
        "BLK-RPA-RUNTIME-HASH"
    );
}

#[test]
#[ignore = "opens owned browser; run explicitly with locked browser runtime and installed Edge"]
fn real_browser_private_pipe_and_job_cancel() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/stage7/browser-tests");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = stop.clone();
    let server = std::thread::spawn(move || {
        while !server_stop.load(Ordering::SeqCst) {
            if let Ok((mut socket, _)) = listener.accept() {
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut request = Vec::new();
                let mut bytes = [0u8; 1024];
                while request.len() < 4096 && !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    match socket.read(&mut bytes) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => request.extend_from_slice(&bytes[..count]),
                    }
                }
                if !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    continue;
                }
                let body =
                    b"<!doctype html><title>Blocky owned pipe fixture</title><h1>Owned page</h1><button onclick=\"document.querySelector('[role=status]').textContent=Number(document.querySelector('[role=status]').textContent)+1\">Save</button><div role=status aria-label=Count>0</div>";
                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(headers.as_bytes());
                let _ = socket.write_all(body);
            } else {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    });
    let result = std::panic::catch_unwind(|| {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut process = process::start(&root, cancel.clone()).unwrap();
        let page = process
            .request(
                json!({"kind":"open","projectId":"pipe-project","url":url}),
                15000,
                cancel.clone(),
            )
            .unwrap();
        let identity = page["identity"].as_str().unwrap();
        let plan = json!({"schemaVersion":"blocky.rpa/v1","planId":"pipe-plan","target":{"kind":"browser","identity":identity},"steps":[{"stepId":"read","action":"read","locator":{"kind":"browser","role":"heading","name":"Owned page"}},{"stepId":"wait","action":"wait","locator":{"kind":"browser","role":"button","name":"Absent"},"timeoutMs":30000}]});
        let grant = json!({"schemaVersion":"blocky.rpa-grant/v1","sessionId":"pipe-grant","targetIdentity":identity,"actions":["read","wait"],"expiresAt":crate::rpa::now()+60000});
        process.request(json!({"kind":"authorize","identity":identity,"projectId":"pipe-project","plan":plan,"grant":grant}),2000,cancel.clone()).unwrap();
        let read = process
            .request(
                json!({"kind":"perform","identity":identity,"token":"pipe-grant","stepId":"read"}),
                5000,
                cancel.clone(),
            )
            .unwrap();
        assert_eq!(read["text"], "Owned page");
        let signal = cancel.clone();
        let trigger = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            signal.store(true, Ordering::SeqCst);
        });
        assert_eq!(process.request(json!({"kind":"perform","identity":identity,"token":"pipe-grant","stepId":"wait"}),30000,cancel).unwrap_err(),"BLK-RPA-CANCELLED");
        trigger.join().unwrap();
        assert!(process.child_exited());
        assert!(
            process
                .request(
                    json!({"kind":"inspect","identity":identity}),
                    1000,
                    Arc::new(AtomicBool::new(false))
                )
                .is_err()
        );
        process.shutdown().unwrap();
        let mut fresh = process::start(&root, Arc::new(AtomicBool::new(false))).unwrap();
        fresh
            .request(
                json!({"kind":"open","projectId":"pipe-project","url":url}),
                15000,
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        fresh.shutdown().unwrap();
        assert!(fresh.child_exited());
        // Trusted test setup bypasses only the native approval dialog. It exercises
        // the production RpaHost ledger/step/control path against the real browser.
        let journal = tempfile::tempdir_in(&root).unwrap();
        let host = Arc::new(crate::rpa::RpaHost::with_journal(
            journal.path().join("checkpoints"),
        ));
        let start = BrowserStart {
            project_id: "owned-project".into(),
            url: url.clone(),
        };
        let mut plan:crate::rpa::protocol::Plan=serde_json::from_value(json!({"schemaVersion":"blocky.rpa/v1","planId":"owned-browser","target":{"kind":"browser","identity":url.trim_end_matches('/')},"steps":[{"stepId":"click","action":"click","locator":{"kind":"browser","role":"button","name":"Save"},"effectKey":"click-once"},{"stepId":"read","action":"read","locator":{"kind":"browser","role":"status","name":"Count"}},{"stepId":"wait","action":"wait","locator":{"kind":"browser","role":"button","name":"Absent"},"timeoutMs":30000}]})).unwrap();
        let target = start.prepare(&mut plan).unwrap();
        host.browsers
            .open(&target, &url, Arc::new(AtomicBool::new(false)))
            .unwrap();
        let grant = host
            .authorize(crate::rpa::Prepared {
                plan: plan.clone(),
                target: crate::rpa::Binding::Browser(target),
                root_id: vec![],
                coordinate_frame: None,
                preview: json!({}),
            })
            .unwrap();
        let token = grant["sessionId"].as_str().unwrap().to_owned();
        host.step(&token, "click", None).unwrap();
        assert_eq!(host.step(&token, "read", None).unwrap()["text"], "1");
        assert!(host.step(&token, "click", None).is_err());
        let state = host.status(&token).unwrap();
        let store = crate::rpa::journal::Store::new(journal.path().join("checkpoints"));
        let saved = store
            .read_bound(state["checkpointId"].as_str().unwrap(), &plan)
            .unwrap();
        assert_eq!(saved.next, 2);
        assert_eq!(saved.receipts[0].status, "completed");
        assert_eq!(saved.summary()["resumable"], false);
        host.pause(&token).unwrap();
        host.resume(&token).unwrap();
        let waiting = host.clone();
        let waiting_token = token.clone();
        let waiter = std::thread::spawn(move || waiting.step(&waiting_token, "wait", None));
        let started = std::time::Instant::now();
        while host.status(&token).unwrap()["active"] != true {
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(5));
        }
        host.stop(&token).unwrap();
        assert_eq!(waiter.join().unwrap().unwrap_err(), "BLK-RPA-CANCELLED");
        assert_eq!(host.status(&token).unwrap()["status"], "stopped");
        let mut expired_plan = plan.clone();
        expired_plan.target.identity = url.trim_end_matches('/').into();
        let expired_target = start.prepare(&mut expired_plan).unwrap();
        host.browsers
            .open(&expired_target, &url, Arc::new(AtomicBool::new(false)))
            .unwrap();
        let expired = host
            .authorize(crate::rpa::Prepared {
                plan: expired_plan,
                target: crate::rpa::Binding::Browser(expired_target.clone()),
                root_id: vec![],
                coordinate_frame: None,
                preview: json!({}),
            })
            .unwrap();
        let expired_token = expired["sessionId"].as_str().unwrap();
        host.slot(expired_token)
            .unwrap()
            .state
            .lock()
            .unwrap()
            .expires = 0;
        host.retire_expired().unwrap();
        assert!(host.slot(expired_token).is_err());
        assert!(host.browsers.verify(&expired_target).is_err());
        host.shutdown().unwrap();
    });
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}
