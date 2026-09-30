use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
/// The same deadline covers hashing, process startup, DNS and HTTP.
pub(super) fn run<T>(
    cancel: &AtomicBool,
    timeout_ms: u64,
    action: impl FnOnce(&AtomicBool) -> Result<T, String>,
) -> Result<T, String> {
    struct Stop(Option<mpsc::Sender<()>>);
    impl Drop for Stop {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }
    let interrupted = AtomicBool::new(false);
    let expired = AtomicBool::new(false);
    let (tx, rx) = mpsc::channel();
    let began = Instant::now();
    std::thread::scope(|scope| {
        let interrupted_ref = &interrupted;
        let expired_ref = &expired;
        let watcher = scope.spawn(move || {
            loop {
                if cancel.load(Ordering::SeqCst) {
                    interrupted_ref.store(true, Ordering::SeqCst);
                    break;
                }
                let remaining = Duration::from_millis(timeout_ms).saturating_sub(began.elapsed());
                if remaining.is_zero() {
                    expired_ref.store(true, Ordering::SeqCst);
                    interrupted_ref.store(true, Ordering::SeqCst);
                    break;
                }
                match rx.recv_timeout(remaining.min(Duration::from_millis(20))) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
        });
        let stop = Stop(Some(tx));
        let result = action(&interrupted);
        drop(stop);
        watcher.join().map_err(|_| "BLK-PROVIDER-STATE")?;
        if cancel.load(Ordering::SeqCst) {
            Err("BLK-PROVIDER-CANCELLED".into())
        } else if expired.load(Ordering::SeqCst)
            || began.elapsed() >= Duration::from_millis(timeout_ms)
        {
            Err("BLK-PROVIDER-TIMEOUT".into())
        } else {
            result
        }
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deadline_interrupts_pre_transport_work_and_preserves_user_cancel() {
        let began = Instant::now();
        let result = run(&AtomicBool::new(false), 25, |cancel| {
            while !cancel.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err::<(), _>("BLK-LOCAL-MODEL-CANCELLED".into())
        });
        assert_eq!(result.unwrap_err(), "BLK-PROVIDER-TIMEOUT");
        assert!(began.elapsed() < Duration::from_millis(500));
        assert_eq!(
            run(&AtomicBool::new(true), 100, |_| Ok(())).unwrap_err(),
            "BLK-PROVIDER-CANCELLED"
        );
        assert_eq!(run(&AtomicBool::new(false), 100, |_| Ok(42)).unwrap(), 42);
    }
}
