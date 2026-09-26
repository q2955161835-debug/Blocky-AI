//! Opt-in integration against an owned Win32 fixture, never a user's application.
use super::*;
use std::sync::atomic::AtomicUsize;
use windows_sys::Win32::{Foundation::*, UI::WindowsAndMessaging::*};
static CLICKS: AtomicUsize = AtomicUsize::new(0);
// Standard controls need Common Controls v6 for full UIA event support.
// Activation applies only to the owned fixture thread, never a target application.
struct ControlsContext {
    handle: HANDLE,
    cookie: usize,
    library: HMODULE,
}
impl ControlsContext {
    fn new() -> Self {
        use windows_sys::Win32::{
            System::{ApplicationInstallationAndServicing::*, LibraryLoader::*},
            UI::Controls::*,
        };
        let path = wide(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/uia-controls.manifest"
        ));
        unsafe {
            let context = ACTCTXW {
                cbSize: std::mem::size_of::<ACTCTXW>() as u32,
                lpSource: path.as_ptr(),
                ..Default::default()
            };
            let handle = CreateActCtxW(&context);
            assert_ne!(handle, INVALID_HANDLE_VALUE);
            let mut cookie = 0;
            assert_ne!(ActivateActCtx(handle, &mut cookie), 0);
            // Resolve after activation: the executable's static import may already bind v5.
            let library = LoadLibraryW(wide("comctl32.dll").as_ptr());
            assert!(!library.is_null());
            let init: unsafe extern "system" fn(*const INITCOMMONCONTROLSEX) -> i32 =
                std::mem::transmute(
                    GetProcAddress(library, c"InitCommonControlsEx".as_ptr().cast()).unwrap(),
                );
            assert_ne!(
                init(&INITCOMMONCONTROLSEX {
                    dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
                    dwICC: ICC_STANDARD_CLASSES
                }),
                0
            );
            Self {
                handle,
                cookie,
                library,
            }
        }
    }
}
impl Drop for ControlsContext {
    fn drop(&mut self) {
        use windows_sys::Win32::System::ApplicationInstallationAndServicing::*;
        unsafe {
            FreeLibrary(self.library);
            DeactivateActCtx(0, self.cookie);
            ReleaseActCtx(self.handle);
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
unsafe extern "system" fn procedure(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_COMMAND if wparam & 0xffff == 102 => {
            CLICKS.fetch_add(1, Ordering::SeqCst);
            0
        }
        WM_CLOSE => {
            unsafe {
                DestroyWindow(hwnd);
            }
            0
        }
        WM_DESTROY => {
            unsafe {
                PostQuitMessage(0);
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}
struct Fixture {
    window: usize,
    join: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            PostMessageW(self.window as HWND, WM_CLOSE, 0, 0);
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}
fn fixture() -> Fixture {
    let (send, recv) = std::sync::mpsc::channel();
    let join = std::thread::spawn(move || unsafe {
        let _controls = ControlsContext::new();
        let root = CreateWindowExW(
            0,
            wide("STATIC").as_ptr(),
            wide("Blocky RPA owned test fixture").as_ptr(),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            80,
            80,
            360,
            240,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        assert!(!root.is_null());
        SetWindowLongPtrW(root, GWLP_WNDPROC, procedure as *const () as isize);
        let edit = CreateWindowExW(
            0,
            wide("EDIT").as_ptr(),
            wide("initial").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_BORDER,
            20,
            30,
            250,
            28,
            root,
            101usize as HMENU,
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        let button = CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("Invoke fixture").as_ptr(),
            WS_CHILD | WS_VISIBLE,
            20,
            80,
            180,
            30,
            root,
            102usize as HMENU,
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        let password = CreateWindowExW(
            0,
            wide("EDIT").as_ptr(),
            wide("fixture-only").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_BORDER | 0x20,
            20,
            120,
            150,
            25,
            root,
            103usize as HMENU,
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        let duplicate = CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("Invoke fixture").as_ptr(),
            WS_CHILD | WS_VISIBLE,
            190,
            80,
            130,
            30,
            root,
            104usize as HMENU,
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        assert!(
            !edit.is_null() && !button.is_null() && !password.is_null() && !duplicate.is_null()
        );
        send.send(root as usize).unwrap();
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
    Fixture {
        window: recv.recv_timeout(Duration::from_secs(5)).unwrap(),
        join: Some(join),
    }
}
#[test]
#[ignore = "opens a short-lived owned native fixture; run explicitly"]
fn uia_records_owned_actions_without_typed_content() {
    let fixture = fixture();
    let target = target::inspect(fixture.window).unwrap();
    let options = recording::protocol::Options {
        session_id: "recording-native".into(),
        project_id: "owned-fixture".into(),
        target: protocol::TargetRef {
            kind: "windows".into(),
            identity: target.identity.clone(),
        },
    };
    let mut capture = recording::uia::Capture::start(target.clone(), options).unwrap();
    let mut input = worker::Input {
        target: target.into(),
        root_id: None,
        step: None,
        input: None,
        approval: None,
    };
    let step = protocol::Step {
        step_id: "fill".into(),
        action: Action::Fill,
        locator: Locator::Uia {
            automation_id: Some("101".into()),
            name: None,
            control_type: Some("Edit".into()),
        },
        value: Some(protocol::InputRef {
            kind: "manual-input".into(),
            reference: None,
        }),
        timeout_ms: 1000,
        effect_key: Some("fill".into()),
    };
    input.step = Some(step);
    input.input = Some("NATIVE_PRIVATE_RECORDING_INPUT".into());
    worker::execute(&input).unwrap();
    input.step = Some(protocol::Step {
        step_id: "click".into(),
        action: Action::Click,
        locator: Locator::Uia {
            automation_id: Some("102".into()),
            name: None,
            control_type: Some("Button".into()),
        },
        value: None,
        timeout_ms: 1000,
        effect_key: Some("click".into()),
    });
    input.input = None;
    worker::execute(&input).unwrap();
    let deadline = std::time::Instant::now();
    while capture.status().unwrap()["count"].as_u64().unwrap() < 2
        && deadline.elapsed() < Duration::from_secs(3)
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    let result = capture.stop("stopped").unwrap();
    assert_eq!(
        result["actions"].as_array().unwrap().len(),
        2,
        "expected native fill and invoke metadata: {result}"
    );
    assert_eq!(result["actions"][0]["action"], "fill");
    assert_eq!(result["actions"][1]["action"], "click");
    assert!(
        !result
            .to_string()
            .contains("NATIVE_PRIVATE_RECORDING_INPUT")
    );
    worker::execute(&input).unwrap();
    assert_eq!(capture.stop("stopped").unwrap(), result);
}

#[test]
#[ignore = "opens a short-lived owned native fixture; run explicitly"]
fn uia_reads_fills_invokes_and_rejects_wrong_process_identity() {
    let fixture = fixture();
    let target = target::inspect(fixture.window).unwrap();
    let mut input = worker::Input {
        target: target.into(),
        root_id: None,
        step: None,
        input: None,
        approval: None,
    };
    input.root_id =
        Some(serde_json::from_value(worker::execute(&input).unwrap()["rootId"].clone()).unwrap());
    let mut step = protocol::Step {
        step_id: "edit".into(),
        action: Action::Read,
        locator: Locator::Uia {
            automation_id: Some("101".into()),
            name: None,
            control_type: None,
        },
        value: None,
        timeout_ms: 1000,
        effect_key: None,
    };
    input.step = Some(step.clone());
    assert_eq!(worker::execute(&input).unwrap()["text"], "initial");
    step.action = Action::Fill;
    step.value = Some(protocol::InputRef {
        kind: "manual-input".into(),
        reference: None,
    });
    step.effect_key = Some("fill-once".into());
    input.step = Some(step.clone());
    input.input = Some("changed by owned fixture test".into());
    worker::execute(&input).unwrap();
    step.action = Action::Read;
    step.value = None;
    step.effect_key = None;
    input.step = Some(step.clone());
    input.input = None;
    assert_eq!(
        worker::execute(&input).unwrap()["text"],
        "changed by owned fixture test"
    );
    step.action = Action::Click;
    step.locator = Locator::Uia {
        automation_id: Some("102".into()),
        name: None,
        control_type: None,
    };
    step.effect_key = Some("click-once".into());
    input.step = Some(step.clone());
    let directory = super::tests::journal_directory();
    let host = RpaHost::with_journal(directory.path().to_owned());
    let plan = Plan {
        schema_version: "blocky.rpa/v1".into(),
        plan_id: "owned-native-journal".into(),
        target: protocol::TargetRef {
            kind: "windows".into(),
            identity: input.target.identity().to_owned(),
        },
        steps: vec![step],
    };
    plan.validate().unwrap();
    // Test-owned target only. The separate approval/cancellation integration test
    // covers native dialogs; this test verifies real invocation + durable receipts.
    let grant = host
        .authorize(Prepared {
            plan,
            target: input.target.clone(),
            root_id: input.root_id.clone().unwrap(),
            preview: json!({}),
        })
        .unwrap();
    let token = grant["sessionId"].as_str().unwrap();
    host.step_with(token, "edit", None, |request, _, _| {
        worker::execute(request)
    })
    .unwrap();
    let id = host.status(token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    host.shutdown().unwrap();
    drop(host);
    let receipt = journal::Store::new(directory.path().to_owned())
        .inspect(&id)
        .unwrap();
    assert_eq!(receipt["status"], "completed");
    assert_eq!(receipt["receipts"][0]["status"], "completed");
    assert_eq!(receipt["receipts"][0]["verified"], false);
    let started = std::time::Instant::now();
    while CLICKS.load(Ordering::SeqCst) == 0 && started.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(CLICKS.load(Ordering::SeqCst), 1);
    let check_target = Prepared {
        plan: Plan {
            schema_version: "blocky.rpa/v1".into(),
            plan_id: "owned-state-check".into(),
            target: protocol::TargetRef {
                kind: "windows".into(),
                identity: input.target.identity().to_owned(),
            },
            steps: vec![input.step.clone().unwrap()],
        },
        target: input.target.clone(),
        root_id: input.root_id.clone().unwrap(),
        preview: json!({}),
    };
    let mut recovery = recovery::Request {
        schema_version: "blocky.rpa-recovery/v1".into(),
        checkpoint_id: id,
        revision: 1,
        checks: vec![recovery::Check {
            step_id: "edit".into(),
            locator: Locator::Uia {
                automation_id: Some("101".into()),
                name: None,
                control_type: None,
            },
            expected_text: Some("changed by owned fixture test".into()),
        }],
    };
    recovery::verify_with(
        &recovery,
        &check_target,
        Arc::new(AtomicBool::new(false)),
        |request, _, _| worker::execute(request),
    )
    .unwrap();
    recovery.checks[0].expected_text = Some("state no longer matches".into());
    assert_eq!(
        recovery::verify_with(
            &recovery,
            &check_target,
            Arc::new(AtomicBool::new(false)),
            |request, _, _| worker::execute(request)
        )
        .unwrap_err(),
        "BLK-RPA-RECOVERY-004"
    );
    assert_eq!(
        recovery::verify_with(
            &recovery,
            &check_target,
            Arc::new(AtomicBool::new(true)),
            |_, _, _| panic!("probe after cancellation")
        )
        .unwrap_err(),
        "BLK-RPA-CANCELLED"
    );
    assert_eq!(CLICKS.load(Ordering::SeqCst), 1);
    input.step.as_mut().unwrap().locator = Locator::Uia {
        automation_id: None,
        name: Some("Invoke fixture".into()),
        control_type: None,
    };
    assert_eq!(worker::execute(&input).unwrap_err(), "BLK-RPA-LOCATOR-003");
    input.step.as_mut().unwrap().action = Action::Read;
    input.step.as_mut().unwrap().locator = Locator::Uia {
        automation_id: Some("103".into()),
        name: None,
        control_type: None,
    };
    assert_eq!(
        worker::execute(&input).unwrap_err(),
        "BLK-RPA-SENSITIVE-001"
    );
    if let Binding::Windows(target) = &mut input.target {
        target.identity = "replaced-target".into();
    }
    assert_eq!(worker::execute(&input).unwrap_err(), "BLK-RPA-TARGET-001");
}
#[test]
#[ignore = "opens and cancels an owned confirmation window without clicking it"]
fn native_approval_worker_is_cancelled_without_a_user_decision() {
    let fixture = fixture();
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = cancel.clone();
    let input = worker::Input {
        target: target::inspect(fixture.window).unwrap().into(),
        root_id: None,
        step: None,
        input: None,
        approval: Some("自动取消测试，不需要点击。".into()),
    };
    let timer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        stop.store(true, Ordering::SeqCst);
    });
    let result = process::run(&input, 5000, cancel);
    timer.join().unwrap();
    assert_eq!(result.unwrap_err(), "BLK-RPA-CANCELLED");
}
