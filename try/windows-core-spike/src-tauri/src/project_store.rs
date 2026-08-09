use atomic_write_file::AtomicWriteFile;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

pub const MAX_PROJECT_BYTES: usize = 5 * 1024 * 1024;
const PROJECT_SCHEMA: &str = "blocky.spike-project/v1";
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectRequest {
    pub project_id: String,
    pub json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub project_id: String,
    pub json: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostError {
    pub code: &'static str,
    pub message: &'static str,
}

impl HostError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    pub fn io(code: &'static str, _source: impl std::error::Error) -> Self {
        let message = match code {
            "PROJECT_READ_FAILED" => "读取项目失败，请重试",
            "PROJECT_PATH_CHECK_FAILED" => "检查项目存储路径失败，请重试",
            _ => "保存项目失败，请重试",
        };
        Self::new(code, message)
    }
}

#[derive(Debug)]
pub struct ProjectStore {
    root: PathBuf,
}

impl ProjectStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn save(&self, request: SaveProjectRequest) -> Result<ProjectRecord, HostError> {
        validate_project_id(&request.project_id)?;
        validate_json_bytes(request.json.as_bytes())?;
        validate_json_document(&request.project_id, &request.json)?;

        let _save_guard = lock_project_saves();
        ensure_path_entry_safe(&self.root)?;
        fs::create_dir_all(&self.root)
            .map_err(|error| HostError::io("PROJECT_DIRECTORY_CREATE_FAILED", error))?;
        ensure_path_entry_safe(&self.root)?;
        let target = self.root.join(format!("{}.json", request.project_id));
        ensure_target_entry_safe(&target)?;
        let temporary_files_before = atomic_temporary_file_names(&self.root, &target)
            .map_err(|error| HostError::io("PROJECT_WRITE_TEMP_SCAN_FAILED", error))?;
        let mut file = AtomicWriteFile::open(&target)
            .map_err(|error| HostError::io("PROJECT_WRITE_OPEN_FAILED", error))?;
        if let Err(error) = file.write_all(request.json.as_bytes()) {
            return match file.discard() {
                Ok(()) => Err(HostError::io("PROJECT_WRITE_FAILED", error)),
                Err(cleanup_error) => {
                    Err(HostError::io("PROJECT_WRITE_CLEANUP_FAILED", cleanup_error))
                }
            };
        }
        if let Err(error) = file.commit() {
            cleanup_new_atomic_temporary_files(&self.root, &target, &temporary_files_before)?;
            return Err(HostError::io("PROJECT_WRITE_COMMIT_FAILED", error));
        }

        Ok(project_record(request.project_id, request.json))
    }

    pub fn load(&self, project_id: &str) -> Result<ProjectRecord, HostError> {
        validate_project_id(project_id)?;
        ensure_path_entry_safe(&self.root)?;
        let target = self.root.join(format!("{project_id}.json"));
        ensure_target_entry_safe(&target)?;
        let bytes = fs::read(&target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                HostError::new("PROJECT_NOT_FOUND", "未找到项目")
            } else {
                HostError::io("PROJECT_READ_FAILED", error)
            }
        })?;
        validate_json_bytes(&bytes)?;
        let json = String::from_utf8(bytes)
            .map_err(|_| HostError::new("PROJECT_JSON_INVALID", "项目 JSON 无效"))?;
        validate_json_document(project_id, &json)?;

        Ok(project_record(project_id.to_owned(), json))
    }
}

fn lock_project_saves() -> MutexGuard<'static, ()> {
    SAVE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn atomic_temporary_file_name_matches(target: &Path, candidate: &OsStr) -> bool {
    let Some(target_name) = target.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    let Some(candidate) = candidate.to_str() else {
        return false;
    };
    let prefix = format!(".{target_name}.");
    let Some(suffix) = candidate.strip_prefix(&prefix) else {
        return false;
    };
    suffix.len() == 6 && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn atomic_temporary_file_names(root: &Path, target: &Path) -> std::io::Result<HashSet<OsString>> {
    let mut names = HashSet::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        if atomic_temporary_file_name_matches(target, &name) && entry.file_type()?.is_file() {
            names.insert(name);
        }
    }
    Ok(names)
}

fn cleanup_new_atomic_temporary_files(
    root: &Path,
    target: &Path,
    temporary_files_before: &HashSet<OsString>,
) -> Result<(), HostError> {
    let temporary_files_after = atomic_temporary_file_names(root, target)
        .map_err(|error| HostError::io("PROJECT_WRITE_CLEANUP_FAILED", error))?;
    for name in temporary_files_after.difference(temporary_files_before) {
        fs::remove_file(root.join(name))
            .map_err(|error| HostError::io("PROJECT_WRITE_CLEANUP_FAILED", error))?;
    }
    Ok(())
}

fn validate_project_id(project_id: &str) -> Result<(), HostError> {
    let valid_length = !project_id.is_empty() && project_id.len() <= 64;
    let valid_slug = project_id.split('-').all(|segment| {
        !segment.is_empty()
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    });
    if valid_length && valid_slug {
        Ok(())
    } else {
        Err(HostError::new("PROJECT_ID_INVALID", "项目标识无效"))
    }
}

fn validate_json_bytes(bytes: &[u8]) -> Result<(), HostError> {
    if bytes.len() > MAX_PROJECT_BYTES {
        Err(HostError::new("PROJECT_TOO_LARGE", "项目数据超过大小限制"))
    } else {
        Ok(())
    }
}

fn validate_json_document(project_id: &str, json: &str) -> Result<(), HostError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|_| HostError::new("PROJECT_JSON_INVALID", "项目 JSON 无效"))?;
    let object = value
        .as_object()
        .ok_or_else(|| HostError::new("PROJECT_JSON_INVALID", "项目 JSON 无效"))?;
    if object.get("schemaVersion").and_then(Value::as_str) != Some(PROJECT_SCHEMA) {
        return Err(HostError::new(
            "PROJECT_SCHEMA_UNSUPPORTED",
            "项目格式版本不受支持",
        ));
    }
    if object.get("projectId").and_then(Value::as_str) != Some(project_id) {
        return Err(HostError::new("PROJECT_ID_MISMATCH", "项目标识不匹配"));
    }
    if contains_sensitive_string(&value) {
        return Err(HostError::new(
            "PROJECT_SENSITIVE_VALUE",
            "项目包含不允许保存的敏感值",
        ));
    }
    Ok(())
}

fn ensure_path_entry_safe(path: &Path) -> Result<(), HostError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_unsafe(&metadata) => {
            Err(HostError::new("PROJECT_PATH_UNSAFE", "项目存储路径不安全"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(HostError::io("PROJECT_PATH_CHECK_FAILED", error)),
    }
}

fn ensure_target_entry_safe(path: &Path) -> Result<(), HostError> {
    ensure_path_entry_safe(path)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            Err(HostError::new("PROJECT_PATH_UNSAFE", "项目存储路径不安全"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(HostError::io("PROJECT_PATH_CHECK_FAILED", error)),
    }
}

fn metadata_is_unsafe(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    let windows_file_attributes = metadata.file_attributes();
    #[cfg(not(windows))]
    let windows_file_attributes = 0;
    path_metadata_flags_are_unsafe(metadata.file_type().is_symlink(), windows_file_attributes)
}

fn path_metadata_flags_are_unsafe(is_symlink: bool, windows_file_attributes: u32) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    is_symlink || windows_file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn contains_sensitive_string(value: &Value) -> bool {
    match value {
        Value::String(value) => sensitive_patterns()
            .iter()
            .any(|pattern| pattern.is_match(value)),
        Value::Array(values) => values.iter().any(contains_sensitive_string),
        Value::Object(values) => values.values().any(contains_sensitive_string),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

fn sensitive_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"\bsk-[A-Za-z0-9_-]{20,}\b",
            r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
            r"\bAKIA[A-Z0-9]{16}\b",
            r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b",
            r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----",
            r"(?i)(?:^|[;\s])(?:set-)?cookie\s*:\s*[^\s;=]+=[^\s;]+",
            r#"(?i)(?:^|[^A-Za-z0-9_])[a-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]+"#,
            r"(?i)(?:^|[^A-Za-z0-9_])file=/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+|(?:^|[^:/A-Za-z0-9_])/(?:var|tmp|home|usr|etc|opt|mnt|workspace)(?:/[A-Za-z0-9._-]+)+",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("static sensitive-value regex is valid"))
        .collect()
    })
}

fn project_record(project_id: String, json: String) -> ProjectRecord {
    let bytes = json.as_bytes();
    ProjectRecord {
        project_id,
        sha256: sha256_hex(bytes),
        bytes: bytes.len() as u64,
        json,
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

#[cfg(test)]
mod tests {
    use super::{
        atomic_temporary_file_name_matches, cleanup_new_atomic_temporary_files,
        path_metadata_flags_are_unsafe,
    };
    use std::collections::HashSet;
    use std::ffi::OsString;

    #[test]
    fn project_store_path_flag_helper_rejects_symlinks_and_windows_reparse_points() {
        assert!(path_metadata_flags_are_unsafe(true, 0));
        assert!(path_metadata_flags_are_unsafe(false, 0x400));
        assert!(!path_metadata_flags_are_unsafe(false, 0));
    }

    #[test]
    fn atomic_temporary_name_matcher_accepts_only_the_exact_target_and_suffix_shape() {
        let target = std::path::Path::new("demo-project.json");
        assert!(atomic_temporary_file_name_matches(
            target,
            std::ffi::OsStr::new(".demo-project.json.ABC123")
        ));
        assert!(!atomic_temporary_file_name_matches(
            target,
            std::ffi::OsStr::new(".other-project.json.ABC123")
        ));
        assert!(!atomic_temporary_file_name_matches(
            target,
            std::ffi::OsStr::new(".demo-project.json.ABC12")
        ));
        assert!(!atomic_temporary_file_name_matches(
            target,
            std::ffi::OsStr::new(".demo-project.json.ABC12-")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn atomic_cleanup_failure_uses_a_fixed_safe_error() {
        use std::fs::{self, OpenOptions};
        use std::os::windows::fs::OpenOptionsExt;

        let directory = tempfile::tempdir().expect("temporary project directory");
        let target = directory.path().join("demo-project.json");
        let candidate = directory.path().join(".demo-project.json.ABC123");
        fs::write(&candidate, b"locked cleanup fixture").expect("cleanup fixture is written");
        let _exclusive = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&candidate)
            .expect("cleanup fixture is exclusively locked");

        let error = cleanup_new_atomic_temporary_files(
            directory.path(),
            &target,
            &HashSet::<OsString>::new(),
        )
        .expect_err("locked new temporary file cannot be cleaned");
        assert_eq!(error.code, "PROJECT_WRITE_CLEANUP_FAILED");
        assert_eq!(error.message, "保存项目失败，请重试");
        assert!(
            !error
                .message
                .contains(directory.path().to_string_lossy().as_ref())
        );
    }
}
