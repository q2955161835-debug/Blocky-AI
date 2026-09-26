use super::{captures::Store,capture_png,tests::journal_directory};
use serde_json::{Value,json};
use std::{path::Path,process::Command};
fn cli(profile:&Path,args:&[&str])->(bool,Value) {
    use std::os::windows::process::CommandExt;
    let entry=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/blocky-cli/dist/main.mjs");
    let result=Command::new("node").arg(entry).args(args).env(crate::profile::VARIABLE,profile).creation_flags(0x08000000).output().unwrap();
    let output=String::from_utf8(result.stdout).unwrap();
    (result.status.success(),serde_json::from_str(output.lines().last().unwrap_or("{}")).unwrap())
}
#[test]
#[ignore="requires freshly built CLI and debug helper; no windows or input"]
fn capture_cli_exports_encrypted_artifact_without_overwrite_and_deletes() {
    let temp=journal_directory();let root=std::path::absolute(temp.path()).unwrap();let profile=root.join("profile");
    let store=Store::new(profile.join("rpa/captures"));
    let png=capture_png::encode(2,1,&[255,0,0,255,0,0,0,255]).unwrap();
    let meta=store.save("checkpoint-one","test-plan","shot",&png,1).unwrap();
    let (success,list)=cli(&profile,&["rpa","captures","--json"]);assert!(success,"{list}");
    assert_eq!(list["data"]["captures"][0]["captureId"],meta.capture_id);
    let output=root.join("image.png");let path=output.to_str().unwrap();
    let (success,export)=cli(&profile,&["rpa","capture-export",&meta.capture_id,"--output",path,"--json"]);assert!(success,"{export}");
    assert_eq!(std::fs::read(&output).unwrap(),png);
    assert!(!export.to_string().contains("data:image"));
    std::fs::write(&output,b"DO_NOT_REPLACE").unwrap();
    let (success,blocked)=cli(&profile,&["rpa","capture-export",&meta.capture_id,"--output",path,"--json"]);
    assert!(!success);assert_eq!(blocked["error"]["code"],"BLK-CLI-005");assert_eq!(std::fs::read(&output).unwrap(),b"DO_NOT_REPLACE");
    let (success,deleted)=cli(&profile,&["rpa","capture-delete",&meta.capture_id,"--json"]);assert!(success,"{deleted}");assert!(store.list().unwrap().is_empty());
    let (_,missing)=cli(&profile,&["rpa","capture-export",&meta.capture_id,"--output",path,"--json"]);assert_eq!(missing["error"]["code"],"BLK-RPA-CAPTURE-001");
    let (success,empty)=cli(&profile,&["rpa","captures","--json"]);assert!(success);assert_eq!(empty["data"]["captures"],json!([]));
}
