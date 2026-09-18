use super::*;
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

// Only raw-object plumbing is permitted. Worktree Git commands (including
// status/diff) can execute repository clean filters even when hooks are disabled.
fn git(root: &Path, args: &[&str], input: Option<Vec<u8>>, max: usize) -> Result<Vec<u8>, String> {
    if !matches!(args.first(), Some(&"rev-parse" | &"ls-tree" | &"cat-file")) {
        return Err(DENIED.into());
    }
    let mut command = Command::new("git");
    // Do not inherit user-configured Git execution/transport overrides.
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
        .args([
            "--no-optional-locks",
            "--no-replace-objects",
            "--no-lazy-fetch",
            "--no-pager",
        ])
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=NUL",
            "-c",
            "protocol.allow=never",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ATTR_NOSYSTEM", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "BLK-KNOW-GIT")?;
    #[cfg(windows)]
    let _job = match super::git_job::GitJob::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let output = child.stdout.take().ok_or(IO)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take(max as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let writer = if let Some(input) = input {
        let mut stdin = child.stdin.take().ok_or(IO)?;
        Some(std::thread::spawn(move || stdin.write_all(&input)))
    } else {
        None
    };
    let start = Instant::now();
    let status = loop {
        if let Err(error) = super::cancel::check() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        if let Some(status) = child.try_wait().map_err(|_| IO)? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("BLK-KNOW-TIMEOUT".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    if let Some(writer) = writer {
        writer.join().map_err(|_| IO)?.map_err(|_| IO)?;
    }
    let bytes = reader.join().map_err(|_| IO)?.map_err(|_| IO)?;
    if bytes.len() > max {
        return Err(LIMIT.into());
    }
    if !status.success() {
        return Err("BLK-KNOW-GIT".into());
    }
    Ok(bytes)
}
fn oid(value: &str) -> bool {
    [40, 64].contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
struct Entry {
    mode: String,
    kind: String,
    oid: String,
    path: String,
    size: Option<usize>,
}
fn tree(root: &Path, commit: &str) -> Result<Vec<Entry>, String> {
    if !oid(commit) {
        return Err(INVALID.into());
    }
    let listing = git(
        root,
        &["ls-tree", "-r", "-z", "-l", commit],
        None,
        8 * 1024 * 1024,
    )?;
    let mut entries = Vec::new();
    for entry in listing.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        super::cancel::check()?;
        if entries.len() >= 20000 {
            return Err(LIMIT.into());
        }
        let entry = std::str::from_utf8(entry).map_err(|_| INVALID)?;
        let (head, path) = entry.split_once('\t').ok_or(INVALID)?;
        let fields = head.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 4 || !oid(fields[2]) {
            return Err(INVALID.into());
        }
        // Git trees can carry names from another platform. Never let Windows
        // drive/ADS/backslash syntax or dot components acquire path semantics.
        if path.is_empty()
            || path.contains(['\\', ':'])
            || path
                .split('/')
                .any(|s| s.is_empty() || s == "." || s == "..")
            || !Path::new(path)
                .components()
                .all(|c| matches!(c, Component::Normal(_)))
        {
            return Err(DENIED.into());
        }
        let size = if fields[3] == "-" {
            None
        } else {
            Some(fields[3].parse::<usize>().map_err(|_| INVALID)?)
        };
        entries.push(Entry {
            mode: fields[0].into(),
            kind: fields[1].into(),
            oid: fields[2].into(),
            path: path.into(),
            size,
        });
    }
    Ok(entries)
}
fn blobs(
    root: &Path,
    entries: &[&Entry],
    mut visit: impl FnMut(&Entry, &[u8]) -> Result<(), String>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let input = entries
        .iter()
        .map(|e| format!("{}\n", e.oid))
        .collect::<String>()
        .into_bytes();
    let output = git(
        root,
        &["cat-file", "--batch"],
        Some(input),
        MAX_CORPUS + entries.len() * 256,
    )?;
    let mut position = 0;
    for entry in entries {
        super::cancel::check()?;
        let size = entry.size.ok_or(INVALID)?;
        let tail = output.get(position..).ok_or(INVALID)?;
        let end = tail.iter().position(|b| *b == b'\n').ok_or(INVALID)? + position;
        let header = std::str::from_utf8(&output[position..end]).map_err(|_| INVALID)?;
        if header != format!("{} blob {size}", entry.oid) {
            return Err("BLK-KNOW-GIT".into());
        }
        position = end + 1;
        let body = output.get(position..position + size).ok_or(INVALID)?;
        position += size;
        if output.get(position) != Some(&b'\n') {
            return Err(INVALID.into());
        }
        position += 1;
        visit(entry, body)?;
    }
    if position != output.len() {
        return Err(INVALID.into());
    }
    Ok(())
}

pub fn describe(root: &Path, reference: Option<&str>) -> Result<Value, String> {
    ingest::no_links(root)?;
    let reference = reference.unwrap_or("HEAD");
    if reference.is_empty()
        || reference.len() > 256
        || reference.starts_with('-')
        || !reference
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/_.-".contains(&c))
    {
        return Err(INVALID.into());
    }
    let commit = String::from_utf8(git(
        root,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
        None,
        256,
    )?)
    .map_err(|_| INVALID)?
    .trim()
    .to_owned();
    let entries = tree(root, &commit)?;
    let mut candidates = Vec::new();
    let mut unchecked = 0usize;
    let mut total = 0usize;
    for entry in &entries {
        // Symlinks, submodules and oversized files remain explicitly unexamined.
        // They can never produce a false clean verdict for the repository.
        if !matches!(entry.mode.as_str(), "100644" | "100755")
            || entry.kind != "blob"
            || entry.size.is_none_or(|n| n > MAX_DOCUMENT)
        {
            unchecked += 1;
            continue;
        }
        total += entry.size.ok_or(INVALID)?;
        if total > MAX_CORPUS {
            return Err(LIMIT.into());
        }
        candidates.push(entry);
    }
    let canonical = root.canonicalize().map_err(|_| IO)?;
    let mut checked = 0usize;
    let mut changed = 0usize;
    blobs(root, &candidates, |entry, body| {
        let current = raw_worktree_digest(&canonical, &entry.path)?;
        checked += 1;
        if current.as_deref() != Some(digest(body).as_str()) {
            changed += 1;
        }
        Ok(())
    })?;
    let dirty = if changed > 0 {
        "true"
    } else if unchecked > 0 {
        "unknown"
    } else {
        "false"
    };
    Ok(
        json!({"commit":commit,"dirty":dirty,"readPolicy":"locked-commit","dirtyPolicy":"locked-commit-tracked-raw-bytes-v1","dirtyScope":"tracked regular files; index, untracked files, EOL/filter normalization and mode-only changes excluded","dirtyChecked":checked.to_string(),"dirtyChanged":changed.to_string(),"dirtyUnchecked":unchecked.to_string()}),
    )
}
fn raw_worktree_digest(root: &Path, relative: &str) -> Result<Option<String>, String> {
    super::cancel::check()?;
    let path = root.join(relative);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(IO.into()),
        Ok(_) => {}
    }
    ingest::no_links(&path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(&path).map_err(|_| IO)?;
    let metadata = file.metadata().map_err(|_| IO)?;
    if !metadata.is_file() {
        return Ok(None);
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(DENIED.into());
        }
        let mut buffer = vec![0u16; 32768];
        let len = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as _,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if len == 0
            || len as usize >= buffer.len()
            || !Path::new(&String::from_utf16_lossy(&buffer[..len as usize])).starts_with(root)
        {
            return Err(DENIED.into());
        }
    }
    if metadata.len() > MAX_DOCUMENT as u64 {
        return Err(LIMIT.into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > MAX_DOCUMENT {
        return Err(LIMIT.into());
    }
    super::cancel::check()?;
    Ok(Some(digest(&bytes)))
}
pub fn scan(source: &Source) -> Result<Snapshot, String> {
    let root = Path::new(&source.location);
    ingest::no_links(root)?;
    let commit = source.metadata["commit"].as_str().ok_or(INVALID)?;
    let entries = tree(root, commit)?;
    let mut included = Vec::new();
    let mut excluded = Vec::new();
    let mut total = 0usize;
    for entry in &entries {
        let reason = if entry.mode == "120000" {
            Some("link-denied")
        } else if entry.kind != "blob" {
            Some("submodule-denied")
        } else {
            ingest::excluded_path(&entry.path, false)
        };
        if let Some(reason) = reason {
            excluded.push(json!({"path":entry.path,"reason":reason}));
            continue;
        }
        let bytes = entry.size.ok_or(INVALID)?;
        if bytes > MAX_DOCUMENT {
            excluded.push(json!({"path":entry.path,"reason":"document-too-large"}));
            continue;
        }
        total += bytes;
        if total > MAX_CORPUS {
            return Err(LIMIT.into());
        }
        included.push(entry);
    }
    let mut documents = Vec::new();
    blobs(root, &included, |entry, body| {
        match ingest::make_document(source, &entry.path, body) {
            Ok(mut doc) => {
                doc.locator["commit"] = commit.into();
                documents.push(doc);
            }
            Err(reason) => excluded.push(json!({"path":entry.path,"reason":reason})),
        }
        Ok(())
    })?;
    ingest::finish(documents, excluded)
}
