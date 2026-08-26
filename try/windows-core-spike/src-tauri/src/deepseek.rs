use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    env,
    sync::Mutex,
    time::Duration,
};
use tokio::sync::oneshot;

const DEFAULT_API_BASE: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_PENDING_CANCELLATIONS: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeepSeekCompletionRequest {
    input: String,
    request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekCompletionResponse {
    content: String,
    provider: &'static str,
    model: String,
    request_id: String,
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct DeepSeekError {
    code: &'static str,
    message: &'static str,
}

impl DeepSeekError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

#[derive(Default)]
struct DeepSeekRequestState {
    active: HashMap<String, oneshot::Sender<()>>,
    pending: HashSet<String>,
    pending_order: VecDeque<String>,
}

#[derive(Default)]
pub struct DeepSeekRequestRegistry {
    state: Mutex<DeepSeekRequestState>,
}

fn validate_request_id(request_id: &str) -> Result<(), DeepSeekError> {
    if request_id.is_empty()
        || request_id.len() > MAX_REQUEST_ID_BYTES
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(DeepSeekError::new(
            "DEEPSEEK_REQUEST_ID_INVALID",
            "DeepSeek 请求标识无效",
        ));
    }
    Ok(())
}

impl DeepSeekRequestRegistry {
    fn register(&self, request_id: &str) -> Result<oneshot::Receiver<()>, DeepSeekError> {
        validate_request_id(request_id)?;
        let mut state = self.state.lock().map_err(|_| {
            DeepSeekError::new("DEEPSEEK_CANCEL_STATE_FAILED", "DeepSeek 取消状态不可用")
        })?;
        if state.pending.remove(request_id) {
            state.pending_order.retain(|queued| queued != request_id);
            return Err(DeepSeekError::new(
                "DEEPSEEK_CANCELLED",
                "DeepSeek 请求已取消",
            ));
        }
        if state.active.contains_key(request_id) {
            return Err(DeepSeekError::new(
                "DEEPSEEK_REQUEST_DUPLICATE",
                "DeepSeek 请求标识重复",
            ));
        }
        let (sender, receiver) = oneshot::channel();
        state.active.insert(request_id.to_owned(), sender);
        Ok(receiver)
    }

    fn cancel(&self, request_id: &str) -> Result<bool, DeepSeekError> {
        validate_request_id(request_id)?;
        let mut state = self.state.lock().map_err(|_| {
            DeepSeekError::new("DEEPSEEK_CANCEL_STATE_FAILED", "DeepSeek 取消状态不可用")
        })?;
        if let Some(sender) = state.active.remove(request_id) {
            return Ok(sender.send(()).is_ok());
        }
        if state.pending.insert(request_id.to_owned()) {
            while state.pending_order.len() >= MAX_PENDING_CANCELLATIONS {
                if let Some(expired) = state.pending_order.pop_front() {
                    state.pending.remove(&expired);
                }
            }
            state.pending_order.push_back(request_id.to_owned());
        }
        Ok(false)
    }

    fn complete(&self, request_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.active.remove(request_id);
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiChoice {
    message: ApiMessage,
}

#[derive(Debug, Deserialize)]
struct ApiUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    id: String,
    model: String,
    choices: Vec<ApiChoice>,
    usage: ApiUsage,
}

fn configured_model() -> Result<String, DeepSeekError> {
    let model = env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_owned());
    if !matches!(model.as_str(), "deepseek-v4-flash" | "deepseek-v4-pro") {
        return Err(DeepSeekError::new(
            "DEEPSEEK_MODEL_NOT_ALLOWED",
            "DeepSeek 模型配置不受支持",
        ));
    }
    Ok(model)
}

fn api_url() -> Result<String, DeepSeekError> {
    let base = env::var("DEEPSEEK_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_owned());
    if base.trim_end_matches('/') != DEFAULT_API_BASE {
        return Err(DeepSeekError::new(
            "DEEPSEEK_API_BASE_NOT_ALLOWED",
            "DeepSeek API 地址不受支持",
        ));
    }
    Ok(format!("{DEFAULT_API_BASE}/chat/completions"))
}

fn parse_api_response(response: ApiResponse) -> Result<DeepSeekCompletionResponse, DeepSeekError> {
    let content = response
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| {
            DeepSeekError::new("DEEPSEEK_RESPONSE_CONTENT_MISSING", "DeepSeek 响应缺少正文")
        })?;
    if response.id.trim().is_empty() || response.model.trim().is_empty() {
        return Err(DeepSeekError::new(
            "DEEPSEEK_RESPONSE_INVALID",
            "DeepSeek 响应格式无效",
        ));
    }
    Ok(DeepSeekCompletionResponse {
        content,
        provider: "deepseek",
        model: response.model,
        request_id: response.id,
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
    })
}

fn status_error(status: StatusCode) -> DeepSeekError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            DeepSeekError::new("DEEPSEEK_AUTH_FAILED", "DeepSeek 鉴权失败")
        }
        StatusCode::TOO_MANY_REQUESTS => {
            DeepSeekError::new("DEEPSEEK_RATE_LIMITED", "DeepSeek 请求受到限流")
        }
        _ => DeepSeekError::new("DEEPSEEK_HTTP_FAILED", "DeepSeek 服务返回错误"),
    }
}

#[tauri::command]
pub async fn deepseek_chat_completion(
    request: DeepSeekCompletionRequest,
    registry: tauri::State<'_, DeepSeekRequestRegistry>,
) -> Result<DeepSeekCompletionResponse, DeepSeekError> {
    if request.input.trim().is_empty() || request.input.len() > MAX_INPUT_BYTES {
        return Err(DeepSeekError::new(
            "DEEPSEEK_INPUT_INVALID",
            "DeepSeek 输入无效",
        ));
    }
    let api_key = env::var("DEEPSEEK_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| DeepSeekError::new("DEEPSEEK_API_KEY_MISSING", "DeepSeek API Key 未配置"))?;
    let model = configured_model()?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| DeepSeekError::new("DEEPSEEK_CLIENT_FAILED", "DeepSeek 客户端初始化失败"))?;
    let system_prompt = concat!(
        "You are the evidence synthesis step in Blocky. The user message is trusted JSON with question, ",
        "requestedDetails and evidence. Return only one JSON object with schema blocky.course-draft/v1. ",
        "Use exactly this shape: {\"schema\":\"blocky.course-draft/v1\",\"question\":\"...\",",
        "\"claims\":[{\"kind\":\"evidence|unverified\",\"text\":\"...\",\"subject\":\"...|null\",",
        "\"highlightLabel\":\"...|null\",\"highlight\":\"...|null\",",
        "\"citation\":{\"evidenceId\":\"...\",\"title\":\"...\",\"section\":\"...\"}|null}]}. ",
        "Each evidence claim must copy the supplied evidence text, heading, ",
        "highlightLabel, highlight, id, title and section exactly. Use citation {evidenceId,title,section}. ",
        "For requested details unsupported by evidence, output kind unverified with citation null and null highlights. ",
        "Never invent evidence, citations or numeric values."
    );
    let api_request = client.post(api_url()?).bearer_auth(api_key).json(&json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": request.input }
        ],
        "thinking": { "type": "disabled" },
        "response_format": { "type": "json_object" },
        "temperature": 0.2,
        "max_tokens": 1400,
        "stream": false
    }));
    let mut cancellation = registry.register(&request.request_id)?;
    let result = async {
        let response = tokio::select! {
            _ = &mut cancellation => {
                return Err(DeepSeekError::new("DEEPSEEK_CANCELLED", "DeepSeek 请求已取消"));
            }
            response = api_request.send() => response.map_err(|_| {
                DeepSeekError::new("DEEPSEEK_NETWORK_FAILED", "DeepSeek 网络请求失败")
            })?,
        };
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status));
        }
        let api_response = tokio::select! {
            _ = &mut cancellation => {
                return Err(DeepSeekError::new("DEEPSEEK_CANCELLED", "DeepSeek 请求已取消"));
            }
            response = response.json::<ApiResponse>() => response.map_err(|_| {
                DeepSeekError::new("DEEPSEEK_RESPONSE_INVALID", "DeepSeek 响应格式无效")
            })?,
        };
        parse_api_response(api_response)
    }
    .await;
    registry.complete(&request.request_id);
    result
}

#[tauri::command]
pub fn cancel_deepseek_completion(
    request_id: String,
    registry: tauri::State<'_, DeepSeekRequestRegistry>,
) -> Result<bool, DeepSeekError> {
    registry.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::{
        ApiChoice, ApiMessage, ApiResponse, ApiUsage, DeepSeekRequestRegistry, parse_api_response,
    };

    #[test]
    fn response_exposes_only_content_identity_and_usage() {
        let parsed = parse_api_response(ApiResponse {
            id: "response-test".to_owned(),
            model: "deepseek-v4-flash".to_owned(),
            choices: vec![ApiChoice {
                message: ApiMessage {
                    content: Some("{\"schema\":\"blocky.course-draft/v1\"}".to_owned()),
                },
            }],
            usage: ApiUsage {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
            },
        })
        .expect("valid response");

        assert_eq!(parsed.provider, "deepseek");
        assert_eq!(parsed.request_id, "response-test");
        assert_eq!(parsed.total_tokens, 150);
    }

    #[test]
    fn cancellation_registry_notifies_an_active_request() {
        let registry = DeepSeekRequestRegistry::default();
        let mut cancellation = registry
            .register("client-request-1")
            .expect("request registers");

        assert!(
            registry
                .cancel("client-request-1")
                .expect("request cancels")
        );
        assert_eq!(cancellation.try_recv(), Ok(()));
    }

    #[test]
    fn cancellation_before_registration_closes_the_startup_race() {
        let registry = DeepSeekRequestRegistry::default();
        assert!(!registry.cancel("client-request-2").expect("cancel queues"));

        let error = registry
            .register("client-request-2")
            .expect_err("queued cancellation rejects registration");
        assert_eq!(error.code, "DEEPSEEK_CANCELLED");
    }
}
