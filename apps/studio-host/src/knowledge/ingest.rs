use super::*;
use serde_json::json;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub fn no_links(path: &Path) -> Result<(), String> {
    for component in path.ancestors() {
        let metadata = fs::symlink_metadata(component).map_err(|_| IO)?;
        if metadata.file_type().is_symlink() {
            return Err(DENIED.into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(DENIED.into());
            }
        }
    }
    Ok(())
}
pub fn grant(kind: &str, location: &str, reference: Option<&str>) -> Result<Source, String> {
    let mut metadata = json!({});
    let (location, title) = match kind {
        "url" => {
            let url = network::validate_url(location)?;
            (
                url.as_str().to_owned(),
                url.host_str().unwrap_or("网页资料").to_owned(),
            )
        }
        "file" | "directory" | "repository" => {
            let path = Path::new(location);
            no_links(path)?;
            let canonical = path.canonicalize().map_err(|_| IO)?;
            if (kind == "file" && !canonical.is_file()) || (kind != "file" && !canonical.is_dir()) {
                return Err(INVALID.into());
            }
            if kind == "repository" {
                metadata = super::repository::describe(&canonical, reference)?;
            } else if reference.is_some() {
                return Err(INVALID.into());
            }
            (
                canonical.to_string_lossy().into_owned(),
                canonical
                    .file_name()
                    .ok_or(INVALID)?
                    .to_string_lossy()
                    .into_owned(),
            )
        }
        _ => return Err(INVALID.into()),
    };
    Ok(Source {
        source_id: format!("src-{}", uuid::Uuid::new_v4()),
        kind: kind.into(),
        title,
        location,
        revision: String::new(),
        allowed_principals: vec!["local-user".into()],
        metadata,
    })
}
pub fn scan(
    source: &Source,
    previous: Option<&Document>,
    parser_root: &Path,
) -> Result<Snapshot, String> {
    #[cfg(windows)]
    let mut parser = None;
    let result = scan_inner(
        source,
        previous,
        parser_root,
        #[cfg(windows)]
        &mut parser,
    );
    #[cfg(windows)]
    if let Some(mut parser) = parser {
        parser.close()?;
    }
    result
}
fn scan_inner(
    source: &Source,
    previous: Option<&Document>,
    parser_root: &Path,
    #[cfg(windows)] parser: &mut Option<super::document_worker::Parser>,
) -> Result<Snapshot, String> {
    let mut documents = Vec::new();
    let mut excluded = Vec::new();
    let mut total = 0;
    match source.kind.as_str() {
        "url" => {
            let fetched = network::fetch(&source.location, previous)?;
            let mut document = make_document(source, "page", &fetched.bytes)?;
            document.locator["url"] = fetched.url.into();
            document.format = if fetched.html { "html" } else { "text" }.into();
            document.metadata = fetched.metadata;
            documents.push(document);
        }
        "repository" => return super::repository::scan(source),
        "file" | "directory" => {
            let root = Path::new(&source.location);
            no_links(root)?;
            let mut queue = vec![(
                root.to_path_buf(),
                if source.kind == "file" {
                    source.title.clone()
                } else {
                    String::new()
                },
            )];
            let mut visited = 0;
            while let Some((path, relative)) = queue.pop() {
                super::cancel::check()?;
                visited += 1;
                if visited > 20000 {
                    return Err(LIMIT.into());
                }
                if no_links(&path).is_err() {
                    excluded.push(json!({"path":relative,"reason":"link-denied"}));
                    continue;
                }
                if path.is_dir() {
                    if !relative.is_empty() {
                        if let Some(reason) = excluded_path(&relative, true) {
                            excluded.push(json!({"path":relative,"reason":reason}));
                            continue;
                        }
                    }
                    let mut children = fs::read_dir(&path)
                        .map_err(|_| IO)?
                        .take(20001)
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|_| IO)?;
                    if children.len() > 20000 {
                        return Err(LIMIT.into());
                    }
                    children.sort_by_key(|e| e.file_name());
                    for child in children.into_iter().rev() {
                        let name = child.file_name().to_string_lossy().into_owned();
                        let rel = if relative.is_empty() {
                            name
                        } else {
                            format!("{relative}/{name}")
                        };
                        queue.push((child.path(), rel));
                    }
                    continue;
                }
                if let Some(reason) = excluded_path(&relative, false) {
                    excluded.push(json!({"path":relative,"reason":reason}));
                    continue;
                }
                let mut bytes = Vec::new();
                let mut options = fs::OpenOptions::new();
                options.read(true);
                #[cfg(windows)]
                {
                    use std::os::windows::fs::OpenOptionsExt;
                    options.custom_flags(0x00200000);
                }
                let file = options.open(&path).map_err(|_| IO)?;
                verify_handle(&file, root)?;
                let parsed_format = super::document_result::format(&relative);
                let limit = if parsed_format.is_some() {
                    super::document_result::INPUT_LIMIT
                } else {
                    MAX_DOCUMENT
                };
                if file.metadata().map_err(|_| IO)?.len() > limit as u64 {
                    excluded.push(json!({"path":relative,"reason":"document-too-large"}));
                    continue;
                }
                file.take(limit as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| IO)?;
                if bytes.len() > limit {
                    return Err(LIMIT.into());
                }
                total += bytes.len();
                if total > MAX_CORPUS {
                    return Err(LIMIT.into());
                }
                if let Some(extension) = parsed_format {
                    #[cfg(windows)]
                    {
                        if parser.is_none() {
                            *parser = Some(super::document_worker::Parser::new(parser_root)?);
                        }
                        let parsed = parser.as_mut().ok_or(INVALID)?.parse(&bytes, &extension)?;
                        documents.extend(super::document_result::documents(
                            source, &relative, &bytes, &parsed,
                        )?);
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = (extension, parser_root);
                        return Err("BLK-DOCUMENT-PLATFORM".into());
                    }
                    continue;
                }
                match make_document(source, &relative, &bytes) {
                    Ok(doc) => documents.push(doc),
                    Err(reason) => excluded.push(json!({"path":relative,"reason":reason})),
                }
            }
        }
        _ => return Err(INVALID.into()),
    }
    finish(documents, excluded)
}
fn verify_handle(file: &fs::File, root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        if file.metadata().map_err(|_| IO)?.file_attributes() & 0x400 != 0 {
            return Err(DENIED.into());
        }
        let mut path = vec![0u16; 32768];
        let len = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as _,
                path.as_mut_ptr(),
                path.len() as u32,
                0,
            )
        };
        if len == 0 || len as usize >= path.len() {
            return Err(DENIED.into());
        }
        let actual = PathBuf::from(String::from_utf16_lossy(&path[..len as usize]));
        if !actual.starts_with(root) {
            return Err(DENIED.into());
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (file, root);
    }
    Ok(())
}
pub fn excluded_path(relative: &str, directory: bool) -> Option<&'static str> {
    let lower = relative.to_ascii_lowercase();
    if lower.split('/').any(|p| {
        [
            "node_modules",
            "vendor",
            "target",
            "dist",
            "build",
            ".git",
            ".venv",
            "venv",
            "__pycache__",
            "coverage",
            ".next",
            ".cache",
        ]
        .contains(&p)
    }) {
        return Some("dependency-or-generated");
    }
    let name = lower.rsplit('/').next().unwrap_or("");
    if name.starts_with(".env")
        || name.contains("credentials")
        || name.contains("secret")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name == "id_rsa"
        || name == "id_ed25519"
    {
        return Some("secret-file");
    }
    if directory {
        return None;
    }
    if name.ends_with(".min.js") || name.ends_with(".map") {
        return Some("generated-file");
    }
    if format(relative).is_none() && super::document_result::format(relative).is_none() {
        return Some("unsupported-format");
    }
    None
}
fn format(relative: &str) -> Option<&'static str> {
    let ext = Path::new(relative)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" => Some("markdown"),
        "html" | "htm" => Some("html"),
        "txt" | "rst" => Some("text"),
        "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" | "py" | "rs" | "go" | "c" | "h" | "cpp"
        | "hpp" | "cs" | "java" | "kt" | "rb" | "sh" | "ps1" | "json" | "toml" | "yaml" | "yml"
        | "xml" | "css" | "sql" | "lock" => Some("code"),
        _ => {
            if [
                "license",
                "copying",
                "notice",
                "readme",
                "dockerfile",
                "makefile",
            ]
            .contains(
                &relative
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str(),
            ) {
                Some("text")
            } else {
                None
            }
        }
    }
}
pub fn make_document(source: &Source, relative: &str, bytes: &[u8]) -> Result<Document, String> {
    if bytes.len() > MAX_DOCUMENT {
        return Err("document-too-large".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "invalid-utf8")?;
    if text.contains('\0') {
        return Err("binary-content".into());
    }
    // Exclude secret-bearing files rather than exporting altered evidence.
    static SECRET: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let secret=SECRET.get_or_init(||regex::Regex::new(r"(?im)(-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|password|authorization|client[_-]?secret)\s*[:=]\s*[\x22\x27]?[A-Za-z0-9_+/=-]{12,}|(?:sk-|ghp_|github_pat_)[A-Za-z0-9_]{20,})").expect("constant secret pattern"));
    if secret.is_match(text) {
        return Err("secret-content".into());
    }
    let revision = digest(bytes);
    Ok(Document {
        document_id: format!(
            "doc-{}",
            digest(format!("{}:{relative}", source.source_id).as_bytes())
        ),
        title: relative.into(),
        locator: json!({"path":relative,"lineStart":1,"lineEnd":text.lines().count().max(1)}),
        format: format(relative).unwrap_or("text").into(),
        text: text.into(),
        revision,
        metadata: json!({"bytes":bytes.len().to_string(),"sourceId":source.source_id}),
    })
}
pub fn finish(
    mut documents: Vec<Document>,
    excluded: Vec<serde_json::Value>,
) -> Result<Snapshot, String> {
    documents.sort_by(|a, b| a.document_id.cmp(&b.document_id));
    let identity = documents
        .iter()
        .map(|d| format!("{}:{}", d.document_id, d.revision))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(Snapshot {
        revision: digest(identity.as_bytes()),
        documents,
        excluded,
    })
}
