//! Cross-process single-use CLI approvals. Only request hashes and bounded metadata persist.
//! Terminal entries are not evicted: capacity failure is safer than making old approvals replayable.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
const DENIED: &str = "BLK-PERM-001";
const IO: &str = "BLK-APPROVAL-IO";
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 32768;
fn acquire(lock:&std::fs::File)->Result<(),String>{
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(5);
    loop {match lock.try_lock(){
        Ok(())=>return Ok(()),
        Err(std::fs::TryLockError::WouldBlock)=>{
            if std::time::Instant::now()>=deadline{return Err("BLK-APPROVAL-BUSY".into());}
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        Err(std::fs::TryLockError::Error(_))=>return Err(IO.into()),
    }}
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    digest: String,
    issued_at: u64,
    expires_at: u64,
    consumed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ledger {
    schema_version: String,
    entries: BTreeMap<String, Entry>,
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_secs())
        .map_err(|_| IO.into())
}
pub fn issue(root: &Path, identity: &str, digest: &str) -> Result<u64, String> {
    transact_at(root, identity, digest, false, None)
}
pub fn consume(root: &Path, identity: &str, digest: &str) -> Result<(), String> {
    transact_at(root, identity, digest, true, None).map(|_| ())
}
#[cfg(test)]
fn transact(root:&Path,identity:&str,digest:&str,consume:bool,time:u64)->Result<u64,String>{transact_at(root,identity,digest,consume,Some(time))}
fn transact_at(
    root: &Path,
    identity: &str,
    digest: &str,
    consume: bool,
    provided_now: Option<u64>,
) -> Result<u64, String> {
    if !valid_hash(digest) || identity.is_empty() || identity.len() > 512 {
        return Err(DENIED.into());
    }
    std::fs::create_dir_all(root).map_err(|_| IO)?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("ledger.lock"))
        .map_err(|_| IO)?;
    // Parallel model branches share this profile ledger. Serialize only this
    // short disk transaction, never the approval prompt or provider request.
    acquire(&lock)?;
    let now=match provided_now{Some(time)=>time,None=>now()?};
    let path = root.join("ledger.json");
    let mut ledger = if path.exists() {
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .map_err(|_| IO)?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        if bytes.len() > MAX_BYTES {
            return Err("BLK-APPROVAL-LIMIT".into());
        }
        let parsed = crate::strict_json::parse(&bytes).map_err(|_| IO)?;
        let ledger: Ledger = serde_json::from_value(parsed).map_err(|_| IO)?;
        if ledger.schema_version != "blocky.approval-ledger/v1"
            || ledger.entries.len() > MAX_ENTRIES
            || ledger.entries.iter().any(|(id, e)| {
                !valid_hash(id)
                    || !valid_hash(&e.digest)
                    || e.issued_at.checked_add(1800) != Some(e.expires_at)
            })
        {
            return Err(IO.into());
        }
        ledger
    } else {
        Ledger {
            schema_version: "blocky.approval-ledger/v1".into(),
            entries: BTreeMap::new(),
        }
    };
    let id = hash(identity);
    let expires = if let Some(entry) = ledger.entries.get_mut(&id) {
        if entry.digest != digest
            || entry.consumed
            || now < entry.issued_at
            || now >= entry.expires_at
        {
            return Err(DENIED.into());
        }
        if consume {
            entry.consumed = true;
        } else {
            return Ok(entry.expires_at);
        }
        entry.expires_at
    } else {
        if consume {
            return Err(DENIED.into());
        }
        if ledger.entries.len() >= MAX_ENTRIES {
            return Err("BLK-APPROVAL-LIMIT".into());
        }
        let expires = now.checked_add(1800).ok_or(IO)?;
        ledger.entries.insert(
            id,
            Entry {
                digest: digest.into(),
                issued_at: now,
                expires_at: expires,
                consumed: false,
            },
        );
        expires
    };
    let bytes = serde_json::to_vec(&ledger).map_err(|_| IO)?;
    if bytes.len() > MAX_BYTES {
        return Err("BLK-APPROVAL-LIMIT".into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(root).map_err(|_| IO)?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| IO)?;
    temp.persist(path).map_err(|_| IO)?;
    Ok(expires)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/stage4/approval-ledger-tests");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root).unwrap()
    }
    #[test]
    fn consumption_expiry_and_identity_binding_survive_reopen() {
        let root = fixture();
        let d = hash("fixture");
        assert!(transact(root.path(), "tool/p/r", &d, true, 100).is_err());
        assert_eq!(
            transact(root.path(), "tool/p/r", &d, false, 100).unwrap(),
            1900
        );
        assert_eq!(
            transact(root.path(), "tool/p/r", &d, false, 101).unwrap(),
            1900
        );
        assert!(transact(root.path(), "tool/p/r", &hash("changed"), true, 101).is_err());
        transact(root.path(), "tool/p/r", &d, true, 102).unwrap();
        assert!(transact(root.path(), "tool/p/r", &d, true, 103).is_err());
        assert!(transact(root.path(), "tool/p/r", &d, false, 103).is_err());
        transact(root.path(), "provider/p/r", &d, false, 100).unwrap();
        assert!(transact(root.path(), "provider/p/r", &d, true, 1900).is_err());
        assert!(transact(root.path(), "provider/p/r", &d, false, 1900).is_err());
    }
    #[test]
    fn corrupt_ledger_fails_closed() {
        let root = fixture();
        std::fs::write(root.path().join("ledger.json"), b"broken").unwrap();
        assert_eq!(issue(root.path(), "tool/p/r", &hash("x")).unwrap_err(), IO);
    }
    #[test]
    fn concurrent_approvals_serialize_without_replaying_consumed_entries(){
        let root=fixture();
        let lock=std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(root.path().join("ledger.lock")).unwrap();
        lock.lock().unwrap();
        let barrier=std::sync::Arc::new(std::sync::Barrier::new(9));
        let children=(0..8).map(|index|{let path=root.path().to_owned();let barrier=barrier.clone();std::thread::spawn(move||{
            let identity=format!("provider/project/request-{index}");let digest=hash(&identity);barrier.wait();
            issue(&path,&identity,&digest).unwrap();consume(&path,&identity,&digest).unwrap();
            assert_eq!(consume(&path,&identity,&digest).unwrap_err(),DENIED);
        })}).collect::<Vec<_>>();
        barrier.wait();std::thread::sleep(std::time::Duration::from_millis(30));lock.unlock().unwrap();
        for child in children{child.join().unwrap();}
    }
}
