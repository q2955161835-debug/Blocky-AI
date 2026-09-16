use super::*;
use std::time::Instant;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProcessRequest {
    pub request_id: String,
    pub task_id: String,
    pub arguments: BTreeMap<String, i64>,
    pub capability_id: String,
    pub timeout_ms: u64,
    pub output_budget_bytes: usize,
}
pub(super) struct Grant {
    principal: String,
    tasks: Vec<String>,
    expires: Instant,
}
impl TaskHost {
    /// Trusted Host policy code only. Never expose this as an unguarded IPC command.
    pub fn grant_agent(
        &self,
        principal: &str,
        task_ids: Vec<String>,
        ttl_ms: u64,
    ) -> Result<String, String> {
        if principal.is_empty()
            || principal.len() > 128
            || task_ids.is_empty()
            || task_ids.len() > 8
            || !(1..=300000).contains(&ttl_ms)
            || self.closing.load(Ordering::SeqCst)
        {
            return Err("BLK-TERM-003".into());
        }
        for id in &task_ids {
            if definition_for(id)?["agentPolicy"] != "allow-scoped" {
                return Err("BLK-TERM-003".into());
            }
        }
        let mut grants = self.grants.lock().map_err(|_| "BLK-TERM-001")?;
        grants.retain(|_, v| v.expires > Instant::now());
        if grants.len() >= 64 {
            return Err("BLK-TERM-103".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        grants.insert(
            token.clone(),
            Grant {
                principal: principal.into(),
                tasks: task_ids,
                expires: Instant::now() + Duration::from_millis(ttl_ms),
            },
        );
        Ok(token)
    }
    /// principal comes from the authenticated Host transport, never the request JSON.
    pub fn start_agent(
        &self,
        principal: &str,
        request: AgentProcessRequest,
        files: ProjectFiles,
    ) -> Result<String, String> {
        if request.request_id.is_empty() || request.request_id.len() > 128 {
            return Err("BLK-TERM-003".into());
        }
        let mut grants = self.grants.lock().map_err(|_| "BLK-TERM-001")?;
        let grant = grants.get(&request.capability_id).ok_or("BLK-TERM-003")?;
        if grant.principal != principal
            || grant.expires <= Instant::now()
            || !grant.tasks.contains(&request.task_id)
        {
            return Err("BLK-TERM-003".into());
        }
        let id = self.start(
            TaskRequest {
                task_id: request.task_id,
                parameters: request.arguments,
                timeout_ms: request.timeout_ms,
                output_budget_bytes: request.output_budget_bytes,
            },
            files,
        )?;
        grants.remove(&request.capability_id);
        self.agent_runs
            .lock()
            .map_err(|_| "BLK-TERM-001")?
            .insert(id.clone(), principal.into());
        Ok(id)
    }
    pub fn snapshot_agent(&self, principal: &str, id: &str) -> Result<TaskSnapshot, String> {
        self.check_agent_owner(principal, id)?;
        self.snapshot(id)
    }
    pub fn cancel_agent(&self, principal: &str, id: &str) -> Result<(), String> {
        self.check_agent_owner(principal, id)?;
        self.cancel(id)
    }
    fn check_agent_owner(&self, principal: &str, id: &str) -> Result<(), String> {
        if self
            .agent_runs
            .lock()
            .map_err(|_| "BLK-TERM-001")?
            .get(id)
            .is_some_and(|owner| owner == principal)
        {
            Ok(())
        } else {
            Err("BLK-TERM-003".into())
        }
    }
}
