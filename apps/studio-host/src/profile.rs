//! Native startup selection. Never accept profile paths from WebView requests.
use sha2::{Digest, Sha256};
use std::{ffi::{OsStr, OsString}, path::{Component, Path, PathBuf, Prefix}};
use tauri::Manager;

const ERROR: &str = "BLK-PROFILE-001";
pub const VARIABLE: &str = "BLOCKY_PROFILE_DIR";
pub struct DataRoot(pub PathBuf);

pub fn prepare(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.as_os_str().len() > 4096 { return Err(ERROR.into()); }
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)))
        || path.components().any(|c| matches!(c, Component::ParentDir))
        || path.components().any(|c| matches!(c, Component::Normal(s) if s.to_str().is_none_or(|s| s.ends_with(['.', ' ']) || s.contains(':'))))
    { return Err(ERROR.into()); }
    // Reject junction/symlink ancestors so two profiles cannot silently alias.
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                use std::os::windows::fs::MetadataExt;
                if !meta.is_dir() || meta.file_attributes() & 0x400 != 0 { return Err(ERROR.into()); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(ERROR.into()),
        }
    }
    std::fs::create_dir_all(path).map_err(|_| ERROR)?;
    let canonical = std::fs::canonicalize(path).map_err(|_| ERROR)?;
    let mut parts = canonical.components();
    let drive = match parts.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() { Prefix::VerbatimDisk(drive) | Prefix::Disk(drive) => drive, _ => return Err(ERROR.into()) },
        _ => return Err(ERROR.into()),
    };
    let mut normalized = PathBuf::from(format!("{}:\\", drive as char));
    for part in parts { if let Component::Normal(value) = part { normalized.push(value); } }
    Ok(normalized)
}
pub fn from_options(args: impl IntoIterator<Item=OsString>, environment: Option<OsString>) -> Result<Option<PathBuf>, String> {
    let mut selected = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == OsStr::new("--profile-dir") {
            if selected.is_some() { return Err(ERROR.into()); }
            selected = Some(args.next().ok_or(ERROR)?);
        } else if arg.to_str().is_some_and(|s| s.starts_with("--profile-dir=")) {
            if selected.is_some() { return Err(ERROR.into()); }
            selected = Some(OsString::from(&arg.to_str().ok_or(ERROR)?[14..]));
        }
    }
    selected.or(environment).map(|path| prepare(Path::new(&path))).transpose()
}
pub fn from_environment() -> Result<Option<PathBuf>, String> {
    from_options([], std::env::var_os(VARIABLE))
}
pub fn cli_root() -> Result<PathBuf, String> {
    if let Some(root) = from_environment()? { return Ok(root); }
    std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("ai.blocky.studio"))
        .ok_or_else(|| ERROR.into())
}
pub fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.try_state::<DataRoot>().map(|root| root.0.clone()).ok_or_else(|| ERROR.into())
}
pub fn instance_identifier(base: &str, root: &Path) -> String {
    let hash = identity(root);
    format!("{base}.profile-{}", &hash[..20])
}
pub fn identity(root: &Path) -> String {
    format!("{:x}", Sha256::digest(root.as_os_str().to_string_lossy().to_lowercase().as_bytes()))
}
pub fn is_default(root: &Path, identifier: &str) -> bool {
    let Some(base) = dirs::data_local_dir() else { return false; };
    let expected = base.join(identifier);
    match (std::fs::canonicalize(root), std::fs::canonicalize(expected)) {
        (Ok(a), Ok(b)) => a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_profile_never_falls_back_and_paths_are_local() {
        for path in ["", "relative", "D:relative", r"\\server\share", r"D:\parent\..\child", r"D:\name."] {
            assert!(prepare(Path::new(path)).is_err());
        }
        assert!(from_options(["--profile-dir".into()], None).is_err());
        let workspace=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/profile-tests");
        std::fs::create_dir_all(&workspace).unwrap();
        let dir=tempfile::tempdir_in(&workspace).unwrap();
        // Use a normal drive path as caller input, not canonicalize's verbatim form.
        let input=std::path::absolute(dir.path()).unwrap();
        let a=input.join("a"); let b=input.join("b");
        let selected=from_options(["--profile-dir".into(),a.as_os_str().to_owned()],Some(b.as_os_str().to_owned())).unwrap().unwrap();
        assert_eq!(selected,prepare(&a).unwrap());
        assert_eq!(prepare(&selected).unwrap(),selected);
        assert!(!b.exists());
        let other=prepare(&b).unwrap();
        assert_ne!(instance_identifier("ai.blocky.studio",&selected),instance_identifier("ai.blocky.studio",&other));
        assert!(from_options(["--profile-dir".into(),a.into_os_string(),"--profile-dir".into(),b.into_os_string()],None).is_err());
        assert!(from_options([], Some("relative".into())).is_err());
    }
}
