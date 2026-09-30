use super::*;
pub(crate) struct LocalSession {
    pub endpoint: String,
    pub key: Vec<u8>,
}
impl LocalSession {
    pub fn start(_: &Path, _: &str, _: &LocalOptions, _: &AtomicBool) -> Result<Self, String> {
        Err("BLK-LOCAL-MODEL-PLATFORM".into())
    }
    pub fn close(&mut self) -> Result<(), String> {
        Ok(())
    }
}
