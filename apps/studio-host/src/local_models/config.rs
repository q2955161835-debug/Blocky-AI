use super::INVALID;
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct LocalOptions {
    pub backend: String,
    pub device: Option<String>,
    pub context_tokens: u32,
    pub threads: u32,
    pub memory_mb: u32,
}
impl Default for LocalOptions {
    fn default() -> Self {
        Self {
            backend: "cpu".into(),
            device: None,
            context_tokens: 8192,
            threads: 4,
            memory_mb: 4096,
        }
    }
}
impl LocalOptions {
    pub fn validate(&self) -> Result<(), String> {
        if !["cpu", "vulkan"].contains(&self.backend.as_str())
            || !(1024..=8192).contains(&self.context_tokens)
            || !(1..=16).contains(&self.threads)
            || !(2048..=32768).contains(&self.memory_mb)
            || (self.backend == "cpu" && self.device.is_some())
            || (self.backend == "vulkan"
                && self.device.as_deref().is_none_or(|s| {
                    !s.strip_prefix("Vulkan")
                        .is_some_and(|n| n.parse::<u8>().is_ok_and(|n| n < 16))
                }))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}
