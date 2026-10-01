use blocky_studio::agent_data::{AgentData, MemoryRequest, ToolRequest};
use blocky_studio::agent_data::ManageRequest;
use blocky_studio::agent_data::SkillRequest;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Write;
fn guard(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::window_lifecycle::visible(window)
}
#[tauri::command]
pub async fn agent_memory_authorize(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    project_id: String,
    session_id: String,
) -> Result<Value, String> {
    guard(&window)?;
    blocky_studio::agent_data::validate_context(&project_id, &session_id)?;
    if !blocky_studio::native_confirmation::yes_no(&window, "批准项目本机能力", format!("本次操作可访问此项目的本机记忆、媒体、评估资产和已安装技能，并调用本地评分模型。工具和在线模型继续独立核验。\n项目：{}\n会话：{}\n授权在运行结束或取消时撤销，最长30分钟。",project_id,session_id)).await {
        return Err("BLK-PERM-001".into());
    }
    guard(&window)?;
    Ok(json!({"token":host.authorize(&project_id,&session_id)?}))
}
#[tauri::command]
pub fn agent_memory(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    token: String,
    request: MemoryRequest,
) -> Result<Value, String> {
    guard(&window)?;
    host.memory(&token, &request)
}
#[tauri::command]
pub fn agent_memory_manage(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    token: String,
    request: ManageRequest,
) -> Result<Value, String> {
    guard(&window)?;
    host.manage_memory(&token, &request)
}
#[tauri::command]
pub fn agent_skill(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request:SkillRequest)->Result<Value,String>{guard(&window)?;host.manage_skill(&token,&request)}
#[tauri::command]
pub async fn agent_media(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request:blocky_studio::agent_data::media_store::MediaRequest)->Result<Value,String>{
    guard(&window)?;let owned=host.inner().clone();
    tauri::async_runtime::spawn_blocking(move||owned.manage_media(&token,&request)).await.map_err(|_|"BLK-MEDIA-IO")?
}
#[tauri::command]
pub fn agent_media_cancel(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request_id:String)->Result<(),String>{if window.label()!="main"{return Err("BLK-PERM-001".into());}host.cancel_media(&token,&request_id)}
#[tauri::command]
pub fn agent_evaluation(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request:blocky_studio::agent_data::evaluation_store::Request)->Result<Value,String>{guard(&window)?;host.manage_evaluation(&token,&request)}
#[tauri::command]
pub async fn agent_decision(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request:blocky_studio::agent_data::decision::DecisionRequest)->Result<Value,String>{
 guard(&window)?;let owned=host.inner().clone();tauri::async_runtime::spawn_blocking(move||owned.infer_decision(&token,&request)).await.map_err(|_|"BLK-DECISION-INVALID")?
}
#[tauri::command]
pub fn agent_decision_cancel(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,token:String,request_id:String)->Result<(),String>{if window.label()!="main"{return Err("BLK-PERM-001".into());}host.cancel_decision(&token,&request_id)}
#[tauri::command]
pub async fn agent_media_import(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,project_id:String,session_id:String)->Result<Value,String>{
    guard(&window)?;blocky_studio::agent_data::validate_context(&project_id,&session_id)?;
    let selected=rfd::AsyncFileDialog::new().set_parent(&window).set_title("导入图片或音频").add_filter("媒体",&["png","jpg","jpeg","wav"]).pick_file().await.ok_or("BLK-RUN-005")?;
    guard(&window)?;let input=blocky_studio::agent_data::media_store::read_native_file(selected.path())?;let preview=input.preflight()?;
    if !blocky_studio::native_confirmation::yes_no(&window,"保存项目媒体",format!("格式：{}\n大小：{} bytes\n文件会保存为此项目的本机媒体引用。",preview["mimeType"],preview["byteLength"])).await{return Err("BLK-PERM-001".into());}
    guard(&window)?;let token=host.authorize(&project_id,&session_id)?;let result=host.import_media(&token,&project_id,&session_id,&input);host.revoke(&token)?;result
}
#[tauri::command]
pub async fn agent_skill_install(window:tauri::WebviewWindow,host:tauri::State<'_,AgentData>,project_id:String,session_id:String)->Result<Value,String>{
    guard(&window)?;blocky_studio::agent_data::validate_context(&project_id,&session_id)?;
    let selected=rfd::AsyncFileDialog::new().set_title("安装 Blocky Skill").pick_folder().await.ok_or("BLK-RUN-005")?;
    guard(&window)?;let (metadata,files)=blocky_studio::agent_data::skill_store::read_native_directory(selected.path())?;
    let request:SkillRequest=serde_json::from_value(json!({"schemaVersion":"blocky.skill-request/v1","requestId":format!("skill-{}",uuid::Uuid::new_v4()),"projectId":project_id,"sessionId":session_id,"action":"install","metadata":metadata,"files":files})).map_err(|_|"BLK-SKILL-INVALID")?;
    let preview=request.preflight()?;
    if !blocky_studio::native_confirmation::yes_no(&window,"安装 Skill",format!("技能：{}\n版本：{}\n正文和附属文件仅作为资料加载，脚本不会自动运行。\n声明工具：{}",preview["metadata"]["name"].as_str().unwrap_or(""),preview["metadata"]["version"].as_str().unwrap_or(""),preview["metadata"]["toolIds"])).await{return Err("BLK-PERM-001".into());}
    guard(&window)?;let token=host.authorize(&request.project_id,&request.session_id)?;let result=host.manage_skill(&token,&request);host.revoke(&token)?;result
}
#[tauri::command]
pub fn agent_memory_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    token: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.revoke(&token)
}
#[tauri::command]
pub fn agent_tool_preflight(
    window: tauri::WebviewWindow,
    request: ToolRequest,
) -> Result<Value, String> {
    guard(&window)?;
    request.preflight()
}
#[tauri::command]
pub async fn agent_tool_call(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    request: ToolRequest,
) -> Result<Value, String> {
    guard(&window)?;
    let preview = request.preflight()?;
    let digest = blocky_studio::agent_data::digest(&request)?;
    if !blocky_studio::native_confirmation::yes_no(
        &window,
        "批准文本分析工具",
        format!(
            "本机统计文字数量、行数和词数。\n项目：{}\n运行：{}\n输入：{} bytes\n完整请求摘要：{}",
            request.project_id, request.run_id, preview["inputBytes"], digest
        ),
    )
    .await
    {
        return Err("BLK-PERM-001".into());
    }
    guard(&window)?;
    host.tool(&request, &digest)
}
#[tauri::command]
pub fn agent_tool_cancel(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, AgentData>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("BLK-PERM-001".into());
    }
    host.cancel_tool(&request_id)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputRequest {
    name: String,
    content: String,
    format: String,
}
#[tauri::command]
pub async fn agent_output_save(
    window: tauri::WebviewWindow,
    request: OutputRequest,
) -> Result<Value, String> {
    guard(&window)?;
    if request.name.is_empty()
        || request.name.len() > 128
        || request
            .name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || request.content.len() > 1024 * 1024
        || !["text", "json"].contains(&request.format.as_str())
    {
        return Err("BLK-AGENT-INVALID".into());
    }
    if request.format == "json" {
        blocky_studio::strict_json::parse(request.content.as_bytes())
            .map_err(|_| "BLK-AGENT-INVALID")?;
    }
    let extension = if request.format == "json" {
        "json"
    } else {
        "txt"
    };
    let picked = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("导出运行结果")
        .set_file_name(&request.name)
        .add_filter("运行结果", &[extension])
        .save_file()
        .await;
    let Some(picked) = picked else {
        return Ok(json!({"saved":false}));
    };
    guard(&window)?;
    let path = picked.path();
    let exists = path.exists();
    if exists {
        if !blocky_studio::native_confirmation::yes_no(
            &window,
            "确认覆盖文件",
            "所选文件已经存在。覆盖将替换文件全部内容。",
        )
        .await
        {
            return Ok(json!({"saved":false}));
        }
        guard(&window)?;
    }
    let parent = path.parent().ok_or("BLK-AGENT-IO")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "BLK-AGENT-IO")?;
    temporary
        .write_all(request.content.as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "BLK-AGENT-IO")?;
    if exists {
        temporary.persist(path).map_err(|_| "BLK-AGENT-IO")?;
    } else {
        temporary
            .persist_noclobber(path)
            .map_err(|_| "BLK-AGENT-IO")?;
    }
    Ok(json!({"saved":true}))
}
