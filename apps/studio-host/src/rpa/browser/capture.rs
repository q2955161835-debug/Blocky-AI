use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value,json};
use std::{sync::{Arc,atomic::AtomicBool},time::Instant};
use super::BrowserProcess;
const ERROR:&str="BLK-RPA-CAPTURE-002";
#[derive(Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
struct Meta {capture_id:String,bytes:usize,masked_regions:u32}
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct Chunk {offset:usize,data:String,done:bool}
pub(super) fn receive(process:&mut BrowserProcess,request:Value,timeout:u64,cancel:Arc<AtomicBool>)->Result<(Vec<u8>,u32),String> {
    let started=Instant::now();
    let result=process.request(request.clone(),timeout,cancel.clone())?;
    let meta:Meta=serde_json::from_value(result["capture"].clone()).map_err(|_|ERROR)?;
    if meta.bytes==0||meta.bytes>super::super::capture_png::LIMIT||meta.masked_regions>2048
        ||meta.capture_id.strip_prefix("capture-").and_then(|id|uuid::Uuid::parse_str(id).ok()).is_none(){return Err(ERROR.into());}
    let mut bytes=Vec::with_capacity(meta.bytes);
    let result=(|| {
        while bytes.len()<meta.bytes {
            let remaining=timeout.saturating_sub(started.elapsed().as_millis()as u64);
            if remaining==0{return Err("BLK-RPA-TIMEOUT-001".into());}
            let response=process.request(json!({"kind":"capture-read","identity":request["identity"],"token":request["token"],"stepId":request["stepId"],"captureId":meta.capture_id,"offset":bytes.len()}),remaining,cancel.clone())?;
            let chunk:Chunk=serde_json::from_value(response).map_err(|_|ERROR)?;
            if chunk.offset!=bytes.len()||chunk.data.len()>43692{return Err(ERROR.into());}
            let mut part=STANDARD.decode(&chunk.data).map_err(|_|ERROR)?;
            let valid=part.len()==32768.min(meta.bytes-bytes.len())&&chunk.done==(bytes.len()+part.len()==meta.bytes);
            if valid {bytes.extend_from_slice(&part);}crate::secret_store::wipe(&mut part);
            if !valid{return Err(ERROR.into());}
        }
        Ok(())
    })();
    if let Err(code)=result {crate::secret_store::wipe(&mut bytes);return Err(code);}
    Ok((bytes,meta.masked_regions))
}
