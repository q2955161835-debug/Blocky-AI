use super::*;
use crate::mcp_client::Client;
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
    StdioTransport::spawn(directory, &node, &args, timeout).unwrap()
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
