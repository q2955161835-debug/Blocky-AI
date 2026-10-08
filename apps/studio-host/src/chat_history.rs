use serde_json::{json, Value};
const ERROR: &str = "BLK-SET-001";
fn keys(value: &Value, expected: &[&str]) -> Result<(), String> {
    let fields=value.as_object().ok_or(ERROR)?;
    if fields.len()!=expected.len() || fields.keys().any(|k| !expected.contains(&k.as_str())) {return Err(ERROR.into());}
    Ok(())
}
fn thread(value: &Value) -> Result<&str, String> {
    keys(value,&["id","title","createdAt","updatedAt"])?;
    let id=value["id"].as_str().ok_or(ERROR)?;
    let title=value["title"].as_str().ok_or(ERROR)?;
    if !crate::project_store::stable(id) || title.trim().is_empty() || title.chars().count()>180 {return Err(ERROR.into());}
    for key in ["createdAt","updatedAt"] {
        let date=value[key].as_str().ok_or(ERROR)?;
        if date.len()!=24 || !date.bytes().enumerate().all(|(i,b)|match i {4|7=>b==b'-',10=>b==b'T',13|16=>b==b':',19=>b==b'.',23=>b==b'Z',_=>b.is_ascii_digit()}) {return Err(ERROR.into());}
    }
    Ok(id)
}
pub fn validate(kind: &str, value: &Value) -> Result<(), String> {
    if crate::builder::contains_credentials(value) || !value["projectId"].as_str().is_some_and(crate::project_store::stable) || !matches!(value["assistant"].as_str(),Some("builder"|"agent")) {return Err(ERROR.into());}
    if kind=="chat-conversation" {
        keys(value,&["schemaVersion","projectId","assistant","thread","messages"])?;
        if value["schemaVersion"]!="blocky.chat-conversation/v1" {return Err(ERROR.into());}
        thread(&value["thread"])?;
        return crate::user_store::validate_chat(&json!({"schemaVersion":"blocky.coding-chat/v1","projectId":value["projectId"],"messages":value["messages"]}),true);
    }
    keys(value,&["schemaVersion","projectId","assistant","activeId","threads"])?;
    if value["schemaVersion"]!="blocky.chat-index/v1" || value["assistant"]!=if kind=="chat-history-builder" {"builder"} else {"agent"} {return Err(ERROR.into());}
    let threads=value["threads"].as_array().ok_or(ERROR)?;
    if threads.is_empty() || threads.len()>1000 {return Err(ERROR.into());}
    let mut ids=std::collections::HashSet::new();
    for item in threads {if !ids.insert(thread(item)?) {return Err(ERROR.into());}}
    if !ids.contains(value["activeId"].as_str().ok_or(ERROR)?) {return Err(ERROR.into());}
    Ok(())
}
pub fn binding(kind:&str,id:&str,value:&Value)->Result<(),String> {
    let key=if kind=="chat-conversation" {&value["thread"]["id"]} else {&value["projectId"]};
    if key!=id {return Err(ERROR.into());} Ok(())
}
