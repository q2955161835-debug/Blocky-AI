use super::*;
use std::io::{Read, Write};
#[test]
#[ignore = "runs a real isolated Node process using the pinned runtime in try/stage5"]
fn appcontainer_runs_stdio_but_cannot_read_host_files_or_spawn_a_process() {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-capability-upgrade/sandbox-probe");
    std::fs::create_dir_all(&base).unwrap();
    let outside = tempfile::tempdir_in(&base).unwrap();
    let secret = outside.path().join("host-only.txt");
    std::fs::write(&secret, "SYNTHETIC_HOST_SENTINEL").unwrap();
    let session = tempfile::tempdir_in(&base).unwrap();
    let bundle = session.path().join("bundle");
    let work = session.path().join("work");
    std::fs::create_dir(&bundle).unwrap();
    std::fs::create_dir(&work).unwrap();
    let node = bundle.join("node.exe");
    std::fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage5/builder-runtime/node.exe"),
        &node,
    )
    .unwrap();
    let script = bundle.join("probe.cjs");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    std::fs::write(&script, format!(r#"process.stderr.write('entered\n');const fs=require('node:fs');const cp=require('node:child_process');let read=false;try{{fs.readFileSync({secret});read=true}}catch{{}};process.stderr.write('checked-read\n');const p=cp.spawnSync(process.execPath,['-e','process.exit(0)'],{{timeout:500,stdio:"ignore"}});process.stderr.write('checked-spawn\n');let bundleWrite=false;try{{fs.writeFileSync(__filename,'changed');bundleWrite=true}}catch{{}};fs.writeFileSync('owned.txt','public');process.stderr.write('isolated stderr\n');let network=false,done=false;const socket=require('node:net').connect({{host:'127.0.0.1',port:{port}}});const finish=()=>{{if(done)return;done=true;socket.destroy();process.stdout.write(JSON.stringify({{read,spawn:p.status===0,bundleWrite,network,inheritedSecret:!!process.env.BLOCKY_SANDBOX_TEST_SECRET,wrote:fs.readFileSync('owned.txt','utf8')==='public'}})+'\n');}};socket.on('connect',()=>{{network=true;finish()}});socket.on('error',finish);setTimeout(finish,300);"#, secret=serde_json::to_string(secret.to_str().unwrap()).unwrap(),port=listener.local_addr().unwrap().port())).unwrap();
    let sandbox = Sandbox::new(&session).unwrap();
    sandbox.grant_tree(&bundle, false).unwrap();
    sandbox.grant_tree(&work, true).unwrap();
    let mut env: Vec<(std::ffi::OsString, std::ffi::OsString)> = [
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
    ]
    .into_iter()
    .filter_map(|key| std::env::var_os(key).map(|value| (key.into(), value)))
    .collect();
    env.extend([
        ("TEMP".into(), work.as_os_str().into()),
        ("TMP".into(), work.as_os_str().into()),
    ]);
    let mut worker = crate::process_worker::Worker::spawn_sandboxed(
        &node,
        &[
            "--preserve-symlinks-main".into(),
            "--preserve-symlinks".into(),
            script.as_os_str().into(),
        ],
        &format!("Local\\BlockyMcp-{}", uuid::Uuid::new_v4()),
        crate::process_worker::IsolatedLaunch {
            environment: &env,
            directory: &work,
            memory_limit: 512 * 1024 * 1024,
        },
        sandbox.sid(),
    )
    .unwrap();
    let stdout = worker.take_output().unwrap();
    let stderr = worker.take_error().unwrap();
    let output = std::thread::spawn(move || {
        let mut text = String::new();
        stdout.take(65536).read_to_string(&mut text).unwrap();
        text
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        stderr.take(65536).read_to_string(&mut text).unwrap();
        text
    });
    worker.resume().unwrap();
    worker.input().unwrap().flush().unwrap();
    for _ in 0..200 {
        if output.is_finished() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    worker.stop().unwrap();
    let stdout = output.join().unwrap();
    let stderr = errors.join().unwrap();
    assert!(
        !stdout.trim().is_empty(),
        "process produced no response: {stderr}"
    );
    let result: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(
        result,
        serde_json::json!({"read":false,"spawn":false,"bundleWrite":false,"network":false,"inheritedSecret":false,"wrote":true})
    );
    assert!(listener.accept().is_err());
    assert_eq!(
        stderr,
        "entered\nchecked-read\nchecked-spawn\nisolated stderr\n"
    );
    assert_eq!(
        std::fs::read_to_string(secret).unwrap(),
        "SYNTHETIC_HOST_SENTINEL"
    );
}
