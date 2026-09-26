use super::target;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserTarget {
    pub identity: String,
    pub project_id: String,
    pub origin: String,
}
impl BrowserTarget {
    pub fn validate(&self) -> Result<(), String> {
        let suffix = self
            .identity
            .strip_prefix("browser:")
            .ok_or("BLK-RPA-TARGET-001")?;
        if uuid::Uuid::parse_str(suffix).is_err()
            || !crate::project_store::stable(&self.project_id)
            || self.project_id.len() > 200
        {
            return Err("BLK-RPA-TARGET-001".into());
        }
        let url = reqwest::Url::parse(&self.origin).map_err(|_| "BLK-RPA-TARGET-001")?;
        if !["http", "https"].contains(&url.scheme())
            || url.origin().ascii_serialization() != self.origin
        {
            return Err("BLK-RPA-TARGET-001".into());
        }
        Ok(())
    }
}
/// Untagged Windows form preserves existing encrypted v1 journal compatibility.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Binding {
    Windows(target::Target),
    Browser(BrowserTarget),
}
impl From<target::Target> for Binding {
    fn from(value: target::Target) -> Self {
        Self::Windows(value)
    }
}
impl Binding {
    pub fn identity(&self) -> &str {
        match self {
            Self::Windows(t) => &t.identity,
            Self::Browser(t) => &t.identity,
        }
    }
    pub fn label(&self) -> String {
        match self {
            Self::Windows(t) => format!("窗口：{}\n进程：{}", t.title, t.process_id),
            Self::Browser(t) => format!("浏览器来源：{}\n项目：{}", t.origin, t.project_id),
        }
    }
    pub fn windows(&self) -> Result<&target::Target, String> {
        match self {
            Self::Windows(t) => Ok(t),
            _ => Err("BLK-RPA-UNSUPPORTED-001".into()),
        }
    }
    pub fn validate_snapshot(&self, kind: &str, root: &[i32]) -> Result<(), String> {
        match self {
            Self::Windows(t)
                if kind == "windows"
                    && !root.is_empty()
                    && root.len() <= 64
                    && t.title.len() <= 4096
                    && t.class_name.len() <= 1024 =>
            {
                Ok(())
            }
            Self::Browser(t) if kind == "browser" && root.is_empty() => t.validate(),
            _ => Err("BLK-RPA-JOURNAL-002".into()),
        }
    }
}
