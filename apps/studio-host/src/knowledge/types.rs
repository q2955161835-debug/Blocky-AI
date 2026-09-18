use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub const IO: &str = "BLK-KNOW-IO";
pub const DENIED: &str = "BLK-KNOW-DENIED";
pub const LIMIT: &str = "BLK-KNOW-LIMIT";
pub const INVALID: &str = "BLK-KNOW-INVALID";
pub const STALE: &str = "BLK-KNOW-STALE";
pub const MAX_DOCUMENT: usize = 2 * 1024 * 1024;
pub const MAX_CORPUS: usize = 100 * 1024 * 1024;
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        && id != "."
        && id != ".."
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub source_id: String,
    pub kind: String,
    pub title: String,
    pub location: String,
    pub revision: String,
    pub allowed_principals: Vec<String>,
    pub metadata: Value,
}
impl Source {
    pub fn readable(&self) -> bool {
        self.allowed_principals
            .iter()
            .any(|v| v == "local-user" || v == "public")
    }
    pub fn summary(&self) -> Value {
        json!({"sourceId":self.source_id,"kind":self.kind,"title":self.title,"revision":self.revision,"allowedPrincipals":self.allowed_principals,"readable":self.readable(),"metadata":self.metadata})
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub document_id: String,
    pub title: String,
    pub locator: Value,
    pub format: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    pub revision: String,
    pub metadata: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub revision: String,
    pub documents: Vec<Document>,
    pub excluded: Vec<Value>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collection {
    pub generation: u64,
    pub revision: u64,
    pub sources: Vec<Source>,
    pub index: Option<String>,
}
