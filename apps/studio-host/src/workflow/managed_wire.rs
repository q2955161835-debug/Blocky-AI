//! Bounded private pipes. A stalled reader cannot hold the native supervisor indefinitely.
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Write},
    sync::mpsc::{self, Receiver, SyncSender},
    time::Duration,
};
pub(super) const FRAME: usize = 20 * 1024 * 1024;
pub(super) const CHANNEL: &str = "BLK-WORKFLOW-CHANNEL";
pub(super) fn read(input: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let n = Read::by_ref(input)
        .take(FRAME as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| CHANNEL)?;
    if n == 0 {
        return Ok(None);
    }
    let result = if n > FRAME || bytes.last() != Some(&b'\n') {
        Err("BLK-WORKFLOW-LIMIT".into())
    } else {
        crate::strict_json::parse(&bytes)
            .map(Some)
            .map_err(|_| CHANNEL.into())
    };
    crate::secret_store::wipe(&mut bytes);
    result
}
pub(super) fn reader(
    input: impl Read + Send + 'static,
    worker: bool,
    send: SyncSender<(bool, Result<Option<Value>, String>)>,
) {
    std::thread::spawn(move || {
        let mut input = BufReader::new(input);
        let mut count = 0;
        loop {
            count += 1;
            let next = if count > 20000 {
                Err("BLK-WORKFLOW-LIMIT".into())
            } else {
                read(&mut input)
            };
            let terminal = !matches!(next, Ok(Some(_)));
            if send.send((worker, next)).is_err() || terminal {
                break;
            }
        }
    });
}
pub(super) struct Writer {
    send: SyncSender<Vec<u8>>,
    receipts: Receiver<bool>,
}
impl Writer {
    pub(super) fn new(mut output: impl Write + Send + 'static) -> Self {
        let (send, receive) = mpsc::sync_channel::<Vec<u8>>(1);
        let (reply, receipts) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            while let Ok(mut bytes) = receive.recv() {
                let ok = output
                    .write_all(&bytes)
                    .and_then(|_| output.flush())
                    .is_ok();
                crate::secret_store::wipe(&mut bytes);
                if reply.send(ok).is_err() || !ok {
                    break;
                }
            }
        });
        Self { send, receipts }
    }
    pub(super) fn send(&self, value: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|_| CHANNEL)?;
        if bytes.len() >= FRAME {
            crate::secret_store::wipe(&mut bytes);
            return Err("BLK-WORKFLOW-LIMIT".into());
        }
        bytes.push(b'\n');
        self.send.try_send(bytes).map_err(|_| CHANNEL)?;
        if self
            .receipts
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| CHANNEL)?
        {
            Ok(())
        } else {
            Err(CHANNEL.into())
        }
    }
}
