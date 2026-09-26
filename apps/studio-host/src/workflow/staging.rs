//! Recover only this writer's bounded encrypted staging files after confirmed process exit.
use super::protocol::{LIMIT, require};
use crate::process_identity::Identity;
use std::{os::windows::fs::MetadataExt, path::Path};
const IO: &str = "BLK-WORKFLOW-STORE";
const OWNER: &str = "BLK-WORKFLOW-OWNER";
pub(super) fn create(root: &Path) -> Result<tempfile::NamedTempFile, String> {
    let owner = Identity::current().map_err(|_| OWNER)?;
    tempfile::Builder::new()
        .prefix(&format!(
            ".workflow-{}-{}-{}-",
            owner.process_id,
            owner.created,
            uuid::Uuid::new_v4()
        ))
        .rand_bytes(6)
        .suffix(".tmp")
        .tempfile_in(root)
        .map_err(|_| IO.into())
}
fn identity(name: &str) -> Result<Identity, String> {
    let name = name
        .strip_prefix(".workflow-")
        .and_then(|s| s.strip_suffix(".tmp"))
        .ok_or(IO)?;
    let mut parts = name.splitn(3, '-');
    let pid = parts.next().ok_or(IO)?;
    let created = parts.next().ok_or(IO)?;
    let suffix = parts.next().ok_or(IO)?;
    let process_id = pid.parse::<u32>().map_err(|_| IO)?;
    let created_time = created.parse::<u64>().map_err(|_| IO)?;
    require(
        process_id != 0
            && created_time != 0
            && pid == process_id.to_string()
            && created == created_time.to_string(),
        IO,
    )?;
    require(suffix.is_ascii() && suffix.len() == 43, IO)?;
    let uuid = uuid::Uuid::parse_str(&suffix[..36]).map_err(|_| IO)?;
    require(
        uuid.to_string() == suffix[..36]
            && suffix.as_bytes()[36] == b'-'
            && suffix[37..].bytes().all(|b| b.is_ascii_alphanumeric()),
        IO,
    )?;
    Ok(Identity {
        process_id,
        created: created_time,
    })
}
/// Caller holds the global workflow file lock; no writer can concurrently create a stage.
pub(super) fn sweep(root: &Path, max_file: usize) -> Result<(), String> {
    let mut stale = vec![];
    for (index, entry) in std::fs::read_dir(root).map_err(|_| IO)?.enumerate() {
        require(index < 128 * 2 + 33, LIMIT)?;
        let entry = entry.map_err(|_| IO)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or(IO)?;
        if !name.starts_with(".workflow-") {
            continue;
        }
        require(stale.len() < 32, LIMIT)?;
        let owner = identity(name)?;
        let meta = std::fs::symlink_metadata(entry.path()).map_err(|_| IO)?;
        require(
            meta.is_file() && meta.file_attributes() & 0x400 == 0 && meta.len() <= max_file as u64,
            IO,
        )?;
        require(!owner.is_alive().map_err(|_| OWNER)?, OWNER)?;
        stale.push(entry.path());
    }
    // Validate the whole bounded set before deleting anything. Never promote a staged
    // completion into a receipt: the committed intent remains authoritative and uncertain.
    for path in stale {
        std::fs::remove_file(path).map_err(|_| IO)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workflow_host_staging_identity_is_canonical_and_does_not_infer_death() {
        let owner = Identity::current().unwrap();
        let name = format!(
            ".workflow-{}-{}-{}-aB1234.tmp",
            owner.process_id,
            owner.created,
            uuid::Uuid::new_v4()
        );
        assert_eq!(identity(&name).unwrap(), owner);
        for invalid in [
            ".workflow-orphan",
            ".workflow-0-1-unknown.tmp",
            ".workflow-1-0-unknown.tmp",
            ".workflow-1-1-中文字符.tmp",
        ] {
            assert!(identity(invalid).is_err());
        }
    }
}
