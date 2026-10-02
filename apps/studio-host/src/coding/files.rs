use serde_json::{Value, json};
use sha2::{Digest, Sha256};
#[cfg(not(windows))]
use std::fs::OpenOptions;
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
#[cfg(windows)]
mod windows;
const ERROR: &str = "BLK-CODING-FILE";
pub(super) const LIMIT: usize = 1024 * 1024;
pub(super) fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub(super) fn permitted(path: &str) -> bool {
    if path.len() > 512 || !crate::project_store::reference(path) {
        return false;
    }
    path.split('/').all(|part| {
        let p = part.to_ascii_lowercase();
        ![
            ".git",
            ".ssh",
            ".aws",
            ".azure",
            ".config",
            "node_modules",
            "target",
            "dist",
            "secrets",
            "credentials",
            "id_rsa",
            "id_ed25519",
            ".npmrc",
            ".netrc",
            ".pypirc",
            ".git-credentials",
            ".docker",
            ".kube",
            ".gnupg",
            ".bash_history",
            ".zsh_history",
            "credentials.json",
            "secrets.json",
        ]
        .contains(&p.as_str())
            && !p.starts_with(".blocky-coding-")
            && !p.starts_with(".env")
            && !p.ends_with(".blocky")
            && ![".pem", ".key", ".pfx", ".p12", ".keystore"]
                .iter()
                .any(|s| p.ends_with(s))
    })
}
fn metadata_safe(m: &std::fs::Metadata) -> bool {
    if m.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if m.is_file() && m.nlink() != 1 {
            return false;
        }
    }
    m.is_file() || m.is_dir()
}
#[cfg(not(windows))]
fn options(_directory: bool, write: bool) -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true).write(write);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(0x20000);
    }
    o
}
fn verify(file: &File, directory: bool) -> Result<(), String> {
    let m = file.metadata().map_err(|_| ERROR)?;
    if !metadata_safe(&m) || m.is_dir() != directory {
        return Err(ERROR.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0
            || (!directory && info.nNumberOfLinks != 1)
        {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
/// Ancestor handles prohibit deletion/replacement. Windows child operations are
/// anchored to those handles, so an in-place reparse change cannot redirect access.
pub(super) struct Scope {
    pub root: PathBuf,
    _root: File,
    #[cfg(test)]
    publish_failure: std::sync::atomic::AtomicU8,
}
impl Scope {
    pub fn new(path: &Path) -> Result<Self, String> {
        #[cfg(not(windows))]
        let original = std::fs::symlink_metadata(path).map_err(|_| ERROR)?;
        #[cfg(not(windows))]
        if !metadata_safe(&original) || !original.is_dir() {
            return Err(ERROR.into());
        }
        // Open the exact selected directory without following its final component.
        // The handle stays locked for the grant lifetime; derive its path from the
        // handle rather than resolving a path that could have changed meanwhile.
        #[cfg(windows)]
        let file = windows::root(path).map_err(|_| ERROR)?;
        #[cfg(not(windows))]
        let file = options(true, false).open(path).map_err(|_| ERROR)?;
        verify(&file, true)?;
        #[cfg(windows)]
        let root = {
            use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
            use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
            let mut buffer = vec![0u16; 32768];
            let size = unsafe {
                GetFinalPathNameByHandleW(
                    file.as_raw_handle() as _,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    0,
                )
            };
            if size == 0 || size as usize >= buffer.len() {
                return Err(ERROR.into());
            }
            PathBuf::from(std::ffi::OsString::from_wide(&buffer[..size as usize]))
        };
        #[cfg(not(windows))]
        let root = {
            use std::os::unix::fs::MetadataExt;
            let held = file.metadata().map_err(|_| ERROR)?;
            if held.dev() != original.dev() || held.ino() != original.ino() {
                return Err(ERROR.into());
            }
            let root = path.canonicalize().map_err(|_| ERROR)?;
            let final_meta = std::fs::symlink_metadata(&root).map_err(|_| ERROR)?;
            if final_meta.dev() != held.dev() || final_meta.ino() != held.ino() {
                return Err(ERROR.into());
            }
            root
        };
        Ok(Self {
            root,
            _root: file,
            #[cfg(test)]
            publish_failure: std::sync::atomic::AtomicU8::new(0),
        })
    }
    #[cfg(test)]
    pub fn fail_next_publish(&self, mode: u8) {
        self.publish_failure
            .store(mode, std::sync::atomic::Ordering::SeqCst);
    }
    fn parents(&self, relative: &str) -> Result<(PathBuf, Vec<File>), String> {
        self.parents_for_write(relative, false)
    }
    fn parents_for_write(
        &self,
        relative: &str,
        create: bool,
    ) -> Result<(PathBuf, Vec<File>), String> {
        if !permitted(relative) {
            return Err(ERROR.into());
        }
        verify(&self._root, true)?;
        let mut path = self.root.clone();
        let mut locks = Vec::new();
        let parts: Vec<_> = relative.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            path.push(part);
            #[cfg(not(windows))]
            if create {
                match std::fs::create_dir(&path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(_) => return Err(ERROR.into()),
                }
            }
            #[cfg(windows)]
            let f = windows::open(
                locks.last().unwrap_or(&self._root),
                std::ffi::OsStr::new(part),
                true,
                false,
                create,
            )
            .map_err(|_| ERROR)?;
            #[cfg(not(windows))]
            let f = options(true, false).open(&path).map_err(|_| ERROR)?;
            verify(&f, true)?;
            locks.push(f);
        }
        path.push(parts.last().ok_or(ERROR)?);
        Ok((path, locks))
    }
    fn read_file(&self, relative: &str, write: bool) -> Result<(File, Vec<File>), String> {
        let (path, locks) = self.parents(relative)?;
        #[cfg(windows)]
        let file = windows::open(
            locks.last().unwrap_or(&self._root),
            path.file_name().ok_or(ERROR)?,
            false,
            write,
            false,
        )
        .map_err(|_| ERROR)?;
        #[cfg(not(windows))]
        let file = options(false, write).open(path).map_err(|_| ERROR)?;
        verify(&file, false)?;
        Ok((file, locks))
    }
    pub fn read(&self, path: &str) -> Result<Value, String> {
        let (mut file, _locks) = self.read_file(path, false)?;
        let text = content(&mut file)?;
        Ok(json!({"path":path,"text":text,"digest":digest(&text)}))
    }
    #[cfg(test)]
    pub fn write(&self, path: &str, text: &str, expected: Option<&str>) -> Result<Value, String> {
        self.write_tracked(path, text, expected, &mut |_| {})
    }
    /// Fully write and sync a private staging file before changing the destination.
    /// An existing file is moved by its checked handle, then the new file is
    /// published without overwriting. Failed publication restores the original;
    /// if another program occupies its name, report a recoverable deletion receipt.
    pub fn write_tracked(
        &self,
        path: &str,
        text: &str,
        expected: Option<&str>,
        on_failure: &mut dyn FnMut(Value),
    ) -> Result<Value, String> {
        safe_text(text)?;
        let (target, _locks) = self.parents_for_write(path, expected.is_none())?;
        let parent = target.parent().ok_or(ERROR)?;
        let parent_handle = _locks.last().unwrap_or(&self._root);
        #[cfg(windows)]
        let mut temporary = windows::StagedFile::new(parent_handle).map_err(|_| ERROR)?;
        #[cfg(not(windows))]
        let mut temporary = tempfile::Builder::new()
            .prefix(".blocky-coding-")
            .tempfile_in(parent)
            .map_err(|_| ERROR)?;
        temporary
            .write_all(text.as_bytes())
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| ERROR)?;
        if let Some(expected) = expected {
            #[cfg(not(windows))]
            #[allow(unused_mut)]
            let mut opts = options(false, true);
            #[cfg(windows)]
            let mut original = windows::open(
                parent_handle,
                target.file_name().ok_or(ERROR)?,
                false,
                true,
                false,
            )
            .map_err(|_| ERROR)?;
            #[cfg(not(windows))]
            let mut original = opts.open(&target).map_err(|_| ERROR)?;
            verify(&original, false)?;
            let before = content(&mut original)?;
            if digest(&before) != expected {
                return Err("BLK-CODING-CONFLICT".into());
            }
            let backup = parent.join(format!(".blocky-coding-backup-{}", uuid::Uuid::new_v4()));
            rename_checked(&original, &target, &backup, parent_handle)?;
            #[cfg(test)]
            let failure = self
                .publish_failure
                .swap(0, std::sync::atomic::Ordering::SeqCst);
            #[cfg(test)]
            if failure == 2 {
                std::fs::write(&target, "external occupant").map_err(|_| ERROR)?;
            }
            #[cfg(test)]
            let publish_target = if failure == 1 { &backup } else { &target };
            #[cfg(not(test))]
            let publish_target = &target;
            if let Err(error) = temporary.persist_noclobber(publish_target) {
                let restored = rename_checked(&original, &backup, &target, parent_handle).is_ok();
                drop(error);
                if !restored {
                    on_failure(change(path, Some(&before), None));
                }
                return Err("BLK-CODING-CONFLICT".into());
            }
            // The replacement is complete. Failure to delete the hidden recovery
            // copy must not discard the real destination's change receipt.
            let _ = delete_checked(&original, &backup);
            Ok(change(path, Some(&before), Some(text)))
        } else {
            temporary
                .persist_noclobber(&target)
                .map_err(|_| "BLK-CODING-CONFLICT")?;
            Ok(change(path, None, Some(text)))
        }
    }
    #[cfg(test)]
    pub fn undo(&self, change: &Value) -> Result<Value, String> {
        self.undo_tracked(change, &mut |_| {})
    }
    pub fn undo_tracked(
        &self,
        change: &Value,
        on_failure: &mut dyn FnMut(Value),
    ) -> Result<Value, String> {
        let path = change["path"].as_str().ok_or(ERROR)?;
        let after = change["afterDigest"].as_str();
        if let Some(before) = change["before"].as_str() {
            return self.write_tracked(path, before, after, on_failure);
        }
        let after = after.ok_or(ERROR)?;
        let (target, _locks) = self.parents(path)?;
        #[cfg(not(windows))]
        #[allow(unused_mut)]
        let mut o = options(false, true);
        #[cfg(windows)]
        let mut f = windows::open(
            _locks.last().unwrap_or(&self._root),
            target.file_name().ok_or(ERROR)?,
            false,
            true,
            false,
        )
        .map_err(|_| ERROR)?;
        #[cfg(not(windows))]
        let mut f = o.open(&target).map_err(|_| ERROR)?;
        verify(&f, false)?;
        let current = content(&mut f)?;
        if digest(&current) != after {
            return Err("BLK-CODING-CONFLICT".into());
        }
        delete_checked(&f, &target)?;
        Ok(self::change(path, Some(&current), None))
    }
    pub fn list(&self, relative: Option<&str>) -> Result<Vec<Value>, String> {
        verify(&self._root, true)?;
        let prefix = relative.unwrap_or("");
        let (_path, _locks) = if prefix.is_empty() {
            (self.root.clone(), Vec::new())
        } else {
            let (p, mut l) = self.parents(prefix)?;
            #[cfg(windows)]
            let f = windows::open(
                l.last().unwrap_or(&self._root),
                p.file_name().ok_or(ERROR)?,
                true,
                false,
                false,
            )
            .map_err(|_| ERROR)?;
            #[cfg(not(windows))]
            let f = options(true, false).open(&p).map_err(|_| ERROR)?;
            verify(&f, true)?;
            l.push(f);
            (p, l)
        };
        #[cfg(windows)]
        let names = windows::names(_locks.last().unwrap_or(&self._root)).map_err(|error| {
            if error
                .get_ref()
                .is_some_and(|cause| cause.is::<windows::EntryLimit>())
            {
                "BLK-CODING-BUDGET"
            } else {
                ERROR
            }
            .to_owned()
        })?;
        #[cfg(not(windows))]
        let names = {
            let mut names = Vec::new();
            for entry in std::fs::read_dir(&_path).map_err(|_| ERROR)? {
                let entry = entry.map_err(|_| ERROR)?;
                let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| ERROR)?;
                if metadata_safe(&metadata) {
                    names.push((entry.file_name(), metadata.is_dir()));
                }
            }
            names
        };
        let mut entries = Vec::new();
        for (name, directory) in names {
            let name = name.into_string().map_err(|_| ERROR)?;
            let p = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if !permitted(&p) {
                continue;
            }
            // Open entries before exposing them, also checking Windows hard links.
            #[cfg(windows)]
            let f = windows::open(
                _locks.last().unwrap_or(&self._root),
                std::ffi::OsStr::new(&name),
                directory,
                false,
                false,
            )
            .map_err(|_| ERROR)?;
            #[cfg(not(windows))]
            let f = options(directory, false)
                .open(_path.join(&name))
                .map_err(|_| ERROR)?;
            if verify(&f, directory).is_err() {
                continue;
            }
            entries.push(json!({"path":p,"kind":if directory{"directory"}else{"file"}}));
            if entries.len() > 1000 {
                return Err("BLK-CODING-BUDGET".into());
            }
        }
        entries.sort_by_key(|e| e["path"].as_str().unwrap_or("").to_owned());
        Ok(entries)
    }
    #[cfg(test)]
    pub fn search(&self, query: &str, prefix: Option<&str>) -> Result<Value, String> {
        self.search_cancellable(query, prefix, &std::sync::atomic::AtomicBool::new(false))
    }
    pub fn search_cancellable(
        &self,
        query: &str,
        prefix: Option<&str>,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Value, String> {
        if query.is_empty() || query.len() > 200 || query.contains(['\n', '\r']) {
            return Err(ERROR.into());
        }
        let mut dirs = vec![prefix.unwrap_or("").to_owned()];
        let mut matches = Vec::new();
        let mut scanned = 0;
        while let Some(dir) = dirs.pop() {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("BLK-CODING-CANCELLED".into());
            }
            for entry in self.list(if dir.is_empty() { None } else { Some(&dir) })? {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err("BLK-CODING-CANCELLED".into());
                }
                scanned += 1;
                if scanned > 1000 {
                    return Err("BLK-CODING-BUDGET".into());
                }
                let p = entry["path"].as_str().ok_or(ERROR)?;
                if entry["kind"] == "directory" {
                    if p.split('/').count() < 12 {
                        dirs.push(p.to_owned());
                    }
                    continue;
                }
                let Ok(read) = self.read(p) else {
                    continue;
                };
                for (i, line) in read["text"].as_str().ok_or(ERROR)?.lines().enumerate() {
                    if line.contains(query) {
                        matches.push(json!({"path":p,"line":i+1,"text":line.chars().take(500).collect::<String>()}));
                        if matches.len() >= 100 {
                            return Ok(json!({"matches":matches,"truncated":true}));
                        }
                    }
                }
            }
        }
        Ok(json!({"matches":matches,"truncated":false}))
    }
}
fn content(file: &mut File) -> Result<String, String> {
    if file.metadata().map_err(|_| ERROR)?.len() > LIMIT as u64 {
        return Err("BLK-CODING-BUDGET".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ERROR)?;
    let text = String::from_utf8(bytes).map_err(|_| ERROR)?;
    safe_text(&text)?;
    Ok(text)
}
pub(super) fn safe_text(text: &str) -> Result<(), String> {
    if let Ok(value) = crate::strict_json::parse(text.as_bytes()) {
        crate::project_store::check_secrets(&value, 0).map_err(|_| ERROR)?;
    }
    static ASSIGNMENTS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let assignments=ASSIGNMENTS.get_or_init(||regex::Regex::new(r#"(?i)(?:password|token|api[_-]?key|client[_-]?secret|private[_-]?key)\s*["']?\s*[:=]\s*["']?[^\s"'`]{4,}"#).expect("fixed credential pattern"));
    if assignments.is_match(text) {
        return Err(ERROR.into());
    }
    if text.len() > LIMIT
        || text
            .chars()
            .any(|c| c == '\0' || (c.is_control() && !['\n', '\r', '\t'].contains(&c)))
        || crate::builder::contains_credentials(&Value::String(text.to_owned()))
    {
        return Err(ERROR.into());
    }
    Ok(())
}
fn change(path: &str, before: Option<&str>, after: Option<&str>) -> Value {
    json!({"changeId":format!("change-{}",uuid::Uuid::new_v4()),"path":path,"before":before,"after":after,"beforeDigest":before.map(digest),"afterDigest":after.map(digest)})
}

#[cfg(windows)]
fn rename_checked(file: &File, _source: &Path, target: &Path, parent: &File) -> Result<(), String> {
    windows::rename(file, parent, target.file_name().ok_or(ERROR)?).map_err(|_| ERROR.into())
}
#[cfg(not(windows))]
fn rename_checked(file: &File, source: &Path, target: &Path, _parent: &File) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let held = file.metadata().map_err(|_| ERROR)?;
    let current = std::fs::symlink_metadata(source).map_err(|_| ERROR)?;
    if held.dev() != current.dev() || held.ino() != current.ino() {
        return Err("BLK-CODING-CONFLICT".into());
    }
    // Native production is Windows. This branch permits portable file tests.
    std::fs::hard_link(source, target).map_err(|_| ERROR)?;
    std::fs::remove_file(source).map_err(|_| ERROR)?;
    Ok(())
}
fn delete_checked(file: &File, path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_DISPOSITION_INFO, FileDispositionInfo, SetFileInformationByHandle,
        };
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        if unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle() as _,
                FileDispositionInfo,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            )
        } == 0
        {
            return Err(ERROR.into());
        }
        let _ = path;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::MetadataExt;
        let held = file.metadata().map_err(|_| ERROR)?;
        let current = std::fs::symlink_metadata(path).map_err(|_| ERROR)?;
        if held.dev() != current.dev() || held.ino() != current.ino() {
            return Err("BLK-CODING-CONFLICT".into());
        }
        std::fs::remove_file(path).map_err(|_| ERROR.into())
    }
}
