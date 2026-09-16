use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
const ERROR: &str = "BLK-LOG-004";
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    timestamp: String,
    sequence: u64,
    level: String,
    channel: String,
}
impl Record {
    fn validate(&self) -> Result<(), String> {
        if self.sequence > 9007199254740991
            || !["info", "warning", "error"].contains(&self.level.as_str())
            || ![
                "runtime", "compiler", "host", "terminal", "preview", "builder",
            ]
            .contains(&self.channel.as_str())
            || !regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
                .unwrap()
                .is_match(&self.timestamp)
        {
            return Err(ERROR.into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostics {
    schema_version: String,
    records: Vec<Record>,
    dropped: u64,
    dropped_important: u64,
}
impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            schema_version: "blocky.diagnostics/v1".into(),
            records: vec![],
            dropped: 0,
            dropped_important: 0,
        }
    }
}
pub struct LogStore {
    path: PathBuf,
    state: Mutex<(Diagnostics, bool)>,
}
impl LogStore {
    pub fn open(path: PathBuf) -> Self {
        let loaded = (|| -> Result<Diagnostics, String> {
            if !path.exists() {
                return Ok(Diagnostics::default());
            }
            if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 262144 {
                return Err(ERROR.into());
            }
            let bytes = std::fs::read(&path).map_err(|_| ERROR)?;
            let value: Diagnostics =
                serde_json::from_value(crate::strict_json::parse(&bytes)?).map_err(|_| ERROR)?;
            if value.schema_version != "blocky.diagnostics/v1" || value.records.len() > 1000 {
                return Err(ERROR.into());
            }
            for record in &value.records {
                record.validate()?;
            }
            Ok(value)
        })();
        let invalid = loaded.is_err();
        Self {
            path,
            state: Mutex::new((loaded.unwrap_or_default(), invalid)),
        }
    }
    fn persist(&self, value: &Diagnostics) -> Result<(), String> {
        let folder = self.path.parent().ok_or(ERROR)?;
        std::fs::create_dir_all(folder).map_err(|_| ERROR)?;
        let bytes = serde_json::to_vec(value).map_err(|_| ERROR)?;
        if bytes.len() > 262144 {
            return Err(ERROR.into());
        }
        let mut file = tempfile::NamedTempFile::new_in(folder).map_err(|_| ERROR)?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| ERROR)?;
        file.persist(&self.path).map_err(|_| ERROR)?;
        Ok(())
    }
    pub fn append(&self, records: Vec<Record>) -> Result<(), String> {
        self.append_with_losses(records, 0, 0)
    }
    pub fn append_with_losses(
        &self,
        records: Vec<Record>,
        dropped: u64,
        dropped_important: u64,
    ) -> Result<(), String> {
        if dropped_important > dropped || dropped > 9007199254740991 {
            return Err(ERROR.into());
        }
        if records.len() > 500 {
            return Err(ERROR.into());
        }
        for record in &records {
            record.validate()?;
        }
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        if state.1 {
            return Err(ERROR.into());
        }
        let mut next = state.0.clone();
        next.dropped = next.dropped.saturating_add(dropped);
        next.dropped_important = next.dropped_important.saturating_add(dropped_important);
        next.records.extend(records);
        while next.records.len() > 1000 {
            let index = next
                .records
                .iter()
                .position(|r| r.level == "info")
                .unwrap_or(0);
            let removed = next.records.remove(index);
            next.dropped = next.dropped.saturating_add(1);
            if removed.level != "info" {
                next.dropped_important = next.dropped_important.saturating_add(1);
            }
        }
        self.persist(&next)?;
        state.0 = next;
        Ok(())
    }
    pub fn read(&self, channel: Option<&str>) -> Result<Diagnostics, String> {
        let state = self.state.lock().map_err(|_| ERROR)?;
        if state.1 {
            return Err(ERROR.into());
        }
        let mut value = state.0.clone();
        if let Some(channel) = channel {
            if ![
                "runtime", "compiler", "host", "terminal", "preview", "builder",
            ]
            .contains(&channel)
            {
                return Err(ERROR.into());
            }
            value.records.retain(|r| r.channel == channel);
        }
        for record in &value.records {
            record.validate()?;
        }
        Ok(value)
    }
    pub fn clear(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        let next = Diagnostics::default();
        self.persist(&next)?;
        *state = (next, false);
        Ok(())
    }
    pub fn flush(&self) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| ERROR)?;
        if state.1 {
            return Err(ERROR.into());
        }
        self.persist(&state.0)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bodies_and_persists_only_bounded_metadata() {
        assert!(serde_json::from_value::<Record>(serde_json::json!({"timestamp":"2026-09-16T00:00:00.000Z","sequence":1,"level":"info","channel":"runtime","body":"private"})).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let store = LogStore::open(path.clone());
        let record:Record=serde_json::from_value(serde_json::json!({"timestamp":"2026-09-16T00:00:00.000Z","sequence":1,"level":"info","channel":"runtime"})).unwrap();
        for _ in 0..3 {
            store.append(vec![record.clone(); 500]).unwrap();
        }
        let loaded = LogStore::open(path.clone());
        let data = loaded.read(None).unwrap();
        assert_eq!(data.records.len(), 1000);
        assert_eq!(data.dropped, 500);
        loaded.append_with_losses(vec![], 2, 1).unwrap();
        let data = LogStore::open(path.clone()).read(None).unwrap();
        assert_eq!(data.dropped, 502);
        assert_eq!(data.dropped_important, 1);
        assert!(loaded.append_with_losses(vec![], 1, 2).is_err());
        loaded.clear().unwrap();
        assert!(LogStore::open(path).read(None).unwrap().records.is_empty());
    }
}
