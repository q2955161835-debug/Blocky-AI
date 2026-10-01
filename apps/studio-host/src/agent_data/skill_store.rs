//! Profile-scoped inert Skill bytes. Callers hold their AgentData authorization/cancellation
//! lock across `manage`; this module neither authorizes nor executes any tool or script.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, io::{Read, Write}, path::Path, time::{SystemTime, UNIX_EPOCH}};
const INVALID: &str = "BLK-SKILL-INVALID";
const IO: &str = "BLK-SKILL-IO";
const LIMIT: &str = "BLK-SKILL-LIMIT";
const CONFLICT: &str = "BLK-SKILL-CONFLICT";
const FILE_LIMIT: usize = 524288;
const SKILL_LIMIT: usize = 2097152;
const TOTAL_LIMIT: usize = 16777216;
fn id(s: &str) -> bool { s.len() <= 128 && !s.is_empty() && s.as_bytes()[0].is_ascii_lowercase()
    && s.split(['.', '_', '-']).all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())) }
fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn hash(s: &str) -> bool { s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }
pub fn valid_path(s: &str) -> bool {
    !s.is_empty() && s.len() <= 240 && s.split('/').all(|p| {
        let stem = p.split('.').next().unwrap_or("").to_ascii_lowercase();
        !p.is_empty() && p.as_bytes()[0].is_ascii_alphanumeric() && !p.ends_with('.')
            && p.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            && !["con", "prn", "aux", "nul"].contains(&stem.as_str())
            && !(stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && (b'1'..=b'9').contains(&stem.as_bytes()[3]))
    })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Metadata { pub schema_version: String, pub skill_id: String, pub version: String, pub name: String, pub summary: String, pub tool_ids: Vec<String> }
impl Metadata {
    pub fn validate(&self) -> Result<(), String> {
        let version = regex::Regex::new(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$").map_err(|_| INVALID)?;
        if self.schema_version != "blocky.skill/v1" || !id(&self.skill_id) || self.version.len()>64 || !version.is_match(&self.version)
            || self.name.is_empty() || self.name.len()>128 || self.summary.is_empty() || self.summary.len()>2048
            || self.name.chars().chain(self.summary.chars()).any(|c| c == '\0') || self.tool_ids.len()>32
            || self.tool_ids.iter().any(|v| !id(v)) || self.tool_ids.iter().collect::<BTreeSet<_>>().len()!=self.tool_ids.len() { return Err(INVALID.into()); }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SkillFile { pub path: String, pub sha256: String, pub bytes: Vec<u8> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SkillRequest {
    pub schema_version: String, pub request_id: String, pub project_id: String, pub session_id: String, pub action: String,
    #[serde(default, skip_serializing_if="Option::is_none")] pub skill_id: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub expected_digest: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub metadata: Option<Metadata>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub files: Option<Vec<SkillFile>>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub path: Option<String>,
}
impl SkillRequest {
    pub fn validate(&self) -> Result<(), String> {
        let install = self.action == "install";
        let existing = ["load", "read-resource", "uninstall"].contains(&self.action.as_str());
        if self.schema_version != "blocky.skill-request/v1" || !id(&self.request_id) || !id(&self.project_id) || !id(&self.session_id)
            || !(install || existing || self.action == "discover") || existing != self.skill_id.is_some() || existing != self.expected_digest.is_some()
            || install != self.metadata.is_some() || install != self.files.is_some() || (self.action == "read-resource") != self.path.is_some()
            || self.skill_id.as_ref().is_some_and(|v| !id(v)) || self.expected_digest.as_ref().is_some_and(|v| !hash(v))
            || self.path.as_ref().is_some_and(|v| !valid_path(v)) { return Err(INVALID.into()); }
        if install { validate_package(self.metadata.as_ref().unwrap(), self.files.as_ref().unwrap())?; }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(json!({"requestDigest":sha(&serde_json::to_vec(self).map_err(|_| INVALID)?),"projectId":self.project_id,"sessionId":self.session_id,
            "action":self.action,"skillId":self.skill_id.as_ref().or(self.metadata.as_ref().map(|m| &m.skill_id)),"metadata":self.metadata,
            "totalBytes":self.files.as_ref().map(|files| files.iter().map(|f| f.bytes.len()).sum::<usize>())}))
    }
}
fn validate_package(metadata: &Metadata, files: &[SkillFile]) -> Result<(), String> {
    metadata.validate()?;
    if files.is_empty() || files.len()>128 || files.iter().map(|f| f.bytes.len()).sum::<usize>()>SKILL_LIMIT { return Err(LIMIT.into()); }
    let mut paths = BTreeSet::new();
    for f in files {
        if !valid_path(&f.path) || !hash(&f.sha256) || !paths.insert(f.path.to_ascii_lowercase()) { return Err(INVALID.into()); }
        if f.bytes.len()>FILE_LIMIT { return Err(LIMIT.into()); }
        if sha(&f.bytes)!=f.sha256 { return Err("BLK-SKILL-INTEGRITY".into()); }
    }
    let body = files.iter().find(|f| f.path == "SKILL.md").ok_or(INVALID)?;
    let text = std::str::from_utf8(&body.bytes).map_err(|_| INVALID)?;
    if text.is_empty() || text.contains('\0') { return Err(INVALID.into()); }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Package { metadata: Metadata, files: Vec<SkillFile>, digest: String, installed_at: u64 }
impl Package {
    fn digest(metadata: &Metadata, files: &[SkillFile]) -> Result<String, String> {
        let mut sorted = files.to_vec(); sorted.sort_by(|a,b| a.path.cmp(&b.path));
        Ok(sha(&serde_json::to_vec(&(metadata, sorted)).map_err(|_| INVALID)?))
    }
    fn summary(&self) -> Value { json!({"metadata":self.metadata,"digest":self.digest,"installedAt":self.installed_at,
        "totalBytes":self.files.iter().map(|f| f.bytes.len()).sum::<usize>(),
        "files":self.files.iter().map(|f| json!({"path":f.path,"sha256":f.sha256,"byteLength":f.bytes.len()})).collect::<Vec<_>>()}) }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Store { schema_version: String, skills: BTreeMap<String, Package> }
fn regular(path: &Path) -> Result<(), String> {
    for p in path.ancestors() {
        match std::fs::symlink_metadata(p) {
            Ok(m) => {
                if m.file_type().is_symlink() { return Err("BLK-PERM-001".into()); }
                #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if m.file_attributes() & 0x400 != 0 { return Err("BLK-PERM-001".into()); } }
            },
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => {},
            Err(_) => return Err(IO.into()),
        }
    }
    Ok(())
}
fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    regular(path)?;
    if !std::fs::metadata(path).map_err(|_| IO)?.is_file() { return Err(INVALID.into()); }
    let mut bytes=Vec::new(); std::fs::File::open(path).map_err(|_| IO)?.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|_| IO)?;
    if bytes.len()>limit { return Err(LIMIT.into()); } Ok(bytes)
}
/// Native picker/CLI installation only. Never expose this path API to Runtime/WebView.
/// `blocky-skill.json` is the typed metadata + declared relative file/hash manifest.
pub fn read_native_directory(path: &Path) -> Result<(Metadata, Vec<SkillFile>), String> {
    #[derive(Deserialize)] #[serde(rename_all="camelCase", deny_unknown_fields)]
    struct Manifest { metadata: Metadata, files: Vec<FileRef> }
    #[derive(Deserialize)] #[serde(rename_all="camelCase", deny_unknown_fields)]
    struct FileRef { path: String, sha256: String }
    if !path.is_absolute() || path.components().any(|c| matches!(c,std::path::Component::ParentDir)) { return Err(INVALID.into()); }
    regular(path)?;
    let manifest: Manifest=serde_json::from_slice(&read_bounded(&path.join("blocky-skill.json"), 32768)?).map_err(|_| INVALID)?;
    manifest.metadata.validate()?;
    if manifest.files.is_empty() || manifest.files.len()>128 { return Err(LIMIT.into()); }
    let mut files=Vec::new(); let mut total=0;
    for entry in manifest.files {
        if !valid_path(&entry.path) { return Err(INVALID.into()); }
        let bytes=read_bounded(&path.join(&entry.path), FILE_LIMIT)?; total+=bytes.len();
        if total>SKILL_LIMIT { return Err(LIMIT.into()); }
        files.push(SkillFile {path:entry.path,sha256:entry.sha256,bytes});
    }
    validate_package(&manifest.metadata,&files)?; Ok((manifest.metadata,files))
}
/// Authorization and mutual exclusion belong to AgentData; caller must hold that lock.
pub fn manage(root: &Path, request: &SkillRequest) -> Result<Value, String> {
    request.validate()?;
    let directory=root.join("agent-skills"); let path=directory.join("store.json"); regular(&path)?;
    std::fs::create_dir_all(&directory).map_err(|_|IO)?;regular(&directory)?;
    let lock_path=directory.join("store.lock");regular(&lock_path)?;
    let lock=std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&lock_path).map_err(|_|IO)?;
    lock.try_lock().map_err(|_|"BLK-SKILL-BUSY")?;
    let mut store = if path.exists() {
        serde_json::from_slice::<Store>(&read_bounded(&path,TOTAL_LIMIT*5+1048576)?).map_err(|_| INVALID)?
    } else { Store {schema_version:"blocky.skill-store/v1".into(),skills:BTreeMap::new()} };
    if store.schema_version!="blocky.skill-store/v1" { return Err(INVALID.into()); }
    if store.skills.len()>64 { return Err(LIMIT.into()); }
    let mut total=0;
    for (key,p) in &store.skills {
        validate_package(&p.metadata,&p.files)?;
        if key!=&p.metadata.skill_id || p.digest!=Package::digest(&p.metadata,&p.files)? { return Err("BLK-SKILL-INTEGRITY".into()); }
        total+=p.files.iter().map(|f| f.bytes.len()).sum::<usize>();
    }
    if total>TOTAL_LIMIT { return Err(LIMIT.into()); }
    if request.action=="discover" { return Ok(json!({"action":"discover","skills":store.skills.values().map(Package::summary).collect::<Vec<_>>()})); }
    let result=if request.action=="install" {
        let metadata=request.metadata.clone().unwrap(); let files=request.files.clone().unwrap();
        if store.skills.contains_key(&metadata.skill_id) { return Err(CONFLICT.into()); }
        if store.skills.len()>=64 || total+files.iter().map(|f| f.bytes.len()).sum::<usize>()>TOTAL_LIMIT { return Err(LIMIT.into()); }
        let package=Package {digest:Package::digest(&metadata,&files)?,metadata,files,installed_at:SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| IO)?.as_secs()};
        let summary=package.summary(); store.skills.insert(package.metadata.skill_id.clone(),package); json!({"action":"install","skill":summary})
    } else {
        let key=request.skill_id.as_ref().unwrap(); let p=store.skills.get(key).ok_or("BLK-SKILL-NOT-FOUND")?;
        if Some(&p.digest)!=request.expected_digest.as_ref() { return Err(CONFLICT.into()); }
        match request.action.as_str() {
            "load" => return Ok(json!({"action":"load","skill":p.summary(),"body":std::str::from_utf8(&p.files.iter().find(|f| f.path=="SKILL.md").ok_or(INVALID)?.bytes).map_err(|_| INVALID)?})),
            "read-resource" => return Ok(json!({"action":"read-resource","skillId":key,"digest":p.digest,"file":p.files.iter().find(|f| Some(&f.path)==request.path.as_ref()).ok_or("BLK-SKILL-NOT-FOUND")?})),
            "uninstall" => { store.skills.remove(key); json!({"action":"uninstall","ok":true}) },
            _ => return Err(INVALID.into()),
        }
    };
    std::fs::create_dir_all(&directory).map_err(|_| IO)?; regular(&path)?;
    let bytes=serde_json::to_vec(&store).map_err(|_| INVALID)?;
    if bytes.len()>TOTAL_LIMIT*5+1048576 { return Err(LIMIT.into()); }
    let mut temp=tempfile::NamedTempFile::new_in(&directory).map_err(|_| IO)?;
    temp.write_all(&bytes).map_err(|_| IO)?; temp.as_file().sync_all().map_err(|_| IO)?;
    temp.persist(&path).map_err(|_| IO)?; Ok(result)
}
