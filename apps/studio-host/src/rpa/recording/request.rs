use super::protocol::Options;
use crate::rpa::{
    binding::{Binding, BrowserTarget},
    protocol::TargetRef,
    target,
};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub session_id: String,
    pub project_id: String,
    pub target: TargetRef,
    pub url: Option<String>,
}
impl Request {
    pub(super) fn prepare(&self) -> Result<(Options, Binding), String> {
        let mut options = Options {
            session_id: self.session_id.clone(),
            project_id: self.project_id.clone(),
            target: self.target.clone(),
        };
        options.validate()?;
        if self.schema_version != "blocky.rpa-recording-start/v1" {
            return Err("BLK-RPA-RECORD-001".into());
        }
        let binding = match self.target.kind.as_str() {
            "windows" if self.url.is_none() => Binding::Windows(
                target::list()
                    .into_iter()
                    .find(|target| target.identity == self.target.identity)
                    .ok_or("BLK-RPA-TARGET-001")?,
            ),
            "browser" => {
                let url = self.url.as_ref().ok_or("BLK-RPA-TARGET-001")?;
                let parsed = reqwest::Url::parse(url).map_err(|_| "BLK-RPA-TARGET-001")?;
                if url.len() > 4096
                    || !["http", "https"].contains(&parsed.scheme())
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.origin().ascii_serialization() != self.target.identity
                {
                    return Err("BLK-RPA-TARGET-001".into());
                }
                let target = BrowserTarget {
                    identity: format!("browser:{}", uuid::Uuid::new_v4()),
                    project_id: self.project_id.clone(),
                    origin: parsed.origin().ascii_serialization(),
                };
                target.validate()?;
                options.target.identity = target.identity.clone();
                Binding::Browser(target)
            }
            _ => return Err("BLK-RPA-TARGET-001".into()),
        };
        Ok((options, binding))
    }
}
