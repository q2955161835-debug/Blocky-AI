use super::*;
use std::time::{Duration, Instant};
struct OpenReview {
    window: HWND,
    thread: Option<std::thread::JoinHandle<Result<bool, String>>>,
}
impl OpenReview {
    fn open(text: String) -> Self {
        let thread = std::thread::spawn(move || show(&text));
        let started = Instant::now();
        let window = loop {
            let window =
                unsafe { FindWindowW(wide("BlockyAttendedConsent").as_ptr(), std::ptr::null()) };
            let mut pid = 0;
            unsafe {
                GetWindowThreadProcessId(window, &mut pid);
            }
            if pid == std::process::id()
                && unsafe { IsWindowVisible(window) } != 0
                && !unsafe { GetDlgItem(window, CANCEL as i32) }.is_null()
            {
                break window;
            }
            assert!(
                started.elapsed() < Duration::from_secs(3),
                "owned native review not visible"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        Self {
            window,
            thread: Some(thread),
        }
    }
    fn finish(mut self) -> bool {
        self.thread.take().unwrap().join().unwrap().unwrap()
    }
}
impl Drop for OpenReview {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            unsafe {
                PostMessageW(self.window, WM_CLOSE, 0, 0);
            }
            let _ = thread.join();
        }
    }
}
#[test]
#[ignore = "opens bounded owned native consent windows; run explicitly"]
fn native_review_retains_long_text_and_only_approves_an_explicit_button() {
    let text = (0..100)
        .map(|n| format!("步骤 {n}：核对自有窗口的测试操作与权限。\n"))
        .collect::<String>();
    let review = OpenReview::open(text.clone());
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(review.window, &mut rect);
        assert!(
            rect.left >= 0 && rect.top >= 0 && rect.right <= 1280,
            "owned native window crossed the reserved half"
        );
        let mut title = [0u16; 128];
        let length = GetWindowTextW(review.window, title.as_mut_ptr(), title.len() as i32) as usize;
        assert_eq!(
            String::from_utf16(&title[..length]).unwrap(),
            "确认有人值守自动化"
        );
        let automation = uiautomation::UIAutomation::new().unwrap();
        let root = automation
            .element_from_handle(uiautomation::types::Handle::from(review.window as isize))
            .unwrap();
        assert_eq!(root.get_name().unwrap(), "确认有人值守自动化");
        let condition = automation.create_true_condition().unwrap();
        let children = root
            .find_all(uiautomation::types::TreeScope::Children, &condition)
            .unwrap();
        let names = children
            .into_iter()
            .map(|element| element.get_name().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(
            names.iter().any(|name| name == "允许本次操作")
                && names.iter().any(|name| name == "取消")
        );
        let edit = GetDlgItem(review.window, 11);
        let length = SendMessageW(edit, WM_GETTEXTLENGTH, 0, 0) as usize;
        let mut buffer = vec![0u16; length + 1];
        let read =
            SendMessageW(edit, WM_GETTEXT, buffer.len(), buffer.as_mut_ptr() as isize) as usize;
        assert_eq!(
            String::from_utf16(&buffer[..read]).unwrap(),
            text.replace('\n', "\r\n")
        );
        assert!(GetWindowLongW(edit, GWL_STYLE) as u32 & ES_READONLY as u32 != 0);
        PostMessageW(review.window, WM_KEYDOWN, 0x0d, 0); // Initial Enter must cancel.
    }
    assert!(!review.finish());
    let review = OpenReview::open("自有测试批准路径，不涉及其他应用。".into());
    unsafe {
        SendMessageW(GetDlgItem(review.window, APPROVE as i32), 0x00f5, 0, 0);
    }
    assert!(review.finish());
    let review = OpenReview::open("自有测试关闭路径。".into());
    unsafe {
        PostMessageW(review.window, WM_CLOSE, 0, 0);
    }
    assert!(!review.finish());
}
