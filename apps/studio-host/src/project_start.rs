//! Startup can select a built-in project only, never arbitrary files or project data.
use std::ffi::OsString;

pub struct StartupProject(pub Option<String>);
pub fn validate(value: &str) -> Result<String, String> {
    match value {
        "blank" | "knowledge-assistant" | "work-assistant" | "coding-assistant" | "pi-agent" => Ok(value.into()),
        _ => Err("BLK-WINDOW-START".into()),
    }
}
pub fn from_options(args: impl IntoIterator<Item = OsString>) -> Result<Option<String>, String> {
    let mut args = args.into_iter();
    let mut starter = None;
    while let Some(arg) = args.next() {
        if arg == "--starting-project" {
            if starter.is_some() { return Err("BLK-WINDOW-START".into()); }
            let value = args.next().ok_or("BLK-WINDOW-START")?;
            starter = Some(validate(value.to_str().ok_or("BLK-WINDOW-START")?)?);
        }
    }
    Ok(starter)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_starters_and_rejects_missing_duplicate_or_arbitrary_data() {
        for value in ["blank", "knowledge-assistant", "work-assistant", "coding-assistant", "pi-agent"] {
            assert_eq!(from_options(["--profile-dir".into(), "D:\\task".into(), "--starting-project".into(), value.into()]).unwrap(), Some(value.into()));
        }
        for args in [vec!["--starting-project"], vec!["--starting-project", "D:\\project.blocky"], vec!["--starting-project", "{}"], vec!["--starting-project", "blank", "--starting-project", "work-assistant"]] {
            assert!(from_options(args.into_iter().map(OsString::from)).is_err());
        }
        assert_eq!(from_options([]).unwrap(), None);
    }
}
