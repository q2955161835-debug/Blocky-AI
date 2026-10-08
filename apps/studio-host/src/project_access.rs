//! One editable work per process. Leases also protect project-scoped chat/recovery.
use crate::project_store::ProjectFiles;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::{File, OpenOptions}, path::{Path, PathBuf}, sync::Arc};
struct Entry {
    path: PathBuf,
    revision: String,
    leases: Vec<(String, Arc<File>)>,
}
pub struct ProjectAccess { root: PathBuf, entries: HashMap<String, Entry> }
impl ProjectAccess {
    pub fn new(root: PathBuf) -> Self { Self {root, entries: HashMap::new()} }
    fn lease(&self, key: String) -> Result<(String, Arc<File>), String> {
        if let Some(file) = self.entries.values().flat_map(|v| &v.leases)
            .find(|(id, _)| *id == key).map(|(_, file)| file.clone()) { return Ok((key, file)); }
        std::fs::create_dir_all(&self.root).map_err(|_| "BLK-HOST-001")?;
        let name = format!("{:x}.lock", Sha256::digest(key.as_bytes()));
        let file = OpenOptions::new().create(true).truncate(false).read(true).write(true)
            .open(self.root.join(name)).map_err(|_| "BLK-HOST-001")?;
        file.try_lock().map_err(|_| "BLK-PROJECT-OPEN: 该作品已在另一个窗口中打开。")?;
        Ok((key, Arc::new(file)))
    }
    pub fn open(&mut self, path: PathBuf) -> Result<(String, ProjectFiles), String> {
        if self.entries.len() >= 32 { return Err("BLK-HOST-001".into()); }
        let path = resolved(&path)?;
        let file = self.lease(path_key(&path))?;
        let revision = revision(&path)?;
        let files = crate::project_store::read_archive(&path)?;
        let project = self.lease(project_key(&files)?)?;
        if revision != self::revision(&path)? { return Err(changed()); }
        let handle = format!("project-{}", uuid::Uuid::new_v4());
        self.entries.insert(handle.clone(), Entry {path, revision, leases: vec![file, project]});
        Ok((handle, files))
    }
    pub fn save(&mut self, files: &ProjectFiles, handle: Option<&str>, path: Option<PathBuf>) -> Result<(String, String), String> {
        crate::project_store::validate_files(files)?;
        let (path, handle) = match handle {
            Some(handle) => (self.entries.get(handle).ok_or("BLK-PERM-001")?.path.clone(), handle.to_owned()),
            None => (resolved(&path.ok_or("BLK-PERM-001")?)?, format!("project-{}", uuid::Uuid::new_v4())),
        };
        let key = path_key(&path);
        let file = self.lease(key.clone())?;
        let project = self.lease(project_key(files)?)?;
        // Also check Save As to the current path; it must not bypass conflict detection.
        let expected = self.entries.values().find(|entry| path_key(&entry.path) == key).map(|entry| entry.revision.clone());
        crate::project_store::save_with_check(&path, files, || {
            if let Some(expected) = expected {
                if revision(&path).ok().as_ref() != Some(&expected) { return Err(changed()); }
            }
            Ok(())
        })?;
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        self.entries.insert(handle.clone(), Entry {revision: revision(&path)?, path, leases: vec![file, project]});
        Ok((handle, name))
    }
    pub fn release(&mut self, handle: &str) { self.entries.remove(handle); }
}
fn changed() -> String { "BLK-PROJECT-CHANGED: 文件已被外部修改，请重新打开或另存为新文件。".into() }
fn revision(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path).map_err(|_| "BLK-HOST-001")?.len();
    if size > 16 * 1024 * 1024 { return Err("BLK-REF-001".into()); }
    Ok(format!("{:x}", Sha256::digest(std::fs::read(path).map_err(|_| "BLK-HOST-001")?)))
}
fn resolved(path: &Path) -> Result<PathBuf, String> {
    if path.exists() { return std::fs::canonicalize(path).map_err(|_| "BLK-HOST-001".into()); }
    let parent = std::fs::canonicalize(path.parent().ok_or("BLK-HOST-001")?).map_err(|_| "BLK-HOST-001")?;
    Ok(parent.join(path.file_name().ok_or("BLK-HOST-001")?))
}
fn path_key(path: &Path) -> String { format!("path:{}", path.to_string_lossy().to_lowercase()) }
fn project_key(files: &ProjectFiles) -> Result<String, String> {
    let manifest = crate::strict_json::parse(files.get("project.json").ok_or("BLK-REF-001")?.as_bytes())?;
    Ok(format!("project:{}", manifest["projectId"].as_str().ok_or("BLK-REF-001")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(id: &str) -> ProjectFiles {
        // Existing public valid archive fixture; only the stable project identity varies.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../作品/刑法条文问答/刑法条文问答.blocky");
        let mut files = crate::project_store::read_archive(&path).unwrap();
        let mut manifest: serde_json::Value = serde_json::from_str(&files["project.json"]).unwrap();
        manifest["projectId"] = id.into();
        files.insert("project.json".into(), serde_json::to_string(&manifest).unwrap());
        files
    }
    #[test]
    fn windows_edit_distinct_files_and_reject_same_file_or_project_identity() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/multi-window-tests");
        std::fs::create_dir_all(&base).unwrap();
        let dir = tempfile::tempdir_in(base).unwrap();
        let a = dir.path().join("a.blocky"); let b = dir.path().join("b.blocky"); let copy = dir.path().join("copy.blocky");
        crate::project_store::save_archive(&a, &fixture("window-a")).unwrap();
        crate::project_store::save_archive(&b, &fixture("window-b")).unwrap();
        std::fs::copy(&a, &copy).unwrap();
        let mut first = ProjectAccess::new(dir.path().join("leases"));
        let mut second = ProjectAccess::new(dir.path().join("leases"));
        let (id_a, files_a) = first.open(a.clone()).unwrap();
        assert!(second.open(a.clone()).unwrap_err().contains("BLK-PROJECT-OPEN"));
        assert!(second.open(copy).unwrap_err().contains("BLK-PROJECT-OPEN"));
        let (id_b, files_b) = second.open(b.clone()).unwrap();
        first.save(&files_a, Some(&id_a), None).unwrap();
        second.save(&files_b, Some(&id_b), None).unwrap();
        assert!(second.save(&files_b, None, Some(a.clone())).unwrap_err().contains("BLK-PROJECT-OPEN"));
        assert_eq!(crate::project_store::read_archive(&a).unwrap(), files_a);
        first.release(&id_a);
        second.open(a.clone()).unwrap();
        drop(second);
        ProjectAccess::new(dir.path().join("leases")).open(a).unwrap();
    }
    #[test]
    fn external_edits_are_not_overwritten_and_a_failed_open_keeps_the_current_lease() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/multi-window-tests");
        std::fs::create_dir_all(&base).unwrap();
        let dir = tempfile::tempdir_in(base).unwrap();
        let a = dir.path().join("a.blocky");
        let files = fixture("version-check");
        crate::project_store::save_archive(&a, &files).unwrap();
        let mut access = ProjectAccess::new(dir.path().join("leases"));
        let (handle, opened) = access.open(a.clone()).unwrap();
        assert!(access.open(dir.path().join("missing.blocky")).is_err());
        let mut changed = files.clone();
        let mut manifest: serde_json::Value = serde_json::from_str(&changed["project.json"]).unwrap();
        manifest["displayName"] = "外部修改".into();
        changed.insert("project.json".into(), serde_json::to_string(&manifest).unwrap());
        crate::project_store::save_archive(&a, &changed).unwrap();
        assert!(access.save(&opened, Some(&handle), None).unwrap_err().contains("BLK-PROJECT-CHANGED"));
        assert_eq!(crate::project_store::read_archive(&a).unwrap(), changed);
    }
}
