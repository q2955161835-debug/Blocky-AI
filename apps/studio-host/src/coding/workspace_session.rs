use super::{CodingHost, workspace::WorkspaceRequest};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::io::{BufRead,Read,Write};

fn dispatch(host: &CodingHost, value: Value) -> Result<Value,String> {
    if value["schemaVersion"]!="blocky.project-io/v1alpha1" { return Err("BLK-CODING-INPUT".into()); }
    match value["operation"].as_str() {
        Some("workspace-bind") => {
            super::fields(&value,&["schemaVersion","operation","projectId","path"])?;
            host.grant_project(super::text(&value,"projectId")?,std::path::Path::new(super::text(&value,"path")?))
        }
        Some("workspace-status") => { super::fields(&value,&["schemaVersion","operation","projectId"])?; host.workspace_status(super::text(&value,"projectId")?) }
        Some("workspace-call") => { super::fields(&value,&["schemaVersion","operation","request"])?; host.workspace_call(serde_json::from_value::<WorkspaceRequest>(value["request"].clone()).map_err(|_|"BLK-CODING-INPUT")?) }
        _ => Err("BLK-CODING-INPUT".into()),
    }
}

/** One private CLI stdio session owns its directory binding and undo journal. EOF cancels active checks. */
pub fn main() -> i32 {
    let host= CodingHost::default(); let watch=host.clone();
    let (send,receive)=std::sync::mpsc::sync_channel(4);
    std::thread::spawn(move || {
        let mut input=std::io::stdin().lock();
        loop {
            let mut bytes=Vec::new();
            let read=Read::by_ref(&mut input).take(2*1024*1024+1).read_until(b'\n',&mut bytes);
            if matches!(read,Ok(0)) || read.is_err() || bytes.len()>2*1024*1024 || !bytes.ends_with(b"\n") { break; }
            let Ok(value)=crate::strict_json::parse(&bytes) else { break; };
            if value["operation"]=="workspace-cancel" {
                if value["schemaVersion"]=="blocky.project-io/v1alpha1" && super::fields(&value,&["schemaVersion","operation","requestId"]).is_ok() { if let Some(id)=value["requestId"].as_str(){let _=watch.cancel(id);} }
            } else if send.send(value).is_err() { break; }
        }
        let _=watch.shutdown();
    });
    let mut output=std::io::stdout().lock();
    for value in receive {
        let reply=super::native_reply(dispatch(&host,value));
        if writeln!(output,"{reply}").is_err() || output.flush().is_err() { let _=host.shutdown(); return 3; }
    }
    let _=host.shutdown(); 0
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn binding_is_project_scoped_and_edits_are_real_versioned_and_reversible() {
        let host=CodingHost::default(); let dir=tempfile::tempdir().unwrap();
        host.grant_project("workspace-test",dir.path()).unwrap();
        let call=|id:&str,operation:&str,input:Value|host.workspace_call(WorkspaceRequest{schema_version:"blocky.workspace-request/v1".into(),project_id:"workspace-test".into(),request_id:id.into(),operation:operation.into(),input});
        let written=call("write-one","write",json!({"path":"report.txt","text":"real report","expectedDigest":""})).unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("report.txt")).unwrap(),"real report");
        assert_eq!(call("read-one","read",json!({"path":"report.txt"})).unwrap()["text"],"real report");
        assert_eq!(call("list-one","list",json!({})).unwrap()["changes"][0]["changeId"],written["change"]["changeId"]);
        assert!(call("bad-path","read",json!({"path":"../report.txt"})).is_err());
        assert!(call("stale-write","write",json!({"path":"report.txt","text":"bad","expectedDigest":"0000000000000000000000000000000000000000000000000000000000000000"})).is_err());
        call("undo-one","undo",json!({"changeId":written["change"]["changeId"]})).unwrap();
        assert!(!dir.path().join("report.txt").exists());
        assert_eq!(host.workspace_status("other-project").unwrap()["available"],false);
    }
    #[test] fn oversized_runtime_diffs_are_rejected_before_any_write() {
        let host=CodingHost::default();let dir=tempfile::tempdir().unwrap();
        host.grant_project("bounded-project",dir.path()).unwrap();
        let call=|id:&str,input:Value|host.workspace_call(WorkspaceRequest{schema_version:"blocky.workspace-request/v1".into(),project_id:"bounded-project".into(),request_id:id.into(),operation:"write".into(),input});
        assert_eq!(call("new-too-large",json!({"path":"large.txt","text":"汉".repeat(16000),"expectedDigest":""})).unwrap_err(),"BLK-TOOL-LIMIT");
        assert!(!dir.path().join("large.txt").exists());
        let original="a".repeat(40000);std::fs::write(dir.path().join("existing.txt"),&original).unwrap();
        assert_eq!(call("existing-too-large",json!({"path":"existing.txt","text":"small","expectedDigest":super::super::files::digest(&original)})).unwrap_err(),"BLK-TOOL-LIMIT");
        assert_eq!(std::fs::read_to_string(dir.path().join("existing.txt")).unwrap(),original);
        assert!(host.workspace_status("bounded-project").unwrap()["changes"].as_array().unwrap().is_empty());
    }
}
