//! One native coding task; a second frame or EOF cooperatively revokes it.
//! Reply only after Host children and every atomic file publication have settled.
use serde_json::json;
use std::{
    io::{BufRead, Read, Write},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
pub fn session_main() -> i32 {
    let result = (|| {
        let mut bytes = Vec::new();
        std::io::stdin()
            .lock()
            .take(16 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut bytes)
            .map_err(|_| "BLK-CODING-INPUT")?;
        if bytes.len() > 16 * 1024 * 1024 || !bytes.ends_with(b"\n") {
            return Err("BLK-CODING-INPUT".to_owned());
        }
        let value = crate::strict_json::parse(&bytes)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let watching = cancel.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::stdin()
                .lock()
                .take(1025)
                .read_until(b'\n', &mut bytes);
            watching.store(true, Ordering::SeqCst);
        });
        super::dispatch_cancellable(crate::profile::cli_root()?, &value, &cancel)
    })();
    let reply = native_reply(result);
    if writeln!(std::io::stdout(), "{reply}")
        .and_then(|_| std::io::stdout().flush())
        .is_err()
    {
        return 3;
    }
    if reply["ok"] == true { 0 } else { 3 }
}

/// Both helper entry points use the same non-success envelope and retain the
/// bound authoritative receipt even when the task has failed.
pub fn native_reply(result: Result<serde_json::Value, String>) -> serde_json::Value {
    match result {
        Ok(value) if value["schemaVersion"] == "blocky.coding-failure/v1" => {
            json!({"schemaVersion":"blocky.project-io/v1alpha1","ok":false,"code":value["code"],"value":value})
        }
        Ok(value) => json!({"schemaVersion":"blocky.project-io/v1alpha1","ok":true,"value":value}),
        Err(code) => json!({"schemaVersion":"blocky.project-io/v1alpha1","ok":false,"code":code}),
    }
}
