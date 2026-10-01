//! Pinned Whisper CPU CLI: private AppContainer filesystem, no network, suspended
//! start followed by Job ownership, bounded pipes, timeout/cancel and settled cleanup.
use super::*;
#[cfg(windows)]
use crate::{
    process_worker::{IsolatedLaunch, Worker},
    tool_sandbox::Sandbox,
};
#[cfg(windows)]
use std::{
    ffi::OsString,
    sync::mpsc,
    time::{Duration, Instant},
};
#[derive(Deserialize)]
struct Manifest {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    files: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    bytes: usize,
    sha256: String,
}
fn runtime_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| IO)?;
    let parent = exe.parent().ok_or(IO)?;
    let adjacent = parent.join("audio-runtime");
    if adjacent.is_dir() {
        return Ok(adjacent);
    }
    if parent.file_name().is_some_and(|s| s == "bin")
        && parent
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|s| s == "cli")
    {
        return Ok(parent
            .parent()
            .and_then(Path::parent)
            .ok_or(IO)?
            .join("audio-runtime"));
    }
    Err("BLK-MEDIA-ASSET".into())
}
pub(super) fn transcribe(
    root: &Path,
    snapshot: &MediaSnapshot,
    cancel: &Arc<AtomicBool>,
) -> Result<Transcript, String> {
    transcribe_from_runtime(root, snapshot, cancel, &runtime_root()?)
}
#[cfg(not(windows))]
fn transcribe_from_runtime(
    _: &Path,
    _: &MediaSnapshot,
    _: &Arc<AtomicBool>,
    _: &Path,
) -> Result<Transcript, String> {
    Err("BLK-MEDIA-PLATFORM".into())
}
#[cfg(windows)]
fn transcribe_from_runtime(
    root: &Path,
    snapshot: &MediaSnapshot,
    cancel: &Arc<AtomicBool>,
    runtime: &Path,
) -> Result<Transcript, String> {
    fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
        if cancel.load(Ordering::SeqCst) {
            Err("BLK-MEDIA-CANCELLED".into())
        } else {
            Ok(())
        }
    }
    cancelled(cancel)?;
    let manifest: Manifest =
        serde_json::from_str(include_str!("../../../../vendor/audio/runtime-lock.json"))
            .map_err(|_| "BLK-MEDIA-ASSET")?;
    if manifest.schema_version != "blocky.audio-runtime/v1" || manifest.files.len() != 8 {
        return Err("BLK-MEDIA-ASSET".into());
    }
    regular(runtime)?;
    let expected: Value =
        serde_json::from_str(include_str!("../../../../vendor/audio/runtime-lock.json"))
            .map_err(|_| "BLK-MEDIA-ASSET")?;
    let deployed: Value =
        serde_json::from_slice(&read_bounded(&runtime.join("runtime-lock.json"), 32768)?)
            .map_err(|_| "BLK-MEDIA-ASSET")?;
    if expected != deployed {
        return Err("BLK-MEDIA-ASSET".into());
    }
    let sessions = root.join("tool-sessions");
    if let Some(existing) = sessions.ancestors().find(|p| p.exists()) {
        regular(existing)?;
    }
    fs::create_dir_all(&sessions).map_err(|_| IO)?;
    regular(&sessions)?;
    let temp = tempfile::Builder::new()
        .prefix("audio-")
        .tempdir_in(sessions)
        .map_err(|_| IO)?;
    let bundle = temp.path().join("bundle");
    let work = temp.path().join("work");
    fs::create_dir(&bundle).map_err(|_| IO)?;
    fs::create_dir(&work).map_err(|_| IO)?;
    let copying = crate::tool_sandbox::record_pending(
        temp.path(),
        manifest
            .files
            .iter()
            .map(|a| format!("bundle/{}", a.name))
            .collect(),
    )?;
    let mut total = 0usize;
    let mut seen = std::collections::BTreeSet::new();
    for asset in &manifest.files {
        cancelled(cancel)?;
        if asset.name.is_empty()
            || asset.name.contains([':', '\\', '\0'])
            || !Path::new(&asset.name)
                .components()
                .all(|c| matches!(c, Component::Normal(_)))
            || !seen.insert(asset.name.to_ascii_lowercase())
            || !hash(&asset.sha256)
        {
            return Err("BLK-MEDIA-ASSET".into());
        }
        total = total.checked_add(asset.bytes).ok_or(LIMIT)?;
        if total > 96 * 1024 * 1024 {
            return Err(LIMIT.into());
        }
        let bytes = read_bounded(&runtime.join(&asset.name), asset.bytes)?;
        if bytes.len() != asset.bytes || sha(&bytes) != asset.sha256 {
            return Err("BLK-MEDIA-ASSET".into());
        }
        let target = bundle.join(&asset.name);
        fs::create_dir_all(target.parent().ok_or(IO)?).map_err(|_| IO)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .and_then(|mut f| f.write_all(&bytes))
            .map_err(|_| IO)?;
    }
    drop(copying);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(work.join("input.wav"))
        .and_then(|mut f| f.write_all(&snapshot.bytes))
        .map_err(|_| IO)?;
    let mut sandbox = Sandbox::new(&temp)?;
    let run = (|| {
        sandbox.grant_tree(&bundle, false)?;
        sandbox.grant_tree(&work, true)?;
        let mut environment: Vec<(OsString, OsString)> = [
            "SYSTEMROOT",
            "SYSTEMDRIVE",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
        ]
        .into_iter()
        .filter_map(|k| std::env::var_os(k).map(|v| (k.into(), v)))
        .collect();
        environment.extend([
            ("TEMP".into(), work.as_os_str().into()),
            ("TMP".into(), work.as_os_str().into()),
        ]);
        let args: Vec<OsString> = vec![
            "-m".into(),
            bundle.join("ggml-tiny.bin").into_os_string(),
            "-f".into(),
            work.join("input.wav").into_os_string(),
            "-l".into(),
            "auto".into(),
            "-t".into(),
            "4".into(),
            "-ng".into(),
            "-oj".into(),
            "-of".into(),
            work.join("result").into_os_string(),
        ];
        let mut worker = Worker::spawn_sandboxed(
            &bundle.join("whisper-cli.exe"),
            &args,
            &format!("Local\\BlockyAudio-{}", uuid::Uuid::new_v4()),
            IsolatedLaunch {
                environment: &environment,
                directory: &work,
                memory_limit: 1024 * 1024 * 1024,
            },
            sandbox.sid(),
        )?;
        drop(worker.take_input());
        let output = worker.take_output().ok_or(IO)?;
        let error = worker.take_error().ok_or(IO)?;
        let (send, receive) = mpsc::channel();
        let other = send.clone();
        fn drain(reader: fs::File) -> Result<(), String> {
            let mut bytes = Vec::new();
            reader
                .take(131073)
                .read_to_end(&mut bytes)
                .map_err(|_| IO)?;
            if bytes.len() > 131072 {
                return Err(LIMIT.into());
            }
            Ok(())
        }
        let stdout = std::thread::spawn(move || {
            let _ = send.send(drain(output));
        });
        let stderr = std::thread::spawn(move || {
            let _ = other.send(drain(error));
        });
        let result = (|| {
            worker.resume()?;
            let started = Instant::now();
            let mut ended = 0;
            while ended < 2 {
                cancelled(cancel)?;
                if started.elapsed() > Duration::from_secs(120) {
                    return Err("BLK-MEDIA-TIMEOUT".into());
                }
                match receive.recv_timeout(Duration::from_millis(20)) {
                    Ok(r) => {
                        r?;
                        ended += 1;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => return Err(IO.into()),
                }
            }
            cancelled(cancel)?;
            parse_output(
                &read_bounded(&work.join("result.json"), 256 * 1024)?,
                snapshot.metadata.duration_ms.ok_or(INVALID)?,
            )
        })();
        // Settle the complete Job before joining pipe readers or releasing ACL/tempdir.
        let stopped = worker.stop();
        stopped?;
        stdout.join().map_err(|_| IO)?;
        stderr.join().map_err(|_| IO)?;
        cancelled(cancel)?;
        result
    })();
    let closed = sandbox.close();
    drop(sandbox);
    closed?;
    temp.close().map_err(|_| "BLK-MEDIA-CLEANUP")?;
    run
}
fn parse_output(bytes: &[u8], duration: u64) -> Result<Transcript, String> {
    let v: Value = serde_json::from_slice(bytes).map_err(|_| "BLK-MEDIA-OUTPUT")?;
    let language = v["result"]["language"].as_str().ok_or("BLK-MEDIA-OUTPUT")?;
    if language.is_empty()
        || language.len() > 16
        || !language
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c == b'-')
    {
        return Err("BLK-MEDIA-OUTPUT".into());
    }
    let segments = v["transcription"].as_array().ok_or("BLK-MEDIA-OUTPUT")?;
    if segments.len() > 4096 {
        return Err(LIMIT.into());
    }
    let mut result = Vec::new();
    let mut total = 0usize;
    let mut previous = 0;
    for segment in segments {
        let text = segment["text"].as_str().ok_or("BLK-MEDIA-OUTPUT")?;
        total = total.checked_add(text.len()).ok_or(LIMIT)?;
        let from = segment["offsets"]["from"]
            .as_u64()
            .ok_or("BLK-MEDIA-OUTPUT")?;
        let to = segment["offsets"]["to"]
            .as_u64()
            .ok_or("BLK-MEDIA-OUTPUT")?;
        if total > 65536
            || text.contains('\0')
            || from < previous
            || to < from
            || to > duration.saturating_add(1000)
        {
            return Err("BLK-MEDIA-OUTPUT".into());
        }
        previous = from;
        result.push(TranscriptSegment {
            text: text.trim().into(),
            from_ms: from,
            to_ms: to,
        });
    }
    Ok(Transcript {
        language: language.into(),
        segments: result,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_projection_never_returns_model_path() {
        let b=br#"{"params":{"model":"private"},"result":{"language":"en"},"transcription":[{"text":" public example ","offsets":{"from":0,"to":100}}]}"#;
        let r = parse_output(b, 100).unwrap();
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("private"));
        assert!(json.contains("public example"));
        assert!(parse_output(b, 0).is_ok());
        let wrong=br#"{"result":{"language":"en"},"transcription":[{"text":"bad","offsets":{"from":100,"to":0}}]}"#;
        assert!(parse_output(wrong, 100).is_err());
    }
    #[test]
    #[ignore = "Explicit public WAV/locked runtime integration probe"]
    fn real_public_wav_and_cancel() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/audio-assets");
        let temp = tempfile::tempdir_in(&base).unwrap();
        let input = read_native_file(&base.join("jfk.wav").canonicalize().unwrap()).unwrap();
        let metadata = import_media(&temp.path().join("media"), "project-one", &input).unwrap();
        let request = MediaRequest {
            schema_version: "blocky.media-request/v1".into(),
            request_id: "one".into(),
            project_id: "project-one".into(),
            session_id: "run-one".into(),
            action: "transcribe".into(),
            media_id: Some(metadata.media_id),
            expected_sha256: Some(metadata.sha256),
            expected_version: Some(1),
        };
        let snapshot = load_snapshot(&temp.path().join("media"), &request).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let result = transcribe_from_runtime(
            temp.path(),
            &snapshot,
            &cancel,
            &base.join("audio-runtime").canonicalize().unwrap(),
        )
        .unwrap();
        assert_eq!(result.language, "en");
        assert!(result.segments.iter().any(|s| s.text.contains("country")));
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            transcribe_from_runtime(temp.path(), &snapshot, &cancel, &base.join("audio-runtime"))
                .unwrap_err(),
            "BLK-MEDIA-CANCELLED"
        );
        // Exercise cancellation while a real longer CPU job is active, then confirm
        // all task directories disappear. Uses synthetic silence, no private media.
        let length = 3_200_000u32;
        let mut bytes = b"RIFF".to_vec();
        bytes.extend((36 + length).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(16000u32.to_le_bytes());
        bytes.extend(32000u32.to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(length.to_le_bytes());
        bytes.resize(44 + length as usize, 0);
        let mut metadata = snapshot.metadata.clone();
        metadata.sha256 = sha(&bytes);
        metadata.byte_length = bytes.len();
        metadata.duration_ms = Some(100_000);
        let longer = MediaSnapshot {
            project_id: snapshot.project_id.clone(),
            metadata,
            bytes,
        };
        let active = Arc::new(AtomicBool::new(false));
        let flag = active.clone();
        let sessions = temp.path().join("tool-sessions");
        let cancelling = std::thread::spawn(move || {
            let started = Instant::now();
            let mut observed = false;
            while started.elapsed() < Duration::from_secs(5) {
                if fs::read_dir(&sessions).unwrap().any(|e| {
                    fs::read(e.unwrap().path().join("sandbox.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                        .is_some_and(|v| v["profileName"].as_str().is_some_and(|s| !s.is_empty()))
                }) {
                    observed = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            std::thread::sleep(Duration::from_millis(500));
            flag.store(true, Ordering::SeqCst);
            observed
        });
        let started = Instant::now();
        let result = transcribe_from_runtime(
            temp.path(),
            &longer,
            &active,
            &base.join("audio-runtime").canonicalize().unwrap(),
        );
        assert!(cancelling.join().unwrap());
        assert_eq!(result.unwrap_err(), "BLK-MEDIA-CANCELLED");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(
            fs::read_dir(temp.path().join("tool-sessions"))
                .unwrap()
                .count(),
            0
        );
    }
}
