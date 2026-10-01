//! Profile-scoped immutable media. The caller supplies the trusted profile media root,
//! holds AgentData authorization/cancellation across mutations and snapshot loading,
//! and rechecks authorization + `check_current` before publishing a long-running result.
//! Native paths never appear in a Runtime request or persisted/public metadata.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
#[path = "media_audio.rs"]
mod audio;
const INVALID: &str = "BLK-MEDIA-INVALID";
const IO: &str = "BLK-MEDIA-IO";
const LIMIT: &str = "BLK-MEDIA-LIMIT";
const INTEGRITY: &str = "BLK-MEDIA-INTEGRITY";
const CONFLICT: &str = "BLK-MEDIA-CONFLICT";
const PERMISSION: &str = "BLK-PERM-001";
const INPUT_LIMIT: usize = 8 * 1024 * 1024;
const PROJECT_LIMIT: usize = 64 * 1024 * 1024;
const INDEX_LIMIT: usize = 128 * 1024;
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.split(['.', '_', '-']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub media_id: String,
    pub version: u64,
    pub sha256: String,
    pub mime_type: String,
    pub byte_length: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u64>,
}
impl MediaRequest {
    pub fn validate(&self) -> Result<(), String> {
        let existing =
            ["summary", "delete", "transcribe", "image-reference"].contains(&self.action.as_str());
        if self.schema_version != "blocky.media-request/v1"
            || !id(&self.request_id)
            || !id(&self.project_id)
            || !id(&self.session_id)
            || !(existing || self.action == "list")
            || existing != self.media_id.is_some()
            || existing != self.expected_sha256.is_some()
            || existing != self.expected_version.is_some()
            || self.media_id.as_ref().is_some_and(|s| !id(s))
            || self.expected_sha256.as_ref().is_some_and(|s| !hash(s))
            || self.expected_version == Some(0)
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":sha(&serde_json::to_vec(self).map_err(|_|INVALID)?),
        "projectId":self.project_id,"sessionId":self.session_id,"action":self.action,"mediaId":self.media_id,
        "expectedSha256":self.expected_sha256,"expectedVersion":self.expected_version}),
        )
    }
}
/// Host-only bytes from a native file chooser or CLI import. Not deserializable.
pub struct NativeMedia {
    bytes: Vec<u8>,
}
impl NativeMedia {
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        describe(&bytes)?;
        Ok(Self { bytes })
    }
    pub fn preflight(&self) -> Result<Value, String> {
        let (mime, width, height, duration) = describe(&self.bytes)?;
        Ok(
            json!({"sha256":sha(&self.bytes),"byteLength":self.bytes.len(),"mimeType":mime,"width":width,"height":height,"durationMs":duration}),
        )
    }
}
/// Immutable in-memory copy. Only image input and the pinned audio worker consume it.
pub struct MediaSnapshot {
    pub project_id: String,
    pub metadata: Metadata,
    bytes: Vec<u8>,
}
impl MediaSnapshot {
    pub fn image_bytes(&self) -> Result<&[u8], String> {
        if !self.metadata.mime_type.starts_with("image/") {
            return Err(INVALID.into());
        }
        Ok(&self.bytes)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    metadata: Metadata,
    deleted: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    schema_version: String,
    entries: BTreeMap<String, Entry>,
}
pub(super) fn regular(path: &Path) -> Result<(), String> {
    fs::symlink_metadata(path).map_err(|_| IO)?;
    crate::knowledge::no_links(path).map_err(|_| PERMISSION.to_owned())
}
pub(super) fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    regular(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(|_| IO)?;
    let metadata = file.metadata().map_err(|_| IO)?;
    if !metadata.is_file() {
        return Err(INVALID.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(PERMISSION.into());
        }
        let mut info =
            windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION::default();
        if unsafe {
            windows_sys::Win32::Storage::FileSystem::GetFileInformationByHandle(
                file.as_raw_handle() as _,
                &mut info,
            )
        } == 0
            || info.nNumberOfLinks != 1
        {
            return Err(PERMISSION.into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(PERMISSION.into());
        }
    }
    if metadata.len() > limit as u64 {
        return Err(LIMIT.into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > limit {
        return Err(LIMIT.into());
    }
    regular(path)?;
    Ok(bytes)
}
/// Only native import calls this. Reject network/device/relative/ADS paths and reparse points.
pub fn read_native_file(path: &Path) -> Result<NativeMedia, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(INVALID.into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)|Prefix::VerbatimDisk(_)))
        {
            return Err(PERMISSION.into());
        }
        if path
            .components()
            .any(|c| matches!(c,Component::Normal(s) if s.to_string_lossy().contains(':')))
        {
            return Err(PERMISSION.into());
        }
    }
    NativeMedia::from_bytes(read_bounded(path, INPUT_LIMIT)?)
}
fn scope(root: &Path, project: &str) -> Result<PathBuf, String> {
    if !root.is_absolute() || !id(project) {
        return Err(INVALID.into());
    }
    if let Some(existing) = root.ancestors().find(|p| p.exists()) {
        regular(existing)?;
    }
    let path = root.join(sha(project.as_bytes()));
    fs::create_dir_all(&path).map_err(|_| IO)?;
    regular(&path)?;
    Ok(path)
}
fn locked<T>(
    root: &Path,
    project: &str,
    f: impl FnOnce(&Path, &mut Index) -> Result<T, String>,
) -> Result<T, String> {
    let path = scope(root, project)?;
    let lock_path = path.join("media.lock");
    if lock_path.exists() {
        regular(&lock_path)?;
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|_| IO)?;
    lock.try_lock().map_err(|_| "BLK-MEDIA-BUSY")?;
    let index_path = path.join("index.json");
    let mut state: Index = if index_path.exists() {
        serde_json::from_slice(&read_bounded(&index_path, INDEX_LIMIT)?).map_err(|_| INTEGRITY)?
    } else {
        Index {
            schema_version: "blocky.media-store/v1".into(),
            entries: BTreeMap::new(),
        }
    };
    if state.schema_version != "blocky.media-store/v1"
        || state.entries.len() > 128
        || state.entries.iter().any(|(key, e)| {
            !id(key)
                || key != &e.metadata.media_id
                || !hash(&e.metadata.sha256)
                || e.metadata.version == 0
                || e.metadata.byte_length > INPUT_LIMIT
        })
    {
        return Err(INTEGRITY.into());
    }
    f(&path, &mut state)
}
fn save(path: &Path, state: &Index) -> Result<(), String> {
    let bytes = serde_json::to_vec(state).map_err(|_| INVALID)?;
    if bytes.len() > INDEX_LIMIT {
        return Err(LIMIT.into());
    }
    crate::knowledge::atomic_bytes(&path.join("index.json"), &bytes).map_err(|_| IO.into())
}
pub fn import_media(root: &Path, project: &str, input: &NativeMedia) -> Result<Metadata, String> {
    let (mime, width, height, duration) = describe(&input.bytes)?;
    locked(root, project, |path, index| {
        if index.entries.len() >= 128 {
            return Err(LIMIT.into());
        }
        // Include orphaned payloads from an interrupted import in the capacity bound.
        let mut total = 0usize;
        for item in fs::read_dir(path).map_err(|_| IO)? {
            let p = item.map_err(|_| IO)?.path();
            regular(&p)?;
            let m = fs::metadata(&p).map_err(|_| IO)?;
            if !m.is_file() {
                return Err(INTEGRITY.into());
            }
            total = total.checked_add(m.len() as usize).ok_or(LIMIT)?;
        }
        if total.checked_add(input.bytes.len()).ok_or(LIMIT)? > PROJECT_LIMIT {
            return Err(LIMIT.into());
        }
        let metadata = Metadata {
            media_id: format!("media-{}", uuid::Uuid::new_v4()),
            version: 1,
            sha256: sha(&input.bytes),
            mime_type: mime.into(),
            byte_length: input.bytes.len(),
            width,
            height,
            duration_ms: duration,
        };
        let payload = path.join(format!("{}.bin", metadata.media_id));
        let written = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&payload)
            .and_then(|mut file| {
                file.write_all(&input.bytes)?;
                file.sync_all()
            });
        if written.is_err() {
            let _ = fs::remove_file(&payload);
            return Err(IO.into());
        }
        index.entries.insert(
            metadata.media_id.clone(),
            Entry {
                metadata: metadata.clone(),
                deleted: false,
            },
        );
        if let Err(error) = save(path, index) {
            let _ = fs::remove_file(payload);
            return Err(error);
        }
        Ok(metadata)
    })
}
fn entry<'a>(index: &'a Index, r: &MediaRequest) -> Result<&'a Entry, String> {
    let e = index
        .entries
        .get(r.media_id.as_ref().ok_or(INVALID)?)
        .ok_or("BLK-MEDIA-NOT-FOUND")?;
    if e.deleted {
        return Err("BLK-MEDIA-DELETED".into());
    }
    if Some(e.metadata.version) != r.expected_version
        || Some(&e.metadata.sha256) != r.expected_sha256.as_ref()
    {
        return Err(CONFLICT.into());
    }
    Ok(e)
}
pub fn manage(root: &Path, r: &MediaRequest) -> Result<Value, String> {
    r.validate()?;
    if !["list", "summary", "delete"].contains(&r.action.as_str()) {
        return Err(INVALID.into());
    }
    locked(root, &r.project_id, |path, index| {
        if r.action == "list" {
            return Ok(
                json!({"media":index.entries.values().filter(|e|!e.deleted).map(|e|&e.metadata).collect::<Vec<_>>()}),
            );
        }
        let metadata = entry(index, r)?.metadata.clone();
        if r.action == "summary" {
            return Ok(json!({"metadata":metadata}));
        }
        let e = index.entries.get_mut(&metadata.media_id).ok_or(INVALID)?;
        e.deleted = true;
        e.metadata.version = e.metadata.version.checked_add(1).ok_or(CONFLICT)?;
        let version = e.metadata.version;
        save(path, index)?;
        // Persist the tombstone first. A failed unlink cannot revive or publish media.
        let payload = path.join(format!("{}.bin", metadata.media_id));
        if payload.exists() {
            regular(&payload)?;
            fs::remove_file(payload).map_err(|_| IO)?;
        }
        Ok(json!({"deleted":true,"mediaId":metadata.media_id,"version":version}))
    })
}
pub fn load_snapshot(root: &Path, r: &MediaRequest) -> Result<MediaSnapshot, String> {
    r.validate()?;
    if !["transcribe", "image-reference"].contains(&r.action.as_str()) {
        return Err(INVALID.into());
    }
    locked(root, &r.project_id, |path, index| {
        let metadata = entry(index, r)?.metadata.clone();
        if (r.action == "transcribe") != (metadata.mime_type == "audio/wav") {
            return Err(INVALID.into());
        }
        let bytes = read_bounded(
            &path.join(format!("{}.bin", metadata.media_id)),
            INPUT_LIMIT,
        )?;
        let (mime, width, height, duration) = describe(&bytes)?;
        if bytes.len() != metadata.byte_length
            || sha(&bytes) != metadata.sha256
            || mime != metadata.mime_type
            || width != metadata.width
            || height != metadata.height
            || duration != metadata.duration_ms
        {
            return Err(INTEGRITY.into());
        }
        Ok(MediaSnapshot {
            project_id: r.project_id.clone(),
            metadata,
            bytes,
        })
    })
}
/// Must run in the same authorization lock as result publication after transcription.
pub fn check_current(root: &Path, snapshot: &MediaSnapshot) -> Result<(), String> {
    locked(root, &snapshot.project_id, |_, index| {
        let e = index
            .entries
            .get(&snapshot.metadata.media_id)
            .ok_or(CONFLICT)?;
        if e.deleted || e.metadata != snapshot.metadata {
            return Err(CONFLICT.into());
        }
        Ok(())
    })
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub text: String,
    pub from_ms: u64,
    pub to_ms: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
}
/// Cancellation ownership stays with AgentData. This never acquires that authorization
/// lock and does not persist results. Caller rechecks grant/cancel + `check_current`.
pub fn transcribe(
    root: &Path,
    snapshot: &MediaSnapshot,
    cancel: &Arc<AtomicBool>,
) -> Result<Transcript, String> {
    if snapshot.metadata.mime_type != "audio/wav"
        || sha(&snapshot.bytes) != snapshot.metadata.sha256
    {
        return Err(INTEGRITY.into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-MEDIA-CANCELLED".into());
    }
    audio::transcribe(root, snapshot, cancel)
}
type Description = (&'static str, Option<u32>, Option<u32>, Option<u64>);
fn dimensions(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 16_777_216 {
        return Err(LIMIT.into());
    }
    Ok(())
}
fn describe(bytes: &[u8]) -> Result<Description, String> {
    if bytes.len() > INPUT_LIMIT {
        return Err(LIMIT.into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        if bytes.len() < 33
            || &bytes[12..16] != b"IHDR"
            || u32::from_be_bytes(bytes[8..12].try_into().unwrap()) != 13
        {
            return Err(INVALID.into());
        }
        let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        dimensions(w, h)?;
        let mut decoder = png::Decoder::new_with_limits(
            std::io::Cursor::new(bytes),
            png::Limits {
                bytes: 64 * 1024 * 1024,
            },
        );
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|_| INVALID)?;
        if reader.info().animation_control.is_some() {
            return Err(INVALID.into());
        }
        let length = reader
            .output_buffer_size()
            .filter(|n| *n <= 64 * 1024 * 1024)
            .ok_or(LIMIT)?;
        reader
            .next_frame(&mut vec![0; length])
            .map_err(|_| INVALID)?;
        reader.finish().map_err(|_| INVALID)?;
        return Ok(("image/png", Some(w), Some(h), None));
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        if !bytes.ends_with(&[0xff, 0xd9]) {
            return Err(INVALID.into());
        }
        let mut pos = 2;
        let mut frame = None;
        while pos + 4 <= bytes.len() {
            if bytes[pos] != 0xff {
                return Err(INVALID.into());
            }
            while pos < bytes.len() && bytes[pos] == 0xff {
                pos += 1;
            }
            let marker = *bytes.get(pos).ok_or(INVALID)?;
            pos += 1;
            if marker == 0xd9 {
                break;
            }
            if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
                continue;
            }
            if pos + 2 > bytes.len() {
                return Err(INVALID.into());
            }
            let len = u16::from_be_bytes(bytes[pos..pos + 2].try_into().unwrap()) as usize;
            if len < 2 || pos + len > bytes.len() {
                return Err(INVALID.into());
            }
            if marker == 0xda {
                if len < 6 || pos + len + 2 >= bytes.len() {
                    return Err(INVALID.into());
                }
                let (w, h) = frame.ok_or(INVALID)?;
                let mut decoder=jpeg_decoder::Decoder::new(std::io::Cursor::new(bytes));
                decoder.set_max_decoding_buffer_size(64*1024*1024);
                decoder.decode().map_err(|_|INVALID)?;
                return Ok(("image/jpeg", Some(w), Some(h), None));
            }
            if [0xc0, 0xc1, 0xc2].contains(&marker) {
                if len < 8
                    || bytes[pos + 2] != 8
                    || ![1, 3, 4].contains(&bytes[pos + 7])
                    || len != 8 + 3 * bytes[pos + 7] as usize
                    || frame.is_some()
                {
                    return Err(INVALID.into());
                }
                let h = u16::from_be_bytes(bytes[pos + 3..pos + 5].try_into().unwrap()) as u32;
                let w = u16::from_be_bytes(bytes[pos + 5..pos + 7].try_into().unwrap()) as u32;
                dimensions(w, h)?;
                frame = Some((w, h));
            }
            pos += len;
        }
        return Err(INVALID.into());
    }
    if bytes.len() < 44
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8 != bytes.len()
    {
        return Err("BLK-MEDIA-FORMAT".into());
    }
    let mut pos = 12;
    let mut format = false;
    let mut data = None;
    while pos + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let start = pos + 8;
        let end = start.checked_add(size).ok_or(LIMIT)?;
        if end > bytes.len() {
            return Err(INVALID.into());
        }
        if &bytes[pos..pos + 4] == b"fmt " {
            if format
                || size != 16
                || u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()) != 1
                || u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()) != 1
                || u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()) != 16000
                || u32::from_le_bytes(bytes[start + 8..start + 12].try_into().unwrap()) != 32000
                || u16::from_le_bytes(bytes[start + 12..start + 14].try_into().unwrap()) != 2
                || u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) != 16
            {
                return Err("BLK-MEDIA-FORMAT".into());
            }
            format = true;
        }
        if &bytes[pos..pos + 4] == b"data" {
            if data.is_some() || size == 0 || size % 2 != 0 || size > 3_840_000 {
                return Err(LIMIT.into());
            }
            data = Some(size);
        }
        pos = end + size % 2;
    }
    if !format || pos != bytes.len() || data.is_none() {
        return Err(INVALID.into());
    }
    Ok((
        "audio/wav",
        None,
        None,
        Some(data.unwrap() as u64 * 1000 / 32000),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wav() -> Vec<u8> {
        let data = vec![0u8; 320];
        let mut b = b"RIFF".to_vec();
        b.extend((36u32 + data.len() as u32).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(16000u32.to_le_bytes());
        b.extend(32000u32.to_le_bytes());
        b.extend(2u16.to_le_bytes());
        b.extend(16u16.to_le_bytes());
        b.extend(b"data");
        b.extend((data.len() as u32).to_le_bytes());
        b.extend(data);
        b
    }
    fn request(m: &Metadata, action: &str) -> MediaRequest {
        MediaRequest {
            schema_version: "blocky.media-request/v1".into(),
            request_id: "request-one".into(),
            project_id: "project-one".into(),
            session_id: "run-one".into(),
            action: action.into(),
            media_id: Some(m.media_id.clone()),
            expected_sha256: Some(m.sha256.clone()),
            expected_version: Some(m.version),
        }
    }
    #[test]
    fn import_scope_cas_integrity_delete_and_reload() {
        let temp =
            tempfile::tempdir_in(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try"))
                .unwrap();
        let root = temp.path().join("media");
        let m = import_media(
            &root,
            "project-one",
            &NativeMedia::from_bytes(wav()).unwrap(),
        )
        .unwrap();
        assert_eq!(m.duration_ms, Some(10));
        let r = request(&m, "transcribe");
        let snapshot = load_snapshot(&root, &r).unwrap();
        let mut wrong = r.clone();
        wrong.project_id = "other-project".into();
        assert!(load_snapshot(&root, &wrong).is_err());
        wrong = r.clone();
        wrong.expected_sha256 = Some("0".repeat(64));
        assert!(load_snapshot(&root, &wrong).is_err());
        let p = scope(&root, "project-one")
            .unwrap()
            .join(format!("{}.bin", m.media_id));
        let original = fs::read(&p).unwrap();
        fs::write(&p, wav().into_iter().map(|b| b ^ 1).collect::<Vec<_>>()).unwrap();
        assert!(load_snapshot(&root, &r).is_err());
        fs::write(&p, original).unwrap();
        assert!(
            manage(&root, &request(&m, "delete")).unwrap()["deleted"]
                .as_bool()
                .unwrap()
        );
        assert!(load_snapshot(&root, &r).is_err());
        assert!(check_current(&root, &snapshot).is_err());
        assert!(!p.exists());
    }
    #[test]
    fn unsupported_audio_and_client_paths_rejected() {
        let mut b = wav();
        b[22] = 2;
        assert!(NativeMedia::from_bytes(b).is_err());
        assert!(NativeMedia::from_bytes(b"not audio".to_vec()).is_err());
        assert!(read_native_file(Path::new("relative.wav")).is_err());
        assert!(serde_json::from_value::<MediaRequest>(json!({"schemaVersion":"blocky.media-request/v1","requestId":"one","projectId":"one","sessionId":"one","action":"list","path":"private"})).is_err());
    }
    #[test]
    fn image_reference_bounds_and_no_audio_confusion() {
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[10, 20, 30]).unwrap();
            writer.finish().unwrap();
        }
        let temp =
            tempfile::tempdir_in(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try"))
                .unwrap();
        let m = import_media(
            temp.path(),
            "project-one",
            &NativeMedia::from_bytes(png_bytes.clone()).unwrap(),
        )
        .unwrap();
        assert_eq!(m.mime_type, "image/png");
        assert_eq!(m.width, Some(1));
        assert!(load_snapshot(temp.path(), &request(&m, "transcribe")).is_err());
        assert_eq!(
            load_snapshot(temp.path(), &request(&m, "image-reference"))
                .unwrap()
                .image_bytes()
                .unwrap(),
            png_bytes
        );
        png_bytes.truncate(33);
        assert!(NativeMedia::from_bytes(png_bytes).is_err());
        assert!(NativeMedia::from_bytes(vec![0xff, 0xd8, 0xff, 0xd9]).is_err());
        assert!(dimensions(8193, 1).is_err());
        assert!(dimensions(8192, 8192).is_err());
    }
    #[test]
    fn native_hardlink_is_rejected() {
        let temp =
            tempfile::tempdir_in(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try"))
                .unwrap();
        let first = temp.path().join("input.wav");
        let second = temp.path().join("linked.wav");
        fs::write(&first, wav()).unwrap();
        fs::hard_link(&first, &second).unwrap();
        assert!(read_native_file(&second.canonicalize().unwrap()).is_err());
    }
    #[test]
    fn jpeg_requires_a_complete_decodable_image() {
        let bytes=include_bytes!("../../tests/fixtures/tiny-image.jpg");
        let image=NativeMedia::from_bytes(bytes.to_vec()).unwrap();
        assert_eq!(image.preflight().unwrap()["mimeType"],"image/jpeg");
        let mut truncated=bytes[..bytes.len()/2].to_vec();
        truncated.extend([0xff,0xd9]);
        assert!(NativeMedia::from_bytes(truncated).is_err());
    }
    #[test]
    fn orphaned_payloads_count_toward_project_capacity() {
        let temp =
            tempfile::tempdir_in(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try"))
                .unwrap();
        let path = scope(temp.path(), "project-one").unwrap();
        fs::File::create(path.join("orphan.bin"))
            .unwrap()
            .set_len(PROJECT_LIMIT as u64)
            .unwrap();
        assert_eq!(
            import_media(
                temp.path(),
                "project-one",
                &NativeMedia::from_bytes(wav()).unwrap()
            )
            .unwrap_err(),
            LIMIT
        );
    }
}
