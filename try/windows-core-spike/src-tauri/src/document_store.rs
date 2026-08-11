use crate::project_store::{MAX_PROJECT_BYTES, validate_snapshot_json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tempfile::NamedTempFile;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

pub const BLOCKY_DOCUMENT_FORMAT: &str = "blocky.document/v1";
const MAX_ARCHIVE_BYTES: usize = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 16;
const MANIFEST_NAME: &str = "manifest.json";
const PROJECT_NAME: &str = "project.json";
static DOCUMENT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocumentError {
    pub code: &'static str,
    pub message: &'static str,
}

impl DocumentError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    fn io(code: &'static str, _source: impl std::error::Error) -> Self {
        Self::new(code, "项目文件操作失败，请重试")
    }

    fn invalid(code: &'static str) -> Self {
        Self::new(code, "项目文件不受支持或已损坏")
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub json: String,
    pub suggested_name: String,
    pub save_as: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub document_id: String,
    pub display_name: String,
    pub json: String,
    pub sha256: String,
    pub bytes: u64,
    pub has_file_association: bool,
}

#[derive(Debug, Default)]
struct DocumentSession {
    document_id: Option<String>,
    associated_path: Option<PathBuf>,
}

#[derive(Debug, Default)]
pub struct DocumentStore {
    session: Mutex<DocumentSession>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentManifest {
    format_version: String,
}

impl DocumentStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open_with_dialog(&self) -> Result<Option<DocumentRecord>, DocumentError> {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Blocky Agent", &["blocky"])
            .pick_file()
        else {
            return Ok(None);
        };
        self.open_path(&path).map(Some)
    }

    pub fn save_with_dialog(
        &self,
        request: SaveDocumentRequest,
    ) -> Result<Option<DocumentRecord>, DocumentError> {
        validate_snapshot_json(&request.json)
            .map_err(|error| DocumentError::new(error.code, error.message))?;

        let current_path = self.lock_session()?.associated_path.clone();
        let target = if !request.save_as { current_path } else { None };
        let path = match target {
            Some(path) => path,
            None => {
                let Some(path) = rfd::FileDialog::new()
                    .add_filter("Blocky Agent", &["blocky"])
                    .set_file_name(safe_suggested_name(&request.suggested_name))
                    .save_file()
                else {
                    return Ok(None);
                };
                ensure_blocky_extension(path)
            }
        };
        self.save_path(&path, &request.json).map(Some)
    }

    pub fn clear_association(&self) -> Result<(), DocumentError> {
        let mut session = self.lock_session()?;
        session.associated_path = None;
        session.document_id = None;
        Ok(())
    }

    fn open_path(&self, path: &Path) -> Result<DocumentRecord, DocumentError> {
        ensure_regular_file(path)?;
        let archive_bytes =
            fs::read(path).map_err(|error| DocumentError::io("DOCUMENT_READ_FAILED", error))?;
        let project_bytes = decode_blocky_archive(&archive_bytes)?;
        let json = String::from_utf8(project_bytes)
            .map_err(|_| DocumentError::invalid("DOCUMENT_PROJECT_ENCODING_INVALID"))?;
        validate_snapshot_json(&json)
            .map_err(|error| DocumentError::new(error.code, error.message))?;
        let document_id = next_document_id();
        {
            let mut session = self.lock_session()?;
            session.document_id = Some(document_id.clone());
            session.associated_path = Some(path.to_path_buf());
        }
        Ok(document_record(document_id, path, json, &archive_bytes))
    }

    fn save_path(&self, path: &Path, json: &str) -> Result<DocumentRecord, DocumentError> {
        validate_target(path)?;
        let archive_bytes = encode_blocky_archive(json.as_bytes())?;
        let parent = path
            .parent()
            .filter(|candidate| !candidate.as_os_str().is_empty())
            .ok_or_else(|| DocumentError::invalid("DOCUMENT_TARGET_INVALID"))?;
        let mut temporary = NamedTempFile::new_in(parent)
            .map_err(|error| DocumentError::io("DOCUMENT_WRITE_OPEN_FAILED", error))?;
        temporary
            .write_all(&archive_bytes)
            .map_err(|error| DocumentError::io("DOCUMENT_WRITE_FAILED", error))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| DocumentError::io("DOCUMENT_WRITE_COMMIT_FAILED", error))?;
        temporary
            .persist(path)
            .map_err(|error| DocumentError::io("DOCUMENT_WRITE_COMMIT_FAILED", error.error))?;

        let document_id = {
            let mut session = self.lock_session()?;
            let document_id = session.document_id.clone().unwrap_or_else(next_document_id);
            session.document_id = Some(document_id.clone());
            session.associated_path = Some(path.to_path_buf());
            document_id
        };
        Ok(document_record(
            document_id,
            path,
            json.to_owned(),
            &archive_bytes,
        ))
    }

    fn lock_session(&self) -> Result<MutexGuard<'_, DocumentSession>, DocumentError> {
        self.session.lock().map_err(|_| {
            DocumentError::new("DOCUMENT_SESSION_UNAVAILABLE", "项目文件操作失败，请重试")
        })
    }
}

fn next_document_id() -> String {
    format!(
        "document-{}",
        DOCUMENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn safe_suggested_name(value: &str) -> String {
    let mut safe = value
        .trim()
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .take(120)
        .collect::<String>();
    if safe.is_empty() {
        safe.push_str("未命名 Agent");
    }
    if !safe.to_ascii_lowercase().ends_with(".blocky") {
        safe.push_str(".blocky");
    }
    safe
}

fn ensure_blocky_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().and_then(|extension| extension.to_str()) != Some("blocky") {
        path.set_extension("blocky");
    }
    path
}

fn ensure_regular_file(path: &Path) -> Result<(), DocumentError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| DocumentError::io("DOCUMENT_PATH_CHECK_FAILED", error))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(DocumentError::invalid("DOCUMENT_PATH_UNSAFE"));
    }
    #[cfg(windows)]
    if metadata.file_attributes() & 0x0000_0400 != 0 {
        return Err(DocumentError::invalid("DOCUMENT_PATH_UNSAFE"));
    }
    Ok(())
}

fn validate_target(path: &Path) -> Result<(), DocumentError> {
    if path.extension().and_then(|extension| extension.to_str()) != Some("blocky") {
        return Err(DocumentError::invalid("DOCUMENT_EXTENSION_INVALID"));
    }
    if path.exists() {
        ensure_regular_file(path)?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| DocumentError::invalid("DOCUMENT_TARGET_INVALID"))?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| DocumentError::io("DOCUMENT_PATH_CHECK_FAILED", error))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err(DocumentError::invalid("DOCUMENT_PATH_UNSAFE"));
    }
    #[cfg(windows)]
    if metadata.file_attributes() & 0x0000_0400 != 0 {
        return Err(DocumentError::invalid("DOCUMENT_PATH_UNSAFE"));
    }
    Ok(())
}

fn document_record(
    document_id: String,
    path: &Path,
    json: String,
    archive_bytes: &[u8],
) -> DocumentRecord {
    DocumentRecord {
        document_id,
        display_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("未命名 Agent.blocky")
            .to_owned(),
        json,
        sha256: sha256_hex(archive_bytes),
        bytes: archive_bytes.len() as u64,
        has_file_association: true,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn validate_archive_entry_name(name: &str) -> Result<(), DocumentError> {
    if name.is_empty() || name.contains('\\') || name.contains(':') || name.starts_with('/') {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_PATH_UNSAFE"));
    }
    let path = Path::new(name);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_PATH_UNSAFE"));
    }
    Ok(())
}

pub fn encode_blocky_archive(project_json: &[u8]) -> Result<Vec<u8>, DocumentError> {
    if project_json.len() > MAX_PROJECT_BYTES {
        return Err(DocumentError::invalid("PROJECT_TOO_LARGE"));
    }
    let manifest = serde_json::to_vec(&DocumentManifest {
        format_version: BLOCKY_DOCUMENT_FORMAT.to_owned(),
    })
    .map_err(|error| DocumentError::io("DOCUMENT_MANIFEST_WRITE_FAILED", error))?;
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    archive
        .start_file(MANIFEST_NAME, options)
        .map_err(|error| DocumentError::io("DOCUMENT_ARCHIVE_WRITE_FAILED", error))?;
    archive
        .write_all(&manifest)
        .map_err(|error| DocumentError::io("DOCUMENT_ARCHIVE_WRITE_FAILED", error))?;
    archive
        .start_file(PROJECT_NAME, options)
        .map_err(|error| DocumentError::io("DOCUMENT_ARCHIVE_WRITE_FAILED", error))?;
    archive
        .write_all(project_json)
        .map_err(|error| DocumentError::io("DOCUMENT_ARCHIVE_WRITE_FAILED", error))?;
    let bytes = archive
        .finish()
        .map_err(|error| DocumentError::io("DOCUMENT_ARCHIVE_WRITE_FAILED", error))?
        .into_inner();
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_TOO_LARGE"));
    }
    Ok(bytes)
}

pub fn decode_blocky_archive(bytes: &[u8]) -> Result<Vec<u8>, DocumentError> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_TOO_LARGE"));
    }
    if declared_entry_count(bytes)? != 2 {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRIES_INVALID"));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| DocumentError::invalid("DOCUMENT_ARCHIVE_INVALID"))?;
    if archive.len() != 2 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRIES_INVALID"));
    }

    let mut names = HashSet::new();
    let mut manifest: Option<Vec<u8>> = None;
    let mut project: Option<Vec<u8>> = None;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_INVALID"))?;
        let name = file.name().to_owned();
        validate_archive_entry_name(&name)?;
        if !names.insert(name.clone()) || file.is_dir() || file.encrypted() {
            return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_INVALID"));
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_INVALID"));
        }
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(DocumentError::invalid(
                "DOCUMENT_ARCHIVE_COMPRESSION_UNSUPPORTED",
            ));
        }
        let limit = if name == PROJECT_NAME {
            MAX_PROJECT_BYTES
        } else if name == MANIFEST_NAME {
            4 * 1024
        } else {
            return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_UNKNOWN"));
        };
        if file.size() > limit as u64 {
            return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_TOO_LARGE"));
        }
        let mut contents = Vec::new();
        file.by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut contents)
            .map_err(|_| DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_INVALID"))?;
        if contents.len() > limit {
            return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_ENTRY_TOO_LARGE"));
        }
        match name.as_str() {
            MANIFEST_NAME => manifest = Some(contents),
            PROJECT_NAME => project = Some(contents),
            _ => unreachable!("unknown entries were rejected"),
        }
    }

    let manifest: DocumentManifest = serde_json::from_slice(
        &manifest.ok_or_else(|| DocumentError::invalid("DOCUMENT_MANIFEST_MISSING"))?,
    )
    .map_err(|_| DocumentError::invalid("DOCUMENT_MANIFEST_INVALID"))?;
    if manifest.format_version != BLOCKY_DOCUMENT_FORMAT {
        return Err(DocumentError::invalid("DOCUMENT_FORMAT_UNSUPPORTED"));
    }
    project.ok_or_else(|| DocumentError::invalid("DOCUMENT_PROJECT_MISSING"))
}

fn declared_entry_count(bytes: &[u8]) -> Result<usize, DocumentError> {
    const END_SIGNATURE: &[u8; 4] = b"PK\x05\x06";
    const END_RECORD_BYTES: usize = 22;
    const MAX_COMMENT_BYTES: usize = u16::MAX as usize;
    if bytes.len() < END_RECORD_BYTES {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_INVALID"));
    }

    let search_start = bytes
        .len()
        .saturating_sub(END_RECORD_BYTES + MAX_COMMENT_BYTES);
    let end_offset = (search_start..=bytes.len() - END_RECORD_BYTES)
        .rev()
        .find(|offset| &bytes[*offset..*offset + 4] == END_SIGNATURE)
        .ok_or_else(|| DocumentError::invalid("DOCUMENT_ARCHIVE_INVALID"))?;
    let end = &bytes[end_offset..end_offset + END_RECORD_BYTES];
    let read_u16 = |offset: usize| u16::from_le_bytes([end[offset], end[offset + 1]]);
    let read_u32 = |offset: usize| {
        u32::from_le_bytes([
            end[offset],
            end[offset + 1],
            end[offset + 2],
            end[offset + 3],
        ])
    };
    let disk_number = read_u16(4);
    let directory_disk = read_u16(6);
    let entries_on_disk = read_u16(8);
    let total_entries = read_u16(10);
    let directory_bytes = read_u32(12);
    let directory_offset = read_u32(16);
    let comment_bytes = read_u16(20) as usize;

    if end_offset + END_RECORD_BYTES + comment_bytes != bytes.len()
        || disk_number != 0
        || directory_disk != 0
        || entries_on_disk != total_entries
        || total_entries == u16::MAX
        || directory_bytes == u32::MAX
        || directory_offset == u32::MAX
        || directory_offset as usize + directory_bytes as usize != end_offset
    {
        return Err(DocumentError::invalid("DOCUMENT_ARCHIVE_INVALID"));
    }
    Ok(total_entries as usize)
}

#[cfg(test)]
mod tests {
    use super::{
        BLOCKY_DOCUMENT_FORMAT, DocumentStore, MAX_PROJECT_BYTES, decode_blocky_archive,
        encode_blocky_archive, validate_archive_entry_name,
    };
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    const VALID_PROJECT: &str = r#"{
        "schemaVersion":"blocky.spike-project/v1",
        "projectId":"windows-core-spike",
        "workspace":{"blocks":{"blocks":[],"languageVersion":0}},
        "program":{"schemaVersion":"blocky.ir/v0-spike","roots":[]},
        "interactionManifest":{"schemaVersion":"blocky.interaction/v0-spike","entries":[]}
    }"#;

    fn custom_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, contents) in entries {
            writer
                .start_file(*name, options)
                .expect("test entry starts");
            writer.write_all(contents).expect("test entry writes");
        }
        writer.finish().expect("test archive finishes").into_inner()
    }

    fn archive_with_duplicate_project_entry(manifest: &[u8]) -> Vec<u8> {
        let mut archive = custom_archive(&[
            ("manifest.json", manifest),
            ("project.json", VALID_PROJECT.as_bytes()),
            ("project.jsox", VALID_PROJECT.as_bytes()),
        ]);
        let original = b"project.jsox";
        let duplicate = b"project.json";
        let mut replacements = 0;
        for index in 0..=archive.len() - original.len() {
            if &archive[index..index + original.len()] == original {
                archive[index..index + original.len()].copy_from_slice(duplicate);
                replacements += 1;
            }
        }
        assert_eq!(replacements, 2, "local and central names are both patched");
        archive
    }

    #[test]
    fn blocky_archive_round_trips_versioned_manifest_and_project_json() {
        let bytes = encode_blocky_archive(VALID_PROJECT.as_bytes()).expect("archive encodes");
        let decoded = decode_blocky_archive(&bytes).expect("archive decodes");
        assert_eq!(decoded, VALID_PROJECT.as_bytes());
        assert_eq!(BLOCKY_DOCUMENT_FORMAT, "blocky.document/v1");
    }

    #[test]
    fn archive_entry_names_reject_absolute_traversal_and_backslash_paths() {
        for unsafe_name in [
            "../project.json",
            "/project.json",
            "C:/project.json",
            "folder\\project.json",
            "folder/../project.json",
        ] {
            assert!(
                validate_archive_entry_name(unsafe_name).is_err(),
                "unsafe archive name should fail: {unsafe_name}"
            );
        }
        assert!(validate_archive_entry_name("manifest.json").is_ok());
        assert!(validate_archive_entry_name("project.json").is_ok());
    }

    #[test]
    fn invalid_or_oversized_archive_fails_closed() {
        assert!(decode_blocky_archive(b"not-a-zip").is_err());
        assert!(decode_blocky_archive(&vec![0_u8; 5 * 1024 * 1024 + 1]).is_err());
    }

    #[test]
    fn archive_rejects_duplicate_unknown_traversal_and_unsupported_manifest_entries() {
        let manifest = br#"{"formatVersion":"blocky.document/v1"}"#;
        let unsupported = br#"{"formatVersion":"blocky.document/v2"}"#;
        let fixtures = [
            archive_with_duplicate_project_entry(manifest),
            custom_archive(&[
                ("manifest.json", manifest),
                ("unknown.json", VALID_PROJECT.as_bytes()),
            ]),
            custom_archive(&[
                ("manifest.json", manifest),
                ("../project.json", VALID_PROJECT.as_bytes()),
            ]),
            custom_archive(&[
                ("manifest.json", unsupported),
                ("project.json", VALID_PROJECT.as_bytes()),
            ]),
        ];
        for (index, fixture) in fixtures.into_iter().enumerate() {
            assert!(
                decode_blocky_archive(&fixture).is_err(),
                "malicious fixture {index} must fail closed"
            );
        }
    }

    #[test]
    fn archive_rejects_a_highly_compressed_project_over_the_expanded_limit() {
        let manifest = br#"{"formatVersion":"blocky.document/v1"}"#;
        let oversized = vec![b' '; MAX_PROJECT_BYTES + 1];
        let archive = custom_archive(&[("manifest.json", manifest), ("project.json", &oversized)]);
        assert!(archive.len() < MAX_PROJECT_BYTES);
        assert!(decode_blocky_archive(&archive).is_err());
    }

    #[test]
    fn document_store_round_trips_a_real_atomic_blocky_file_without_serializing_paths() {
        let directory = tempfile::tempdir().expect("document temp directory");
        let path = directory.path().join("weather.blocky");
        let store = DocumentStore::new();
        let saved = store
            .save_path(&path, VALID_PROJECT)
            .expect("document saves atomically");
        assert_eq!(saved.display_name, "weather.blocky");
        assert!(saved.has_file_association);
        assert!(
            !serde_json::to_string(&saved)
                .expect("record serializes")
                .contains(directory.path().to_string_lossy().as_ref())
        );

        let reopened = DocumentStore::new()
            .open_path(&path)
            .expect("document reopens");
        assert_eq!(reopened.json, VALID_PROJECT);
        assert_eq!(reopened.sha256, saved.sha256);
        assert_eq!(reopened.bytes, saved.bytes);
    }
}
