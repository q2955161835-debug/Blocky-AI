//! RPA error boundary for the shared native process identity.
use crate::process_identity::Identity;
use serde::{Deserialize, Serialize};
const ERROR: &str = "BLK-RPA-RECOVERY-001";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Owner {
    pub process_id: u32,
    pub created: u64,
}
impl Owner {
    pub fn current() -> Result<Self, String> {
        let identity = Identity::current().map_err(|_| ERROR)?;
        Ok(Self {
            process_id: identity.process_id,
            created: identity.created,
        })
    }
    pub fn is_alive(&self) -> Result<bool, String> {
        Identity {
            process_id: self.process_id,
            created: self.created,
        }
        .is_alive()
        .map_err(|_| ERROR.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_live_owner_and_distinguishes_reused_pid() {
        let owner = Owner::current().unwrap();
        assert!(owner.is_alive().unwrap());
        assert!(
            !Owner {
                created: owner.created - 1,
                ..owner.clone()
            }
            .is_alive()
            .unwrap()
        );
        assert!(
            Owner {
                process_id: 0,
                created: 0
            }
            .is_alive()
            .is_err()
        );
    }
}
