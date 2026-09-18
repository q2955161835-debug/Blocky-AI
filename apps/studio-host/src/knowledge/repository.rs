use super::*;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn git(root: &Path, args: &[&str], input: Option<Vec<u8>>, max: usize) -> Result<Vec<u8>, String> {
    let mut command = Command::new("git");
    command
        .arg("--no-optional-locks")
        .arg("--no-replace-objects")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=NUL",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
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
pub fn describe(root: &Path, reference: Option<&str>) -> Result<Value, String> {
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
    if ![40, 64].contains(&commit.len()) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(INVALID.into());
    }
    let dirty = !git(
        root,
        &["status", "--porcelain=v1", "--untracked-files=no"],
        None,
        2 * 1024 * 1024,
    )?
    .is_empty();
    Ok(json!({"commit":commit,"dirty":dirty.to_string(),"readPolicy":"locked-commit"}))
}
pub fn scan(source: &Source) -> Result<Snapshot, String> {
    let root = Path::new(&source.location);
    ingest::no_links(root)?;
    let commit = source.metadata["commit"].as_str().ok_or(INVALID)?;
    if ![40, 64].contains(&commit.len()) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(INVALID.into());
    }
    let listing = git(
        root,
        &["ls-tree", "-r", "-z", "-l", commit],
        None,
        8 * 1024 * 1024,
    )?;
    let mut included = Vec::new();
    let mut excluded = Vec::new();
    let mut total = 0usize;
    for entry in listing.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        if included.len() + excluded.len() >= 20000 {
            return Err(LIMIT.into());
        }
        let entry = std::str::from_utf8(entry).map_err(|_| INVALID)?;
        let (head, path) = entry.split_once('\t').ok_or(INVALID)?;
        let fields = head.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 4 {
            return Err(INVALID.into());
        }
        let reason = if fields[0] == "120000" {
            Some("link-denied")
        } else if fields[1] != "blob" {
            Some("submodule-denied")
        } else {
            ingest::excluded_path(path, false)
        };
        if let Some(reason) = reason {
            excluded.push(json!({"path":path,"reason":reason}));
            continue;
        }
        if path.starts_with('/') || path.split('/').any(|s| s == "..") {
            return Err(DENIED.into());
        }
        let bytes = fields[3].parse::<usize>().map_err(|_| INVALID)?;
        if bytes > MAX_DOCUMENT {
            excluded.push(json!({"path":path,"reason":"document-too-large"}));
            continue;
        }
        total += bytes;
        if total > MAX_CORPUS {
            return Err(LIMIT.into());
        }
        included.push((fields[2].to_owned(), path.to_owned(), bytes));
    }
    let mut documents = Vec::new();
    if !included.is_empty() {
        let input = included
            .iter()
            .map(|(id, _, _)| format!("{id}\n"))
            .collect::<String>()
            .into_bytes();
        let output = git(
            root,
            &["cat-file", "--batch"],
            Some(input),
            MAX_CORPUS + included.len() * 256,
        )?;
        let mut position = 0;
        for (oid, path, size) in included {
            super::cancel::check()?;
            let end = output[position..]
                .iter()
                .position(|b| *b == b'\n')
                .ok_or(INVALID)?
                + position;
            let header = std::str::from_utf8(&output[position..end]).map_err(|_| INVALID)?;
            if header != format!("{oid} blob {size}") {
                return Err(INVALID.into());
            }
            position = end + 1;
            let body = output.get(position..position + size).ok_or(INVALID)?;
            position += size + 1;
            match ingest::make_document(source, &path, body) {
                Ok(mut doc) => {
                    doc.locator["commit"] = commit.into();
                    documents.push(doc);
                }
                Err(reason) => excluded.push(json!({"path":path,"reason":reason})),
            }
        }
    }
    ingest::finish(documents, excluded)
}
