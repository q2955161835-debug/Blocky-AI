use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
const ERROR: &str = "BLK-LOG-004";
static SCOPE_ID: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$").expect("fixed scope ID pattern")
});
const SAFE_INTEGER: u64 = 9007199254740991;
const MAX_RECORDS: usize = 100_000;
const MAX_DOCUMENT_BYTES: u64 = MAX_RECORDS as u64 * 2048 + 1024;
const CHANNELS: [&str; 6] = [
    "runtime", "compiler", "host", "terminal", "preview", "builder",
];
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    timestamp: String,
    sequence: u64,
    level: String,
    channel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope: Option<Scope>,
    #[serde(
        default,
        rename = "scopeOmitted",
        skip_serializing_if = "Option::is_none"
    )]
    scope_omitted: Option<bool>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
}
impl Scope {
    fn values(&self) -> [&Option<String>; 5] {
        [
            &self.project_id,
            &self.run_id,
            &self.module_id,
            &self.block_id,
            &self.correlation_id,
        ]
    }
    fn validate(&self) -> Result<(), String> {
        if self.values().iter().enumerate().any(|(index, value)| {
            value.as_ref().is_some_and(|v| {
                v.len() > (if index == 4 { 512 } else { 200 }) || !SCOPE_ID.is_match(v)
            })
        }) {
            return Err(ERROR.into());
        }
        Ok(())
    }
    fn matches(&self, other: Option<&Scope>) -> bool {
        let empty = Scope::default();
        self.values()
            .iter()
            .zip(other.unwrap_or(&empty).values())
            .all(|(wanted, actual)| wanted.as_ref().is_none_or(|w| actual.as_ref() == Some(w)))
    }
}
impl Record {
    fn validate(&self) -> Result<(), String> {
        if self.scope_omitted == Some(false)
            || self.sequence > SAFE_INTEGER
            || !["info", "warning", "error"].contains(&self.level.as_str())
            || !CHANNELS.contains(&self.channel.as_str())
        {
            return Err(ERROR.into());
        }
        timestamp_ms(&self.timestamp)?;
        if let Some(scope) = &self.scope {
            scope.validate()?;
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
    #[serde(default)]
    clear_audit: ClearAudit,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClearAudit {
    count: u64,
    last_cleared_at_ms: u64,
}
impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            schema_version: "blocky.diagnostics/v1".into(),
            records: vec![],
            dropped: 0,
            dropped_important: 0,
            clear_audit: ClearAudit::default(),
        }
    }
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retention {
    pub days: u16,
    pub max_bytes: u64,
}
impl Default for Retention {
    fn default() -> Self {
        Self {
            days: 365,
            max_bytes: 10 * 1024 * 1024,
        }
    }
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportFilter {
    pub channel: Option<String>,
    pub from_timestamp: Option<String>,
    pub to_timestamp: Option<String>,
    pub scope: Option<Scope>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub quarantined_records: u64,
    pub corrupt_store: bool,
    pub quarantine_present: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub retention: Retention,
    pub max_records: usize,
    pub effective_max_bytes: u64,
    pub stored_bytes: u64,
    pub records: usize,
    pub health: Health,
}
struct State {
    data: Diagnostics,
    retention: Retention,
    health: Health,
}
pub struct LogStore {
    path: PathBuf,
    state: Mutex<State>,
}
fn quarantine_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".quarantine");
    PathBuf::from(name)
}
fn quarantine(path: &Path) -> Result<(), String> {
    let target = quarantine_path(path);
    if target.exists() {
        return Err(ERROR.into());
    }
    std::fs::rename(path, target).map_err(|_| ERROR.into())
}
fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ERROR)?
        .as_millis()
        .try_into()
        .map_err(|_| ERROR)?)
}
fn timestamp_ms(value: &str) -> Result<u64, String> {
    let b = value.as_bytes();
    if b.len() != 24
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'.'
        || b[23] != b'Z'
    {
        return Err(ERROR.into());
    }
    let number = |start: usize, end: usize| -> Result<u64, String> {
        if !b[start..end].iter().all(u8::is_ascii_digit) {
            return Err(ERROR.into());
        }
        value[start..end].parse().map_err(|_| ERROR.into())
    };
    let (y, m, d, h, min, s, ms) = (
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
        number(17, 19)?,
        number(20, 23)?,
    );
    let leap = |y: u64| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month = [
        31,
        if leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1970..=9999).contains(&y)
        || !(1..=12).contains(&m)
        || d == 0
        || d > month[(m - 1) as usize]
        || h > 23
        || min > 59
        || s > 59
    {
        return Err(ERROR.into());
    }
    let leaps = |y: u64| y / 4 - y / 100 + y / 400;
    let days = (y - 1970) * 365 + leaps(y - 1) - leaps(1969)
        + month[..(m - 1) as usize].iter().sum::<u64>()
        + d
        - 1;
    Ok((((days * 24 + h) * 60 + min) * 60 + s) * 1000 + ms)
}
fn loss(data: &mut Diagnostics, important: bool) {
    data.dropped = data.dropped.saturating_add(1).min(SAFE_INTEGER);
    if important {
        data.dropped_important = data.dropped_important.saturating_add(1).min(SAFE_INTEGER);
    }
}
fn prune(data: &mut Diagnostics, policy: Retention, now: u64) -> Result<(), String> {
    let cutoff = now.saturating_sub(policy.days as u64 * 86400000);
    let mut kept = Vec::with_capacity(data.records.len());
    for record in std::mem::take(&mut data.records) {
        if policy.days == 0 || timestamp_ms(&record.timestamp)? < cutoff {
            loss(data, record.level != "info");
        } else {
            kept.push(record);
        }
    }
    data.records = kept;
    let mut sizes = Vec::with_capacity(data.records.len());
    for r in &data.records {
        sizes.push(serde_json::to_vec(r).map_err(|_| ERROR)?.len() + 1);
    }
    let mut bytes = serde_json::to_vec(data).map_err(|_| ERROR)?.len() as u64;
    let mut count = data.records.len();
    let limit = policy.max_bytes.min(MAX_DOCUMENT_BYTES);
    let mut removed = vec![false; count];
    for important in [false, true] {
        for i in 0..data.records.len() {
            if count <= MAX_RECORDS && bytes + 64 <= limit {
                break;
            }
            if (data.records[i].level != "info") == important {
                removed[i] = true;
                bytes = bytes.saturating_sub(sizes[i] as u64);
                count -= 1;
                loss(data, important);
            }
        }
    }
    let mut index = 0;
    data.records.retain(|_| {
        let keep = !removed[index];
        index += 1;
        keep
    });
    Ok(())
}
impl LogStore {
    pub fn open(path: PathBuf) -> Self {
        let mut health = Health {
            quarantine_present: quarantine_path(&path).exists(),
            ..Health::default()
        };
        let loaded = (|| -> Result<Diagnostics, String> {
            if !path.exists() {
                if health.quarantine_present {
                    return Err(ERROR.into());
                }
                return Ok(Diagnostics::default());
            }
            if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > MAX_DOCUMENT_BYTES {
                return Err(ERROR.into());
            }
            let bytes = std::fs::read(&path).map_err(|_| ERROR)?;
            let mut value = crate::strict_json::parse(&bytes)?;
            let records = value
                .get_mut("records")
                .and_then(|v| v.as_array_mut())
                .ok_or(ERROR)?;
            if records.len() > MAX_RECORDS {
                return Err(ERROR.into());
            }
            let mut good = Vec::with_capacity(records.len());
            for raw in std::mem::take(records) {
                match serde_json::from_value::<Record>(raw.clone()) {
                    Ok(r) if r.validate().is_ok() => good.push(raw),
                    _ => health.quarantined_records += 1,
                }
            }
            *records = good;
            let mut data: Diagnostics = serde_json::from_value(value).map_err(|_| ERROR)?;
            if data.schema_version != "blocky.diagnostics/v1"
                || data.dropped > SAFE_INTEGER
                || data.dropped_important > data.dropped
                || data.clear_audit.count > SAFE_INTEGER
                || data.clear_audit.last_cleared_at_ms > SAFE_INTEGER
                || (data.clear_audit.count == 0) != (data.clear_audit.last_cleared_at_ms == 0)
            {
                return Err(ERROR.into());
            }
            if health.quarantined_records > 0 {
                quarantine(&path)?;
                health.quarantine_present = true;
                data.dropped = data
                    .dropped
                    .saturating_add(health.quarantined_records)
                    .min(SAFE_INTEGER);
            }
            Ok(data)
        })();
        let invalid = loaded.is_err();
        if invalid {
            health.corrupt_store = true;
            if path.exists() && quarantine(&path).is_ok() {
                health.quarantine_present = true;
            }
        }
        let store = Self {
            path,
            state: Mutex::new(State {
                data: loaded.unwrap_or_default(),
                retention: Retention::default(),
                health,
            }),
        };
        if !invalid {
            let mut state = store.state.lock().unwrap();
            if state.health.quarantined_records > 0
                // Preserve recovered valid records before the Host applies its saved
                // policy. A previously larger policy must not become a corruption error.
                && store.persist(&state.data, Retention { days: 365, max_bytes: MAX_DOCUMENT_BYTES }).is_err()
            {
                state.health.corrupt_store = true;
            }
        }
        store
    }
    fn persist(&self, value: &Diagnostics, policy: Retention) -> Result<(), String> {
        let folder = self.path.parent().ok_or(ERROR)?;
        std::fs::create_dir_all(folder).map_err(|_| ERROR)?;
        let bytes = serde_json::to_vec(value).map_err(|_| ERROR)?;
        if bytes.len() as u64 > policy.max_bytes.min(MAX_DOCUMENT_BYTES) {
            return Err(ERROR.into());
        }
        let mut file = tempfile::NamedTempFile::new_in(folder).map_err(|_| ERROR)?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| ERROR)?;
        file.persist(&self.path).map_err(|_| ERROR)?;
        Ok(())
    }
    fn refresh(&self, state: &mut State) -> Result<(), String> {
        if state.health.corrupt_store {
            return Err(ERROR.into());
        }
        let mut next = state.data.clone();
        prune(&mut next, state.retention, now_ms()?)?;
        if next.records.len() != state.data.records.len() {
            self.persist(&next, state.retention)?;
            state.data = next;
        }
        Ok(())
    }
    pub fn configure(&self, days: u16, max_bytes: u64) -> Result<(), String> {
        if days > 365 || !(1024..=1073741824).contains(&max_bytes) {
            return Err(ERROR.into());
        }
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        if state.health.corrupt_store {
            return Err(ERROR.into());
        }
        let policy = Retention { days, max_bytes };
        let mut next = state.data.clone();
        prune(&mut next, policy, now_ms()?)?;
        self.persist(&next, policy)?;
        state.data = next;
        state.retention = policy;
        Ok(())
    }
    pub fn health(&self) -> Result<Health, String> {
        Ok(self.state.lock().map_err(|_| ERROR)?.health.clone())
    }
    pub fn stats(&self) -> Result<Stats, String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        self.refresh(&mut state)?;
        Ok(Stats {
            retention: state.retention,
            max_records: MAX_RECORDS,
            effective_max_bytes: state.retention.max_bytes.min(MAX_DOCUMENT_BYTES),
            stored_bytes: serde_json::to_vec(&state.data).map_err(|_| ERROR)?.len() as u64,
            records: state.data.records.len(),
            health: state.health.clone(),
        })
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
        if dropped_important > dropped || dropped > SAFE_INTEGER || records.len() > 500 {
            return Err(ERROR.into());
        }
        for r in &records {
            r.validate()?;
        }
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        if state.health.corrupt_store {
            return Err(ERROR.into());
        }
        let mut next = state.data.clone();
        next.dropped = next.dropped.saturating_add(dropped).min(SAFE_INTEGER);
        next.dropped_important = next
            .dropped_important
            .saturating_add(dropped_important)
            .min(SAFE_INTEGER);
        next.records.extend(records);
        prune(&mut next, state.retention, now_ms()?)?;
        self.persist(&next, state.retention)?;
        state.data = next;
        Ok(())
    }
    pub fn read(&self, channel: Option<&str>) -> Result<Diagnostics, String> {
        self.read_filtered(ExportFilter {
            channel: channel.map(String::from),
            ..ExportFilter::default()
        })
    }
    pub fn read_filtered(&self, filter: ExportFilter) -> Result<Diagnostics, String> {
        if let Some(scope) = &filter.scope {
            scope.validate()?;
        }
        if filter
            .channel
            .as_ref()
            .is_some_and(|c| !CHANNELS.contains(&c.as_str()))
        {
            return Err(ERROR.into());
        }
        let from = filter
            .from_timestamp
            .as_deref()
            .map(timestamp_ms)
            .transpose()?;
        let to = filter
            .to_timestamp
            .as_deref()
            .map(timestamp_ms)
            .transpose()?;
        if from.zip(to).is_some_and(|(a, b)| a > b) {
            return Err(ERROR.into());
        }
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        self.refresh(&mut state)?;
        let mut data = state.data.clone();
        data.records.retain(|r| {
            filter.channel.as_ref().is_none_or(|c| c == &r.channel)
                && filter
                    .scope
                    .as_ref()
                    .is_none_or(|scope| scope.matches(r.scope.as_ref()))
                && timestamp_ms(&r.timestamp)
                    .is_ok_and(|t| from.is_none_or(|v| t >= v) && to.is_none_or(|v| t <= v))
        });
        Ok(data)
    }
    pub fn clear(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        if state.health.corrupt_store && self.path.exists() {
            quarantine(&self.path)?;
            state.health.quarantine_present = true;
        }
        let next = Diagnostics {
            clear_audit: ClearAudit {
                count: state
                    .data
                    .clear_audit
                    .count
                    .saturating_add(1)
                    .min(SAFE_INTEGER),
                last_cleared_at_ms: now_ms()?.min(SAFE_INTEGER),
            },
            ..Diagnostics::default()
        };
        self.persist(&next, state.retention)?;
        state.data = next;
        state.health.corrupt_store = false;
        state.health.quarantined_records = 0;
        Ok(())
    }
    pub fn flush(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        self.refresh(&mut state)?;
        self.persist(&state.data, state.retention)
    }
}
#[cfg(test)]
mod tests;
