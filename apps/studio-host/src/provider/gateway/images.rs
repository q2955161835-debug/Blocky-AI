use super::GatewayRequest;
use crate::agent_data::media_store::{MediaRequest,MediaSnapshot,load_snapshot,check_current};
use std::path::Path;
use serde_json::{Value,json};
use base64::{Engine,engine::general_purpose::STANDARD};
fn snapshots(root:&Path,r:&GatewayRequest)->Result<Vec<(usize,MediaSnapshot)>,String>{
 let mut result=Vec::new();let mut bytes=0;
 for (i,message) in r.messages.iter().enumerate(){for image in &message.image_refs{
  let request=MediaRequest{schema_version:"blocky.media-request/v1".into(),request_id:r.request_id.clone(),project_id:r.project_id.clone(),session_id:"model-image".into(),action:"image-reference".into(),media_id:Some(image.media_id.clone()),expected_sha256:Some(image.sha256.clone()),expected_version:Some(image.version)};
  let snapshot=load_snapshot(&root.join("user/agent-media"),&request)?;bytes+=snapshot.image_bytes()?.len();if bytes>8*1024*1024{return Err("BLK-MEDIA-LIMIT".into());}result.push((i,snapshot));
 }}Ok(result)
}
pub(super) fn validate(root:&Path,r:&GatewayRequest)->Result<(),String>{for (_,snapshot) in snapshots(root,r)?{check_current(&root.join("user/agent-media"),&snapshot)?;}Ok(())}
pub(super) fn body(root:&Path,r:&GatewayRequest,model:&str,provider:&str)->Result<Value,String>{
 let mut body=r.body(model,provider);let snapshots=snapshots(root,r)?;
 for(i,message) in r.messages.iter().enumerate().filter(|(_,m)|!m.image_refs.is_empty()){
  let mut content=vec![json!({"type":"text","text":message.content})];
  for (_,snapshot) in snapshots.iter().filter(|(index,_)|*index==i){content.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",snapshot.metadata.mime_type,STANDARD.encode(snapshot.image_bytes()?))}}));}
  body["messages"][i]["content"]=json!(content);
 }Ok(body)
}
