//! One atomic project memory ledger. Search is rebuilt from authorized live entries.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};
const SCHEMA: &str = "blocky.memory-store/v2";
const CONFLICT: &str = "BLK-MEMORY-CONFLICT";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub version: u64,
    #[serde(default, deserialize_with = "present_value", skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    pub source_ref: Option<String>,
    pub summary: String,
    pub summary_kind: String,
    pub updated_at: u64,
    pub expires_at: Option<u64>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: String,
    entries: BTreeMap<String, Entry>,
    revoked_sources: BTreeSet<String>,
    #[serde(skip)]
    denied_sources: BTreeSet<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManageRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, deserialize_with = "present_value", skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_policy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}
fn source_valid(v: &str) -> bool {
    !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control)
        && !v.contains('\\') && !v.contains("..") && !v.contains("://")
}
impl ManageRequest {
    pub fn validate(&self) -> Result<(), String> {
        let upsert = self.action == "upsert";
        let delete = self.action == "delete";
        let search = self.action == "search";
        let source = ["revoke-source", "allow-source", "check-source"].contains(&self.action.as_str());
        if self.schema_version != "blocky.memory-request/v1" || !stable(&self.request_id)
            || !stable(&self.project_id) || !stable(&self.session_id)
            || !["read", "upsert", "delete", "search", "revoke-source", "allow-source", "check-source"].contains(&self.action.as_str())
            || ((!search && !source) != self.key.is_some()) || self.key.as_ref().is_some_and(|s| !stable(s))
            || upsert != self.value.is_some() || (upsert || delete) != self.expected_version.is_some()
            || upsert != self.conflict_policy.is_some()
            || self.conflict_policy.as_ref().is_some_and(|s| !["replace", "merge", "reject"].contains(&s.as_str()))
            || self.source_ref.as_ref().is_some_and(|s| !source_valid(s)) || (source && self.source_ref.is_none())
            || (!upsert && !source && self.source_ref.is_some())
            || (!upsert && (self.summary.is_some() || self.ttl_seconds.is_some()))
            || self.summary.as_ref().is_some_and(|s| s.len() > 2048 || s.chars().any(|c| c == '\0'))
            || self.ttl_seconds.is_some_and(|s| s > 3_153_600_000)
            || (!search && (self.query.is_some() || self.limit.is_some()))
            || self.query.as_ref().is_some_and(|s| s.len() > 1024)
            || self.limit.is_some_and(|s| !(1..=100).contains(&s))
        { return Err(INVALID.into()); }
        if self.value.as_ref().is_some_and(|v| serde_json::to_vec(v).map_or(true, |b| b.len() > 32768)) {
            return Err("BLK-AGENT-LIMIT".into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(json!({"requestDigest":digest(self)?,"projectId":self.project_id,"sessionId":self.session_id,
            "action":self.action,"key":self.key,"expectedVersion":self.expected_version,
            "valueBytes":self.value.as_ref().map(|v|serde_json::to_vec(v).unwrap_or_default().len()).unwrap_or(0)}))
    }
}
fn now() -> Result<u64, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "BLK-AGENT-IO")?.as_secs())
}
fn regular(path: &std::path::Path) -> Result<(), String> {
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() { return Err(PERMISSION.into()); }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 { return Err(PERMISSION.into()); }
        }
    }
    Ok(())
}
fn load(file: &std::path::Path) -> Result<Store, String> {
    let mut store = Store { schema_version: SCHEMA.into(), entries: BTreeMap::new(), revoked_sources: BTreeSet::new(), denied_sources: BTreeSet::new() };
    if !file.exists() { return Ok(store); }
    regular(file)?;
    if std::fs::metadata(file).map_err(|_| "BLK-AGENT-IO")?.len() > 1024 * 1024 { return Err("BLK-AGENT-LIMIT".into()); }
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(file).map_err(|_| "BLK-AGENT-IO")?.take(1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "BLK-AGENT-IO")?;
    if bytes.len() > 1024 * 1024 { return Err("BLK-AGENT-LIMIT".into()); }
    let value = crate::strict_json::parse(&bytes).map_err(|_| "BLK-AGENT-IO")?;
    if value["schemaVersion"] == SCHEMA {
        store = serde_json::from_value(value).map_err(|_| "BLK-AGENT-IO")?;
    } else {
        // Legacy project KV values remain byte-for-byte equivalent at the API.
        for (key, value) in value.as_object().ok_or("BLK-AGENT-IO")? {
            store.entries.insert(key.clone(), entry(value.clone(), 1, None, None, None, 0)?);
        }
    }
    if store.entries.len() > 4096 || store.revoked_sources.len() > 4096 || store.schema_version != SCHEMA
        || store.entries.iter().any(|(key,e)| !stable(key) || e.version == 0 || e.summary.len() > 2048
            || !["extract", "manual"].contains(&e.summary_kind.as_str())
            || e.source_ref.as_ref().is_some_and(|s| !source_valid(s))
            || e.value.as_ref().is_some_and(|v| serde_json::to_vec(v).map_or(true, |b| b.len() > 32768)))
        || store.revoked_sources.iter().any(|s| !source_valid(s)) { return Err("BLK-AGENT-IO".into()); }
    Ok(store)
}
fn entry(value: Value, version: u64, source_ref: Option<String>, summary: Option<String>, ttl: Option<u64>, time: u64) -> Result<Entry, String> {
    if serde_json::to_vec(&value).map_or(true, |b| b.len() > 32768) { return Err("BLK-AGENT-LIMIT".into()); }
    let summary_kind = if summary.is_some() { "manual" } else { "extract" }.into();
    let summary = summary.unwrap_or_else(|| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()).chars().take(256).collect());
    Ok(Entry { version, value: Some(value), source_ref, summary, summary_kind, updated_at: time,
        expires_at: match ttl { Some(0) | None => None, Some(ttl) => Some(time.checked_add(ttl).ok_or(INVALID)?) } })
}
fn live(e: &Entry, store: &Store, time: u64) -> bool {
    e.value.is_some() && e.expires_at.is_none_or(|t| t > time) && e.source_ref.as_ref().is_none_or(|s| !store.revoked_sources.contains(s) && !store.denied_sources.contains(s))
}
/// A knowledge-derived memory cannot outlive the native source's current ACL.
fn source_head(root: &std::path::Path, project: &str, source: &str) -> Result<Option<Value>, String> {
    if !source.starts_with("knowledge/") { return Ok(None); }
    let parts=source.split('/').collect::<Vec<_>>();
    if parts.len()!=3 || !stable(parts[1]) || !stable(parts[2]) { return Err(INVALID.into()); }
    let profile=root.parent().and_then(std::path::Path::parent).ok_or(INVALID)?;
    let store=crate::knowledge::KnowledgeStore::new(profile.join("knowledge"));
    let head=store.sources(project,parts[1])?;
    let allowed=head["sources"].as_array().is_some_and(|sources|sources.iter().any(|s|s["sourceId"]==parts[2]&&s["readable"]==true));
    Ok(Some(json!({"readable":allowed,"revision":head["revision"],"generation":head["generation"]})))
}
fn transaction(root: &std::path::Path, project: &str, incoming_source: Option<&String>, f: impl FnOnce(&mut Store, u64) -> Result<(Value,bool),String>) -> Result<Value,String> {
    regular(root)?;
    std::fs::create_dir_all(root).map_err(|_| "BLK-AGENT-IO")?;
    crate::knowledge::no_links(root).map_err(|_| PERMISSION)?;
    regular(&root.join("memory.lock"))?;
    let lock = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(root.join("memory.lock")).map_err(|_| "BLK-AGENT-IO")?;
    lock.try_lock().map_err(|_| "BLK-AGENT-BUSY")?;
    let file = root.join(format!("{project}.json"));
    let mut store = load(&file)?;
    let mut sources=store.entries.values().filter_map(|e|e.source_ref.clone()).collect::<BTreeSet<_>>();
    if let Some(source)=incoming_source {sources.insert(source.clone());}
    let mut snapshots=BTreeMap::new();
    for source in sources {
        let head=source_head(root,project,&source)?;
        if head.as_ref().is_some_and(|v|v["readable"]!=true) {store.denied_sources.insert(source.clone());}
        snapshots.insert(source,head);
    }
    let (result,changed) = f(&mut store, now()?)?;
    for (source,head) in snapshots {
        if source_head(root,project,&source)?!=head {return Err(CONFLICT.into());}
    }
    if changed {
        let bytes = serde_json::to_vec(&store).map_err(|_| INVALID)?;
        if bytes.len() > 1024 * 1024 || store.entries.len() > 4096 || store.revoked_sources.len() > 4096 { return Err("BLK-AGENT-LIMIT".into()); }
        let mut temp = tempfile::NamedTempFile::new_in(root).map_err(|_| "BLK-AGENT-IO")?;
        temp.write_all(&bytes).and_then(|_|temp.as_file().sync_all()).map_err(|_| "BLK-AGENT-IO")?;
        temp.persist(&file).map_err(|_| "BLK-AGENT-IO")?;
    }
    Ok(result)
}
pub(super) fn legacy(root: &std::path::Path, r: &MemoryRequest) -> Result<Value,String> {
    transaction(root, &r.project_id, None, |s,time| {
        let old = s.entries.get(&r.key);
        if r.action == "read" {
            let e = old.filter(|e|live(e,s,time));
            return Ok((json!({"found":e.is_some(),"value":e.and_then(|e|e.value.as_ref())}),false));
        }
        let version = old.map_or(0,|e|e.version).checked_add(1).ok_or(CONFLICT)?;
        let next = if r.action == "write" { entry(r.value.clone().ok_or(INVALID)?,version,None,None,None,time)? }
            else { Entry { version, value: None, source_ref: None, summary: String::new(), summary_kind: "extract".into(), updated_at: time, expires_at: None } };
        s.entries.insert(r.key.clone(),next);
        Ok((json!({"ok":true}),true))
    })
}
pub(super) fn manage(root: &std::path::Path, r: &ManageRequest) -> Result<Value,String> {
    if r.action=="upsert" && r.source_ref.as_ref().map(|source|source_head(root,&r.project_id,source)).transpose()?.flatten().is_some_and(|v|v["readable"]!=true) {return Err(PERMISSION.into());}
    transaction(root, &r.project_id, r.source_ref.as_ref(), |s,time| {
        if r.action=="check-source" {
            let source=r.source_ref.as_ref().ok_or(INVALID)?;
            return Ok((json!({"readable":!s.revoked_sources.contains(source)&&!s.denied_sources.contains(source)}),false));
        }
        if ["revoke-source","allow-source"].contains(&r.action.as_str()) {
            let source = r.source_ref.clone().ok_or(INVALID)?;
            if r.action == "revoke-source" { s.revoked_sources.insert(source.clone());
                // Permanently remove payloads. Regrant cannot resurrect revoked content.
                for e in s.entries.values_mut().filter(|e|e.source_ref.as_ref()==Some(&source)) {
                    e.version = e.version.checked_add(1).ok_or(CONFLICT)?; e.value=None; e.summary.clear();
                }
            } else { s.revoked_sources.remove(&source); }
            return Ok((json!({"ok":true}),true));
        }
        if r.action == "search" {
            let terms:Vec<String> = r.query.as_deref().unwrap_or("").split_whitespace().map(str::to_lowercase).collect();
            let entries:Vec<Value> = s.entries.iter().filter(|(_,e)|live(e,s,time)).filter(|(key,e)| {
                let text=format!("{} {} {}",key,e.summary,e.value.as_ref().unwrap()).to_lowercase();
                terms.iter().all(|term|text.contains(term))
            }).take(r.limit.unwrap_or(20)).map(|(key,e)|json!({"key":key,"entry":e})).collect();
            return Ok((json!({"entries":entries,"time":time}),false));
        }
        let key=r.key.as_ref().ok_or(INVALID)?;
        let old=s.entries.get(key);
        let version=old.map_or(0,|e|e.version);
        if r.action=="read" {
            return Ok((json!({"found":old.is_some_and(|e|live(e,s,time)),"version":version,"entry":old.filter(|e|live(e,s,time))}),false));
        }
        if r.expected_version != Some(version) { return Err(CONFLICT.into()); }
        let next_version=version.checked_add(1).ok_or(CONFLICT)?;
        if r.action=="delete" {
            s.entries.insert(key.clone(),Entry {version:next_version,value:None,source_ref:None,summary:String::new(),summary_kind:"extract".into(),updated_at:time,expires_at:None});
            return Ok((json!({"ok":true,"version":next_version}),true));
        }
        if r.source_ref.as_ref().is_some_and(|source|s.revoked_sources.contains(source) || s.denied_sources.contains(source)) { return Err(PERMISSION.into()); }
        let mut value=r.value.clone().ok_or(INVALID)?;
        let policy=r.conflict_policy.as_deref().ok_or(INVALID)?;
        if policy=="reject" && old.is_some_and(|e|live(e,s,time)) { return Err(CONFLICT.into()); }
        if policy=="merge" {
            let incoming=value.as_object().ok_or(INVALID)?.clone();
            let mut merged=match old.filter(|e|live(e,s,time)) {Some(e)=>e.value.as_ref().and_then(Value::as_object).ok_or(INVALID)?.clone(),None=>Map::new()};
            merged.extend(incoming); value=Value::Object(merged);
        }
        let e=entry(value,next_version,r.source_ref.clone(),r.summary.clone(),r.ttl_seconds,time)?;
        let result=json!({"ok":true,"entry":e}); s.entries.insert(key.clone(),e);
        Ok((result,true))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(action:&str)->ManageRequest {
        serde_json::from_value(json!({"schemaVersion":"blocky.memory-request/v1","requestId":"request-one","projectId":"project-one","sessionId":"run-one","action":action})).unwrap()
    }
    #[test]
    fn cas_search_revoke_and_legacy_reload() {
        let (_tmp,host)=super::super::tests::fixture();
        let token=host.authorize("project-one","run-one").unwrap();
        let mut r=request("upsert"); r.key=Some("prefs".into());r.value=Some(json!({"language":"中文"}));r.expected_version=Some(0);r.conflict_policy=Some("replace".into());r.source_ref=Some("notes".into());
        assert_eq!(host.manage_memory(&token,&r).unwrap()["entry"]["version"],1);
        assert_eq!(host.manage_memory(&token,&r).unwrap_err(),CONFLICT);
        r.expected_version=Some(1);r.conflict_policy=Some("merge".into());r.value=Some(json!({"theme":"dark"}));
        assert_eq!(host.manage_memory(&token,&r).unwrap()["entry"]["value"]["language"],"中文");
        let mut s=request("search");s.query=Some("中文 dark".into());
        assert_eq!(host.manage_memory(&token,&s).unwrap()["entries"].as_array().unwrap().len(),1);
        let fresh=AgentData::new(host.root.clone());let t=fresh.authorize("project-one","run-one").unwrap();
        assert_eq!(fresh.manage_memory(&t,&s).unwrap()["entries"].as_array().unwrap().len(),1);
        let mut revoke=request("revoke-source");revoke.source_ref=Some("notes".into());fresh.manage_memory(&t,&revoke).unwrap();
        assert!(host.manage_memory(&token,&s).unwrap()["entries"].as_array().unwrap().is_empty());
        revoke.action="allow-source".into();fresh.manage_memory(&t,&revoke).unwrap();
        assert!(host.manage_memory(&token,&s).unwrap()["entries"].as_array().unwrap().is_empty());
        s.project_id="other-project".into();assert_eq!(host.manage_memory(&token,&s).unwrap_err(),PERMISSION);
    }
    #[test]
    fn stored_json_null_is_live_after_reload_not_a_tombstone() {
        let (_tmp,host)=super::super::tests::fixture();let token=host.authorize("project-one","run-one").unwrap();
        let mut r=request("upsert");r.key=Some("nullable".into());r.value=Some(Value::Null);r.expected_version=Some(0);r.conflict_policy=Some("replace".into());
        host.manage_memory(&token,&r).unwrap();r=request("read");r.key=Some("nullable".into());
        assert_eq!(host.manage_memory(&token,&r).unwrap()["found"],true);
        r.action="delete".into();r.expected_version=Some(1);host.manage_memory(&token,&r).unwrap();
        r=request("read");r.key=Some("nullable".into());assert_eq!(host.manage_memory(&token,&r).unwrap()["found"],false);
    }
    #[test]
    fn knowledge_acl_changes_filter_stored_memories_before_read_and_search() {
        let (tmp,_)=super::super::tests::fixture();let profile=tmp.path().join("profile");
        let host=AgentData::new(profile.join("user/agent-memory"));
        let knowledge=crate::knowledge::KnowledgeStore::new(profile.join("knowledge"));
        let docs=tmp.path().join("public-docs");std::fs::create_dir_all(&docs).unwrap();std::fs::write(docs.join("note.txt"),"public example").unwrap();
        let source=knowledge.add("project-one","notes","directory",docs.to_str().unwrap(),None).unwrap();
        let source_id=source["sourceId"].as_str().unwrap();
        let token=host.authorize("project-one","run-one").unwrap();
        let mut r=request("upsert");r.key=Some("derived".into());r.value=Some(json!("public derived fact"));r.expected_version=Some(0);r.conflict_policy=Some("replace".into());r.source_ref=Some(format!("knowledge/notes/{source_id}"));
        host.manage_memory(&token,&r).unwrap();
        knowledge.acl("project-one","notes",source_id,vec![]).unwrap();
        r=request("read");r.key=Some("derived".into());assert_eq!(host.manage_memory(&token,&r).unwrap()["found"],false);
        r=request("search");assert!(host.manage_memory(&token,&r).unwrap()["entries"].as_array().unwrap().is_empty());
    }
    #[test]
    fn expiry_bad_write_and_old_kv_migration() {
        let (_tmp,host)=super::super::tests::fixture();std::fs::create_dir_all(&host.root).unwrap();
        std::fs::write(host.root.join("project-one.json"),br#"{"old":"legacy"}"#).unwrap();
        let t=host.authorize("project-one","run-one").unwrap();
        let mut r=request("read");r.key=Some("old".into());
        assert_eq!(host.manage_memory(&t,&r).unwrap()["entry"]["value"],"legacy");
        let mut store=load(&host.root.join("project-one.json")).unwrap();store.entries.get_mut("old").unwrap().expires_at=Some(1);
        std::fs::write(host.root.join("project-one.json"),serde_json::to_vec(&store).unwrap()).unwrap();
        assert_eq!(host.manage_memory(&t,&r).unwrap()["found"],false);
        r.action="upsert".into();r.expected_version=Some(1);r.conflict_policy=Some("replace".into());r.value=Some(json!("x".repeat(32769)));
        assert!(host.manage_memory(&t,&r).is_err());
        r=request("search");assert!(host.manage_memory(&t,&r).unwrap()["entries"].as_array().unwrap().is_empty());
        host.revoke(&t).unwrap();assert_eq!(host.manage_memory(&t,&r).unwrap_err(),PERMISSION);
    }
}
