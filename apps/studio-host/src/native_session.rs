//! One bounded operation per CLI process. EOF and any additional frame revoke
//! the operation; the process replies only after the operation settles.
use serde_json::{json, Value};
use std::{
    io::{BufRead, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
pub(crate) fn run(
    max_bytes: u64,
    invalid: &str,
    operation: impl FnOnce(Value, &AtomicBool) -> Result<Value, String>,
) -> i32 {
    let result = (|| {
        let mut bytes = Vec::new();
        std::io::stdin()
            .lock()
            .take(max_bytes + 1)
            .read_until(b'\n', &mut bytes)
            .map_err(|_| invalid)?;
        if bytes.len() as u64 > max_bytes || !bytes.ends_with(b"\n") {
            return Err(invalid.into());
        }
        let value = crate::strict_json::parse(&bytes).map_err(|_| invalid)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let reader_cancel = cancel.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::stdin()
                .lock()
                .take(1025)
                .read_until(b'\n', &mut bytes);
            reader_cancel.store(true, Ordering::SeqCst);
        });
        operation(value, &cancel)
    })();
    let ok = result.is_ok();
    let reply = match result {
        Ok(value) => json!({"schemaVersion":"blocky.project-io/v1alpha1","ok":true,"value":value}),
        Err(code) => json!({"schemaVersion":"blocky.project-io/v1alpha1","ok":false,"code":code}),
    };
    let _ = writeln!(std::io::stdout(), "{reply}");
    if ok {
        0
    } else {
        3
    }
}
