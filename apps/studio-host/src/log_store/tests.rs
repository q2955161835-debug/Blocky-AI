use super::*;
fn dir() -> tempfile::TempDir {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage2-logs");
    std::fs::create_dir_all(&p).unwrap();
    tempfile::tempdir_in(p).unwrap()
}
#[test]
fn explicit_clear_audit_survives_reopen_retention_and_legacy_documents() {
    let d = dir();
    let p = d.path().join("diagnostics.json");
    std::fs::write(&p, br#"{"schemaVersion":"blocky.diagnostics/v1","records":[],"dropped":0,"droppedImportant":0}"#).unwrap();
    let s = LogStore::open(p.clone());
    assert_eq!(s.read(None).unwrap().clear_audit.count, 0);
    s.clear().unwrap();
    let first = s.read(None).unwrap().clear_audit;
    assert_eq!(first.count, 1);
    assert!(first.last_cleared_at_ms > 0);
    drop(s);
    let s = LogStore::open(p.clone());
    s.configure(0, 1024).unwrap();
    assert_eq!(s.read(None).unwrap().clear_audit.count, 1);
    s.clear().unwrap();
    assert_eq!(
        LogStore::open(p.clone())
            .read(None)
            .unwrap()
            .clear_audit
            .count,
        2
    );
    assert!(std::fs::metadata(&p).unwrap().len() <= 1024);
    let mut invalid = serde_json::to_value(s.read(None).unwrap()).unwrap();
    invalid["clearAudit"]["count"] = serde_json::json!(SAFE_INTEGER + 1);
    std::fs::write(&p, serde_json::to_vec(&invalid).unwrap()).unwrap();
    assert!(LogStore::open(p).read(None).is_err());
}
fn record(timestamp: &str, channel: &str, level: &str) -> Record {
    Record {
        timestamp: timestamp.into(),
        sequence: 1,
        channel: channel.into(),
        level: level.into(),
    }
}
#[test]
fn retention_bytes_and_disabled_storage() {
    let d = dir();
    let p = d.path().join("diagnostics.json");
    let s = LogStore::open(p.clone());
    s.configure(365, 1024).unwrap();
    s.append(vec![record("2099-01-01T00:00:00.000Z", "host", "info"); 50])
        .unwrap();
    assert!(std::fs::metadata(&p).unwrap().len() <= 1024);
    assert!(s.read(None).unwrap().dropped > 0);
    s.configure(0, 1024).unwrap();
    assert!(s.read(None).unwrap().records.is_empty());
    s.append(vec![record("2099-01-01T00:00:00.000Z", "host", "info")])
        .unwrap();
    assert!(LogStore::open(p).read(None).unwrap().records.is_empty());
    assert!(s.configure(366, 1024).is_err());
    assert!(s.configure(1, 1023).is_err());
    assert!(s.configure(1, 1073741825).is_err());
}
#[test]
fn time_and_channel_selection_and_calendar_validation() {
    let d = dir();
    let s = LogStore::open(d.path().join("diagnostics.json"));
    s.append(vec![
        record("2099-01-01T00:00:00.000Z", "host", "info"),
        record("2099-01-02T00:00:00.000Z", "host", "error"),
        record("2099-01-02T00:00:00.000Z", "runtime", "info"),
    ])
    .unwrap();
    let out = s
        .read_filtered(ExportFilter {
            channel: Some("host".into()),
            from_timestamp: Some("2099-01-02T00:00:00.000Z".into()),
            to_timestamp: Some("2099-01-03T00:00:00.000Z".into()),
        })
        .unwrap();
    assert_eq!(out.records.len(), 1);
    assert_eq!(out.records[0].level, "error");
    assert!(
        s.append(vec![record("2099-02-29T00:00:00.000Z", "host", "info")])
            .is_err()
    );
    let mut data = Diagnostics::default();
    data.records = vec![
        record("2020-01-01T00:00:00.000Z", "host", "error"),
        record("2020-01-03T00:00:00.000Z", "host", "info"),
    ];
    prune(
        &mut data,
        Retention {
            days: 1,
            max_bytes: 262144,
        },
        timestamp_ms("2020-01-03T00:00:00.000Z").unwrap(),
    )
    .unwrap();
    assert_eq!(data.records.len(), 1);
    assert_eq!(data.dropped_important, 1);
}
#[test]
fn corrupt_record_is_quarantined_without_losing_good_records() {
    let d = dir();
    let p = d.path().join("diagnostics.json");
    let value = serde_json::json!({"schemaVersion":"blocky.diagnostics/v1","records":[{"timestamp":"2099-01-01T00:00:00.000Z","sequence":1,"level":"info","channel":"host"},{"body":"must not be copied into repaired diagnostics"}],"dropped":0,"droppedImportant":0});
    std::fs::write(&p, serde_json::to_vec(&value).unwrap()).unwrap();
    let original = std::fs::read(&p).unwrap();
    let s = LogStore::open(p.clone());
    assert_eq!(s.read(None).unwrap().records.len(), 1);
    assert_eq!(s.health().unwrap().quarantined_records, 1);
    assert_eq!(std::fs::read(quarantine_path(&p)).unwrap(), original);
    assert!(!std::fs::read_to_string(&p).unwrap().contains("body"));
    assert_eq!(LogStore::open(p).read(None).unwrap().records.len(), 1);
}
#[test]
fn broken_document_blocks_until_explicit_clear_and_preserves_evidence() {
    let d = dir();
    let p = d.path().join("diagnostics.json");
    std::fs::write(&p, b"{broken").unwrap();
    let s = LogStore::open(p.clone());
    assert!(s.read(None).is_err());
    assert!(s.append(vec![]).is_err());
    assert_eq!(std::fs::read(quarantine_path(&p)).unwrap(), b"{broken");
    s.clear().unwrap();
    assert!(s.read(None).unwrap().records.is_empty());
    assert_eq!(std::fs::read(quarantine_path(&p)).unwrap(), b"{broken");
}
#[test]
fn larger_policy_really_exceeds_old_cap_and_preserves_loss_contract() {
    assert!(serde_json::from_value::<Record>(serde_json::json!({"timestamp":"2099-01-01T00:00:00.000Z","sequence":1,"level":"info","channel":"host","body":"private"})).is_err());
    let d = dir();
    let p = d.path().join("diagnostics.json");
    let s = LogStore::open(p.clone());
    s.configure(365, 10 * 1024 * 1024).unwrap();
    for _ in 0..8 {
        s.append(vec![
            record("2099-01-01T00:00:00.000Z", "host", "info");
            500
        ])
        .unwrap();
    }
    assert!(std::fs::metadata(&p).unwrap().len() > 262144);
    assert_eq!(LogStore::open(p).read(None).unwrap().records.len(), 4000);
    s.append_with_losses(vec![], 2, 1).unwrap();
    let data = s.read(None).unwrap();
    assert_eq!(data.dropped, 2);
    assert_eq!(data.dropped_important, 1);
    assert!(s.append_with_losses(vec![], 1, 2).is_err());
    s.configure(365, 1024).unwrap();
    let stats = s.stats().unwrap();
    assert_eq!(stats.effective_max_bytes, 1024);
    assert!(stats.stored_bytes <= 1024);
    assert_eq!(stats.max_records, 100000);
}
#[test]
fn corrupt_quarantine_is_never_overwritten_and_time_ranges_are_checked() {
    let d = dir();
    let p = d.path().join("diagnostics.json");
    std::fs::write(quarantine_path(&p), b"earlier-evidence").unwrap();
    std::fs::write(&p, b"new-corruption").unwrap();
    let s = LogStore::open(p.clone());
    assert!(s.read(None).is_err());
    assert!(s.clear().is_err());
    assert_eq!(std::fs::read(&p).unwrap(), b"new-corruption");
    assert_eq!(
        std::fs::read(quarantine_path(&p)).unwrap(),
        b"earlier-evidence"
    );
    let clean = LogStore::open(d.path().join("clean.json"));
    assert!(
        clean
            .read_filtered(ExportFilter {
                channel: None,
                from_timestamp: Some("2099-02-01T00:00:00.000Z".into()),
                to_timestamp: Some("2099-01-01T00:00:00.000Z".into())
            })
            .is_err()
    );
    assert!(clean.read(Some("unregistered")).is_err());
    assert_eq!(timestamp_ms("1970-01-01T00:00:00.000Z").unwrap(), 0);
    assert_eq!(
        timestamp_ms("2000-03-01T00:00:00.000Z").unwrap()
            - timestamp_ms("2000-02-28T00:00:00.000Z").unwrap(),
        2 * 86400000
    );
}
