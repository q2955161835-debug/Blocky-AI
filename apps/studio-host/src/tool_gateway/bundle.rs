//! A registered local server is snapshotted before launch. The approved hash
//! covers every byte and relative file name; links and unknown file types fail.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
const ERROR: &str = "BLK-TOOL-BUNDLE";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Launch {
    pub bundle_path: PathBuf,
    pub executable: String,
    pub arguments: Vec<String>,
    pub node: bool,
}
fn relative(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 1024
        && !s.contains([':', '\0'])
        && Path::new(s)
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
}
fn open(path: &Path) -> Result<File, String> {
    crate::knowledge::no_links(path).map_err(|_| ERROR)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(|_| ERROR)?;
    let metadata = file.metadata().map_err(|_| ERROR)?;
    if !metadata.is_file() {
        return Err(ERROR.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(ERROR.into());
        }
    }
    Ok(file)
}
impl Launch {
    fn files(
        &self,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<BTreeMap<String, File>, String> {
        if !self.bundle_path.is_absolute()
            || self.bundle_path.to_string_lossy().starts_with("\\\\")
            || !relative(&self.executable)
            || !self.executable.to_ascii_lowercase().ends_with(".exe")
            || self.arguments.len() > 32
            || self
                .arguments
                .iter()
                .any(|s| s.len() > 4096 || s.contains('\0'))
        {
            return Err(ERROR.into());
        }
        crate::knowledge::no_links(&self.bundle_path).map_err(|_| ERROR)?;
        if !self.bundle_path.is_dir() {
            return Err(ERROR.into());
        }
        let root = self.bundle_path.canonicalize().map_err(|_| ERROR)?;
        fn walk(
            path: &Path,
            root: &Path,
            depth: usize,
            files: &mut BTreeMap<String, File>,
            bytes: &mut u64,
            cancel: &dyn Fn() -> Result<(), String>,
        ) -> Result<(), String> {
            cancel()?;
            if depth > 16 || files.len() > 4096 {
                return Err(ERROR.into());
            }
            crate::knowledge::no_links(path).map_err(|_| ERROR)?;
            for entry in std::fs::read_dir(path).map_err(|_| ERROR)? {
                cancel()?;
                let entry = entry.map_err(|_| ERROR)?;
                let path = entry.path();
                crate::knowledge::no_links(&path).map_err(|_| ERROR)?;
                let kind = entry.file_type().map_err(|_| ERROR)?;
                if kind.is_dir() {
                    walk(&path, root, depth + 1, files, bytes, cancel)?;
                } else if kind.is_file() {
                    let name = path
                        .strip_prefix(root)
                        .map_err(|_| ERROR)?
                        .to_str()
                        .ok_or(ERROR)?
                        .replace('\\', "/");
                    if !relative(&name) {
                        return Err(ERROR.into());
                    }
                    let file = open(&path)?;
                    *bytes = bytes
                        .checked_add(file.metadata().map_err(|_| ERROR)?.len())
                        .ok_or(ERROR)?;
                    if *bytes > 256 * 1024 * 1024 || files.len() >= 4096 {
                        return Err("BLK-TOOL-BUNDLE-LIMIT".into());
                    }
                    files.insert(name, file);
                } else {
                    return Err(ERROR.into());
                }
            }
            Ok(())
        }
        let mut files = BTreeMap::new();
        walk(&root, &root, 0, &mut files, &mut 0, cancel)?;
        if !files.contains_key(&self.executable.replace('\\', "/")) {
            return Err(ERROR.into());
        }
        Ok(files)
    }
    fn process(
        &self,
        destination: Option<&Path>,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<String, String> {
        let files = self.files(cancel)?;
        let mut hash = Sha256::new();
        let mut total = 0usize;
        for (name, mut file) in files {
            cancel()?;
            hash.update((name.len() as u64).to_le_bytes());
            hash.update(name.as_bytes());
            let expected = file.metadata().map_err(|_| ERROR)?.len();
            hash.update(expected.to_le_bytes());
            let mut output = if let Some(root) = destination {
                let target = root.join(&name);
                std::fs::create_dir_all(target.parent().ok_or(ERROR)?).map_err(|_| ERROR)?;
                Some(
                    OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(target)
                        .map_err(|_| ERROR)?,
                )
            } else {
                None
            };
            let mut count = 0u64;
            let mut bytes = [0u8; 65536];
            loop {
                cancel()?;
                let n = file.read(&mut bytes).map_err(|_| ERROR)?;
                if n == 0 {
                    break;
                }
                count += n as u64;
                total += n;
                if count > expected || total > 256 * 1024 * 1024 {
                    return Err(ERROR.into());
                }
                hash.update(&bytes[..n]);
                if let Some(out) = &mut output {
                    out.write_all(&bytes[..n]).map_err(|_| ERROR)?;
                }
            }
            if count != expected {
                return Err(ERROR.into());
            }
            if let Some(out) = output {
                out.sync_all().map_err(|_| ERROR)?;
            }
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    pub(crate) fn digest(&self, cancel: &dyn Fn() -> Result<(), String>) -> Result<String, String> {
        self.process(None, cancel)
    }
    #[cfg(windows)]
    pub(crate) fn start(
        &self,
        root: &Path,
        expected: &str,
        timeout: u64,
        cancel: &dyn Fn() -> Result<(), String>,
        may_have_started:&std::sync::atomic::AtomicBool,
    ) -> Result<crate::mcp_client::stdio::StdioTransport, String> {
        let sessions = root.join("tool-sessions");
        std::fs::create_dir_all(&sessions).map_err(|_| ERROR)?;
        crate::knowledge::no_links(&sessions).map_err(|_| ERROR)?;
        let directory = tempfile::Builder::new()
            .prefix("mcp-")
            .tempdir_in(sessions)
            .map_err(|_| ERROR)?;
        let bundle = directory.path().join("bundle");
        std::fs::create_dir(&bundle).map_err(|_| ERROR)?;
        let copying = crate::tool_sandbox::record_pending(
            directory.path(),
            self.files(cancel)?
                .keys()
                .map(|name| format!("bundle/{name}"))
                .collect(),
        )?;
        if self.process(Some(&bundle), cancel)? != expected {
            return Err("BLK-TOOL-BINDING".into());
        }
        cancel()?;
        let mut args: Vec<std::ffi::OsString> = Vec::new();
        if self.node {
            args.extend([
                "--preserve-symlinks-main".into(),
                "--preserve-symlinks".into(),
            ]);
        }
        // Relative script arguments resolve inside the read-only bundle; cwd stays writable work.
        for arg in &self.arguments {
            args.push(if relative(arg) && bundle.join(arg).is_file() {
                bundle.join(arg).into_os_string()
            } else {
                arg.into()
            });
        }
        drop(copying);
        crate::mcp_client::stdio::StdioTransport::spawn_tracked(
            directory,
            &bundle.join(&self.executable),
            &args,
            timeout,
            may_have_started,
        )
    }
}
