//! OS-owned lease: only one process in an executable/profile group owns the tray.
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    path::Path,
};
pub struct TrayOwner {
    _lease: File,
}
impl TrayOwner {
    pub fn claim(root: &Path, group: &str) -> Result<Option<Self>, String> {
        let path = root.join("window");
        std::fs::create_dir_all(&path).map_err(|_| "BLK-WINDOW-001")?;
        let name = format!(
            "tray-{:x}.lock",
            Sha256::digest(group.to_lowercase().as_bytes())
        );
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.join(name))
            .map_err(|_| "BLK-WINDOW-001")?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self { _lease: file })),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(_) => Err("BLK-WINDOW-001".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_tray_per_profile_group_and_followers_take_over_after_exit() {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/shared-tray/tests");
        std::fs::create_dir_all(&parent).unwrap();
        let temp = tempfile::tempdir_in(parent).unwrap();
        let first = TrayOwner::claim(temp.path(), "build-A-desktop")
            .unwrap()
            .unwrap();
        assert!(TrayOwner::claim(temp.path(), "BUILD-a-DESKTOP")
            .unwrap()
            .is_none());
        assert!(TrayOwner::claim(temp.path(), "build-B-desktop")
            .unwrap()
            .is_some());
        let other = tempfile::tempdir_in(temp.path()).unwrap();
        assert!(TrayOwner::claim(other.path(), "build-A-desktop")
            .unwrap()
            .is_some());
        drop(first);
        let next = TrayOwner::claim(temp.path(), "build-A-desktop")
            .unwrap()
            .unwrap();
        assert!(TrayOwner::claim(temp.path(), "build-A-desktop")
            .unwrap()
            .is_none());
        drop(next);
    }
}
