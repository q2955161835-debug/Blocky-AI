use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::Path;
pub type ProjectFiles = BTreeMap<String, String>;
const LIMIT: usize = 8 * 1024 * 1024;
const REJECT: &str = "BLK-REF-001: invalid project archive";
pub(crate) fn reference(s: &str) -> bool {
    !s.is_empty()
        && !s.chars().any(|c| c.is_control() || ":\\<>|?*".contains(c))
        && s.split('/').all(|p| {
            !p.is_empty()
                && p != "."
                && p != ".."
                && !p.ends_with(['.', ' '])
                && !matches!(
                    p.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
pub(crate) fn stable(s: &str) -> bool {
    let mut chars = s.chars();
    if !matches!(chars.next(), Some('a'..='z')) {
        return false;
    }
    let mut separator = false;
    for c in chars {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            separator = false;
        } else if "._-".contains(c) && !separator {
            separator = true;
        } else {
            return false;
        }
    }
    !separator
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| REJECT.into())
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v.get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| REJECT.into())
}
pub(crate) fn check_secrets(value: &Value, depth: usize) -> Result<(), String> {
    if depth > 100 {
        return Err(REJECT.into());
    }
    match value {
        Value::Object(map) => {
            for (key, v) in map {
                let k = key.to_ascii_lowercase().replace(['_', '-'], "");
                if [
                    "apikey",
                    "authorization",
                    "password",
                    "cookie",
                    "accesstoken",
                    "refreshtoken",
                    "clientsecret",
                    "privatekey",
                    "token",
                    "secret",
                    "credential",
                    "credentials",
                    "bearer",
                    "sessiontoken",
                    "signingkey",
                ]
                .contains(&k.as_str())
                {
                    return Err("BLK-SECRET-001".into());
                }
                check_secrets(v, depth + 1)?;
            }
        }
        Value::Array(a) => {
            for v in a {
                check_secrets(v, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn add_ref<'a>(
    files: &'a BTreeMap<String, Value>,
    used: &mut BTreeSet<String>,
    path: &str,
) -> Result<&'a Value, String> {
    if !reference(path) || !used.insert(path.to_owned()) {
        return Err(REJECT.into());
    }
    files.get(path).ok_or_else(|| REJECT.into())
}
pub fn validate_files(files: &ProjectFiles) -> Result<(), String> {
    if files.is_empty()
        || files.len() > 1000
        || files.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>() > LIMIT
    {
        return Err(REJECT.into());
    }
    let mut parsed = BTreeMap::new();
    let mut names = BTreeSet::new();
    for (path, content) in files {
        if !reference(path) || !names.insert(path.to_lowercase()) {
            return Err(REJECT.into());
        }
        let value = if path.ends_with(".json") {
            crate::strict_json::parse(content.as_bytes())?
        } else if path.starts_with("surfaces/")
            && [".html", ".css", ".js", ".yaml"]
                .iter()
                .any(|extension| path.ends_with(extension))
        {
            Value::String(content.clone())
        } else {
            return Err(REJECT.into());
        };
        check_secrets(&value, 0)?;
        parsed.insert(path.clone(), value);
    }
    let manifest = parsed.get("project.json").ok_or(REJECT)?;
    if text(manifest, "schemaVersion")? != "blocky.project/v1"
        || !stable(text(manifest, "projectId")?)
        || text(manifest, "displayName")?.is_empty()
    {
        return Err("BLK-MIG-001".into());
    }
    if !["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.7.1", "0.8.0"].contains(&text(
        manifest.get("format").ok_or(REJECT)?,
        "minimumReaderVersion",
    )?) {
        return Err("BLK-MIG-001".into());
    }
    let mut used = BTreeSet::from(["project.json".to_owned()]);
    if let Some(path) = manifest.get("settingsRef") {
        if path != "settings.json" {
            return Err(REJECT.into());
        }
        let settings = add_ref(&parsed, &mut used, "settings.json")?;
        crate::user_store::validate_settings(settings)?;
        if settings["scope"] != "project" {
            return Err(REJECT.into());
        }
    }
    let mut modules = BTreeSet::new();
    let mut schema_refs = BTreeSet::new();
    let descriptors = array(manifest, "modules")?;
    if descriptors.is_empty() {
        return Err(REJECT.into());
    }
    for module in descriptors {
        let id = text(module, "moduleId")?;
        if !stable(id) || !modules.insert(id) {
            return Err(REJECT.into());
        }
        text(module, "displayName")?;
        text(module, "purpose")?;
        let ws = add_ref(&parsed, &mut used, text(module, "workspaceRef")?)?;
        let blocks = ws.get("blocks").ok_or(REJECT)?;
        if blocks.get("languageVersion").and_then(Value::as_u64) != Some(0) {
            return Err("BLK-MIG-001".into());
        }
        array(blocks, "blocks")?;
        let mut exports = BTreeSet::new();
        for export in array(module, "exports")? {
            let id = text(export, "exportId")?;
            if !stable(id) || !exports.insert(id) {
                return Err(REJECT.into());
            }
            for field in ["inputSchemaRef", "outputSchemaRef"] {
                if let Some(path) = export.get(field) {
                    let path = path.as_str().ok_or(REJECT)?;
                    if !reference(path)
                        || !path.starts_with("schemas/")
                        || !parsed.contains_key(path)
                    {
                        return Err(REJECT.into());
                    }
                    schema_refs.insert(path.to_owned());
                }
            }
        }
    }
    let mut resources = BTreeSet::new();
    for resource in array(manifest, "resources")? {
        let id = text(resource, "resourceId")?;
        if !stable(id) || !resources.insert(id) {
            return Err(REJECT.into());
        }
        let definition = text(resource, "definitionRef")?;
        match text(resource, "scope")? {
            "project" => {
                let data = add_ref(&parsed, &mut used, definition)?;
                if text(data, "schemaVersion")? != "blocky.resource/v1alpha1"
                    || text(data, "resourceId")? != id
                    || text(data, "scope")? != "project"
                    || text(data, "kind")? != text(resource, "kind")?
                {
                    return Err(REJECT.into());
                }
            }
            "user" => {
                if !stable(definition) {
                    return Err(REJECT.into());
                }
            }
            _ => return Err(REJECT.into()),
        };
    }
    let mut surface_prefixes = Vec::new();
    let mut surfaces = BTreeSet::new();
    for surface in array(manifest, "appSurfaces")? {
        let id = text(surface, "surfaceId")?;
        if !stable(id) || !surfaces.insert(id) {
            return Err(REJECT.into());
        }
        let path = text(surface, "manifestRef")?;
        if path != format!("surfaces/{id}/manifest.json") {
            return Err(REJECT.into());
        }
        let surface_manifest = add_ref(&parsed, &mut used, path)?;
        if surface_manifest["surfaceId"] != id {
            return Err(REJECT.into());
        }
        let prefix = path.rsplit_once('/').ok_or(REJECT)?.0.to_owned() + "/";
        let surface_files = parsed
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        crate::surface_guard::validate(surface_manifest, &surface_files, manifest)?;
        surface_prefixes.push(path.rsplit_once('/').ok_or(REJECT)?.0.to_owned() + "/");
    }
    for path in files.keys() {
        if used.contains(path) {
            continue;
        }
        if path.starts_with("schemas/")
            || surface_prefixes
                .iter()
                .any(|prefix| path.starts_with(prefix))
        {
            continue;
        }
        return Err(REJECT.into());
    }
    Ok(())
}
pub fn save_archive(path: &Path, files: &ProjectFiles) -> Result<(), String> {
    save_with_check(path, files, || Ok(()))
}
pub fn create_archive(path: &Path, files: &ProjectFiles) -> Result<(), String> {
    write_archive(path, files, false, || Ok(()))
}
pub fn create_archive_checked(
    path: &Path,
    files: &ProjectFiles,
    check: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    write_archive(path, files, false, check)
}
fn save_with_check(
    path: &Path,
    files: &ProjectFiles,
    before_commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    write_archive(path, files, true, before_commit)
}
fn write_archive(
    path: &Path,
    files: &ProjectFiles,
    replace: bool,
    before_commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    validate_files(files)?;
    let parent = path.parent().filter(|p| p.is_dir()).ok_or(REJECT)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "BLK-SAVE-001")?;
    {
        let mut zip = zip::ZipWriter::new(temp.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in files {
            zip.start_file(name, options).map_err(|_| "BLK-SAVE-001")?;
            zip.write_all(content.as_bytes())
                .map_err(|_| "BLK-SAVE-001")?;
        }
        zip.finish().map_err(|_| "BLK-SAVE-001")?;
    }
    temp.as_file_mut().flush().map_err(|_| "BLK-SAVE-001")?;
    temp.as_file().sync_all().map_err(|_| "BLK-SAVE-001")?;
    before_commit()?;
    if replace {
        temp.persist(path).map_err(|_| "BLK-SAVE-001")?;
    } else {
        temp.persist_noclobber(path).map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                "BLK-CONFLICT-001"
            } else {
                "BLK-SAVE-001"
            }
        })?;
    }
    Ok(())
}
pub fn read_archive(path: &Path) -> Result<ProjectFiles, String> {
    let files = read_migration_archive(path)?;
    validate_files(&files)?;
    Ok(files)
}
/// Explicit migration input only. Bounded zip/UTF-8/JSON/path validation without
/// accepting a legacy document as a current project or executing its contents.
pub fn read_migration_archive(path: &Path) -> Result<ProjectFiles, String> {
    let file = std::fs::File::open(path).map_err(|_| "BLK-LOAD-001")?;
    if file.metadata().map_err(|_| REJECT)?.len() > LIMIT as u64 {
        return Err(REJECT.into());
    }
    let mut zip = zip::ZipArchive::new(file).map_err(|_| REJECT)?;
    if zip.len() > 1000 {
        return Err(REJECT.into());
    }
    let mut files = BTreeMap::new();
    let mut total = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| REJECT)?;
        if entry.is_dir()
            || entry.size() > LIMIT as u64
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(REJECT.into());
        }
        let name = entry.name().to_owned();
        if files.contains_key(&name) || !reference(&name) {
            return Err(REJECT.into());
        }
        let mut bytes = Vec::new();
        (&mut entry)
            .take((LIMIT - total + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| REJECT)?;
        total += bytes.len();
        if total > LIMIT {
            return Err(REJECT.into());
        }
        let data = String::from_utf8(bytes).map_err(|_| REJECT)?;
        files.insert(name, data);
    }
    let mut names = BTreeSet::new();
    for (name, data) in &files {
        if !names.insert(name.to_lowercase()) {
            return Err(REJECT.into());
        }
        if name.ends_with(".json") {
            check_secrets(&crate::strict_json::parse(data.as_bytes())?, 0)?;
        }
    }
    Ok(files)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn files() -> ProjectFiles {
        BTreeMap::from([("project.json".into(),r#"{"schemaVersion":"blocky.project/v1","projectId":"sample","displayName":"Sample","modules":[{"moduleId":"main","displayName":"Main","purpose":"agent","workspaceRef":"workspaces/main.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"0.1.0","minimumReaderVersion":"0.1.0"}}"#.into()),("workspaces/main.json".into(),r#"{"blocks":{"languageVersion":0,"blocks":[]}}"#.into())])
    }
    #[test]
    fn current_reader_preserves_old_versions_and_rejects_future_formats() {
        for version in ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.7.1", "0.8.0", "0.9.0"] {
            let mut candidate = files();
            let mut manifest: Value = serde_json::from_str(&candidate["project.json"]).unwrap();
            manifest["format"]["minimumReaderVersion"] = version.into();
            candidate.insert("project.json".into(), manifest.to_string());
            assert_eq!(validate_files(&candidate).is_ok(), version != "0.9.0");
        }
    }
    #[test]
    fn native_archive_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.blocky");
        save_archive(&path, &files()).unwrap();
        assert_eq!(read_archive(&path).unwrap(), files());
        save_archive(&path, &files()).unwrap();
        assert_eq!(read_archive(&path).unwrap(), files());
    }
    #[test]
    fn legacy_archives_are_only_available_at_explicit_migration_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.blocky");
        let mut legacy = files();
        *legacy.get_mut("project.json").unwrap() =
            legacy["project.json"].replace("blocky.project/v1", "blocky.project/v1alpha1");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, contents) in &legacy {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(contents.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(read_archive(&path).is_err());
        assert_eq!(read_migration_archive(&path).unwrap(), legacy);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    #[test]
    fn creation_never_overwrites_an_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.blocky");
        std::fs::write(&path, b"original").unwrap();
        assert_eq!(
            create_archive(&path, &files()).unwrap_err(),
            "BLK-CONFLICT-001"
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let new_path = dir.path().join("new.blocky");
        create_archive(&new_path, &files()).unwrap();
        assert_eq!(read_archive(&new_path).unwrap(), files());
    }
    #[test]
    fn failed_commit_preserves_existing_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.blocky");
        std::fs::write(&path, b"original").unwrap();
        assert!(save_with_check(&path, &files(), || Err("injected disk failure".into())).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn undeclared_files_and_secrets_rejected() {
        let mut f = files();
        f.insert("terminal-history.json".into(), "{}".into());
        assert!(validate_files(&f).is_err());
        let mut g = files();
        g.insert(
            "workspaces/main.json".into(),
            r#"{"apiKey":"FICTIONAL_VALUE"}"#.into(),
        );
        assert!(validate_files(&g).is_err());
    }
    #[test]
    fn traversal_missing_workspaces_and_unknown_version_rejected() {
        for bad in [
            "../secret.json",
            "C:/secret.json",
            "workspaces/NUL.json",
            "workspaces/main.json.",
        ] {
            let mut f = files();
            f.insert(bad.into(), "{}".into());
            assert!(validate_files(&f).is_err());
        }
        let mut missing = files();
        missing.remove("workspaces/main.json");
        assert!(validate_files(&missing).is_err());
        let mut newer = files();
        let v = newer.get_mut("project.json").unwrap();
        *v = v.replace("blocky.project/v1", "blocky.project/v2");
        assert!(validate_files(&newer).is_err());
    }
    #[test]
    fn generic_credential_fields_are_rejected_but_references_remain_valid() {
        for key in [
            "token",
            "SECRET",
            "access_token",
            "client-secret",
            "credential",
            "credentials",
        ] {
            let value = serde_json::json!({"definition": { key: "FICTIONAL_SECRET_VALUE" }});
            assert_eq!(check_secrets(&value, 0).unwrap_err(), "BLK-SECRET-001");
        }
        assert!(check_secrets(&serde_json::json!({"secretRefs":["secret-reference"], "secretBindings":[{"fieldId":"key","secretRef":"secret-reference"}]}), 0).is_ok());
    }
}
