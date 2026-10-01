use blocky_studio::agent_data::{AgentData, MemoryRequest, ToolRequest};
use blocky_studio::agent_data::ManageRequest;
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
    if !blocky_studio::native_confirmation::yes_no(&window, "批准项目记忆访问", format!("本次运行将读取、写入和删除此项目在本机保存的记忆。\n项目：{}\n会话：{}\n授权在运行结束或取消时撤销，最长30分钟。",project_id,session_id)).await {
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
