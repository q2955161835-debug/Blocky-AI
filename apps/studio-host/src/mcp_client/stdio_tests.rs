use super::*;
use crate::mcp_client::Client;
// Elevated Windows CI accounts can create directories owned by Administrators.
// This fixture must be owned by the token user before exercising manifest errors.
fn own_fixture_directory(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{Foundation::{CloseHandle, LocalFree}, Security::*,
        Security::Authorization::{GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT},
        System::Threading::{GetCurrentProcess, OpenProcessToken}};
    let mut token = std::ptr::null_mut();
    assert_ne!(unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }, 0);
    let mut size = 0;
    unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size); }
    let mut storage = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    let ok = unsafe { GetTokenInformation(token, TokenUser, storage.as_mut_ptr() as _, size, &mut size) };
    unsafe { CloseHandle(token); }
    assert_ne!(ok, 0);
    let owner = unsafe { (*(storage.as_ptr() as *const TOKEN_USER)).User.Sid };
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut existing_owner = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    assert_eq!(unsafe { GetNamedSecurityInfoW(name.as_ptr(), SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION, &mut existing_owner, std::ptr::null_mut(),
        std::ptr::null_mut(), std::ptr::null_mut(), &mut descriptor) }, 0);
    let already_owned = unsafe { EqualSid(existing_owner, owner) } != 0;
    unsafe { LocalFree(descriptor as _); }
    if already_owned { return; }
    assert_eq!(unsafe { SetNamedSecurityInfoW(name.as_ptr(), SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION, owner, std::ptr::null_mut(),
        std::ptr::null_mut(), std::ptr::null_mut()) }, 0);
}
fn server(code: &str, timeout: u64) -> StdioTransport {
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-capability-upgrade/stdio-tests");
    std::fs::create_dir_all(&base).unwrap();
    let directory = tempfile::tempdir_in(base).unwrap();
    let bundle = directory.path().join("bundle");
    std::fs::create_dir(&bundle).unwrap();
    let node = bundle.join("node.exe");
    std::fs::copy(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/stage5/builder-runtime/node.exe"),
        &node,
    )
    .unwrap();
    let script = bundle.join("server.cjs");
    std::fs::write(&script, code).unwrap();
    let args = vec![
        "--preserve-symlinks-main".into(),
        "--preserve-symlinks".into(),
        script.into_os_string(),
    ];
    let resumed=std::sync::atomic::AtomicBool::new(false);
    let transport=StdioTransport::spawn_tracked(directory,&node,&args,timeout,&resumed).unwrap();
    assert!(resumed.load(std::sync::atomic::Ordering::SeqCst));
    transport
}
#[test]
fn malformed_ownership_manifest_fails_before_the_execution_boundary(){
    let base=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/agent-capability-upgrade/stdio-tests");std::fs::create_dir_all(&base).unwrap();
    let directory=tempfile::tempdir_in(base).unwrap();own_fixture_directory(directory.path());let bundle=directory.path().join("bundle");std::fs::create_dir(&bundle).unwrap();let executable=bundle.join("server.exe");std::fs::write(&executable,b"not launched").unwrap();
    std::fs::write(directory.path().join("sandbox.json"),serde_json::to_vec(&json!({"schemaVersion":"incorrect","profileName":"","bundleFiles":["bundle/server.exe"]})).unwrap()).unwrap();
    let boundary=std::sync::atomic::AtomicBool::new(false);
    let error=StdioTransport::spawn_tracked(directory,&executable,&[],3000,&boundary).err().unwrap();
    assert_eq!(error,"BLK-TOOL-OWNERSHIP-SCHEMA");assert!(!boundary.load(std::sync::atomic::Ordering::SeqCst));
}
#[test]
#[ignore = "real Windows sandbox with the pinned Node runtime"]
fn actual_stdio_initialize_call_resource_and_reverse_request_refusal() {
    let code = r#"const out=v=>process.stdout.write(JSON.stringify(v)+'\n');const read=require('node:readline').createInterface({input:process.stdin});let pending;read.on('line',line=>{const m=JSON.parse(line);if(m.error){if(m.id!=='reverse'||m.error.code!==-32601)process.exit(10);out({jsonrpc:'2.0',id:pending,result:{tools:[{name:'count',description:'Count words',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]}});return;}if(!m.id)return;let result;if(m.method==='initialize')result={protocolVersion:'2025-11-25',serverInfo:{name:'sandbox-fixture',version:'1'},capabilities:{tools:{},resources:{}}};else if(m.method==='tools/list'){pending=m.id;out({jsonrpc:'2.0',id:'reverse',method:'sampling/createMessage',params:{messages:[]}});return;}else if(m.method==='tools/call')result={content:[{type:'text',text:String(m.params.arguments.text.split(/\s+/).length)}],structuredContent:{words:m.params.arguments.text.split(/\s+/).length}};else if(m.method==='resources/list')result={resources:[{uri:'fixture://guide',name:'guide'}]};else if(m.method==='resources/read')result={contents:[{uri:m.params.uri,text:'Public guide'}]};out({jsonrpc:'2.0',id:m.id,result});process.stderr.write('private diagnostic excluded\n');});"#;
    let transport = server(code, 3000);
    let dir = transport.directory.as_ref().unwrap().path().to_path_buf();
    let mut client = Client::connect(transport, &|| Ok(())).unwrap();
    let tools = client.tools(&|| Ok(())).unwrap();
    assert_eq!(tools[0]["name"], "count");
    let result = client
        .call_tool("count", json!({"text":"three public words"}), &|| Ok(()))
        .unwrap();
    assert_eq!(result["structuredContent"]["words"], 3);
    assert_eq!(
        client.resources(&|| Ok(())).unwrap()[0]["uri"],
        "fixture://guide"
    );
    assert_eq!(
        client.read_resource("fixture://guide", &|| Ok(())).unwrap()["contents"][0]["text"],
        "Public guide"
    );
    client.close().unwrap();
    assert!(!dir.exists());
}
#[test]
#[ignore = "real Windows sandbox with the pinned Node runtime"]
fn actual_stdio_cancel_hang_and_oversized_frame_settle() {
    let mut hung = server("process.stdin.resume();setInterval(()=>{},1000)", 3000);
    let dir = hung.directory.as_ref().unwrap().path().to_path_buf();
    let began = Instant::now();
    let result = hung.exchange(
        &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
        &|| {
            if began.elapsed() > Duration::from_millis(100) {
                Err("BLK-RUN-005".into())
            } else {
                Ok(())
            }
        },
    );
    assert_eq!(result.unwrap_err(), "BLK-RUN-005");
    assert!(began.elapsed() < Duration::from_secs(2));
    assert!(!dir.exists());
    let mut large=server("process.stdin.once('data',()=>process.stdout.write('a'.repeat(300000)));process.stdin.resume()",3000);
    assert_eq!(
        large
            .exchange(
                &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
                &|| Ok(())
            )
            .unwrap_err(),
        "BLK-MCP-LIMIT"
    );
    assert!(large.closed);
}
