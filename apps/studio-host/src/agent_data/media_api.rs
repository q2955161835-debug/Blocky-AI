use super::*;
use std::sync::atomic::{AtomicBool,Ordering};
pub(super) struct Active {pub token:String,pub project:String,pub media_id:String,pub cancel:Arc<AtomicBool>}
impl AgentData {
    pub fn preview_media(&self,token:&str,r:&media_store::MediaRequest)->Result<Value,String>{
        use base64::{Engine,engine::general_purpose::STANDARD};r.validate()?;if r.action!="image-reference"{return Err(INVALID.into());}
        let state=self.state.lock().map_err(|_|INVALID)?;self.media_grant(&state,token,&r.project_id,&r.session_id)?;
        let snapshot=media_store::load_snapshot(&self.media_root()?,r)?;let data=STANDARD.encode(snapshot.image_bytes()?);
        Ok(json!({"metadata":snapshot.metadata,"dataUrl":format!("data:{};base64,{}",snapshot.metadata.mime_type,data)}))
    }
    fn media_root(&self)->Result<PathBuf,String>{Ok(self.root.parent().ok_or(INVALID)?.join("agent-media"))}
    fn media_grant(&self,state:&State,token:&str,project:&str,session:&str)->Result<(),String>{
        state.grants.get(token).filter(|g|!state.closed&&g.project==project&&g.session==session&&g.created.elapsed()<g.lifetime).ok_or(PERMISSION)?;Ok(())
    }
    pub fn import_media(&self,token:&str,project:&str,session:&str,input:&media_store::NativeMedia)->Result<Value,String>{
        validate_context(project,session)?;let state=self.state.lock().map_err(|_|INVALID)?;self.media_grant(&state,token,project,session)?;
        Ok(json!({"metadata":media_store::import_media(&self.media_root()?,project,input)?}))
    }
    pub fn manage_media(&self,token:&str,r:&media_store::MediaRequest)->Result<Value,String>{
        r.validate()?;let root=self.media_root()?;
        if r.action!="transcribe" {
            let state=self.state.lock().map_err(|_|INVALID)?;self.media_grant(&state,token,&r.project_id,&r.session_id)?;
            if r.action=="image-reference" {let snapshot=media_store::load_snapshot(&root,r)?;snapshot.image_bytes()?;return Ok(json!({"metadata":snapshot.metadata}));}
            let result=media_store::manage(&root,r)?;
            if r.action=="delete" {for task in state.media_tasks.values().filter(|t|t.project==r.project_id&&Some(&t.media_id)==r.media_id.as_ref()){task.cancel.store(true,Ordering::SeqCst);}}
            return Ok(result);
        }
        let (snapshot,cancel)={let mut state=self.state.lock().map_err(|_|INVALID)?;self.media_grant(&state,token,&r.project_id,&r.session_id)?;
            if state.used_media.len()>=4096||state.media_tasks.len()>=2||!state.used_media.insert(r.request_id.clone()){return Err("BLK-MEDIA-BUSY".into());}
            let snapshot=media_store::load_snapshot(&root,r)?;let cancel=Arc::new(AtomicBool::new(false));
            state.media_tasks.insert(r.request_id.clone(),Active {token:token.into(),project:r.project_id.clone(),media_id:r.media_id.clone().ok_or(INVALID)?,cancel:cancel.clone()});(snapshot,cancel)};
        let result=media_store::transcribe(&root,&snapshot,&cancel);
        let mut state=self.state.lock().map_err(|_|INVALID)?;state.media_tasks.remove(&r.request_id);
        if cancel.load(Ordering::SeqCst){return Err("BLK-MEDIA-CANCELLED".into());}
        self.media_grant(&state,token,&r.project_id,&r.session_id)?;media_store::check_current(&root,&snapshot)?;
        Ok(json!({"metadata":snapshot.metadata,"transcript":result?}))
    }
    pub fn cancel_media(&self,token:&str,request_id:&str)->Result<(),String>{
        if !stable(request_id){return Err(INVALID.into());}let state=self.state.lock().map_err(|_|INVALID)?;
        if let Some(task)=state.media_tasks.get(request_id){if task.token!=token{return Err(PERMISSION.into());}task.cancel.store(true,Ordering::SeqCst);}Ok(())
    }
}
