use super::*;
use std::sync::atomic::{AtomicBool,Ordering};
impl AgentData {
 fn extension_grant(&self,state:&State,token:&str,project:&str,session:&str)->Result<(),String>{state.grants.get(token).filter(|g|!state.closed&&g.project==project&&g.session==session&&g.created.elapsed()<g.lifetime).ok_or(PERMISSION)?;Ok(())}
 pub fn manage_evaluation(&self,token:&str,r:&evaluation_store::Request)->Result<Value,String>{
  r.validate()?;let state=self.state.lock().map_err(|_|INVALID)?;self.extension_grant(&state,token,&r.project_id,&r.session_id)?;
  evaluation_store::manage(&self.root.parent().ok_or(INVALID)?.join("agent-evaluation"),r)
 }
 pub fn infer_decision(&self,token:&str,r:&decision::DecisionRequest)->Result<Value,String>{
  r.validate()?;let cancel={let mut state=self.state.lock().map_err(|_|INVALID)?;self.extension_grant(&state,token,&r.project_id,&r.session_id)?;
   if state.decision_tasks.len()>=2||state.used_decisions.len()>=4096||!state.used_decisions.insert(r.request_id.clone()){return Err("BLK-DECISION-BUSY".into());}
   let cancel=Arc::new(AtomicBool::new(false));state.decision_tasks.insert(r.request_id.clone(),(token.into(),cancel.clone()));cancel};
  let result=decision::decision(r,&cancel);
  let mut state=self.state.lock().map_err(|_|INVALID)?;state.decision_tasks.remove(&r.request_id);
  if cancel.load(Ordering::SeqCst){return Err("BLK-DECISION-CANCELLED".into());}self.extension_grant(&state,token,&r.project_id,&r.session_id)?;
  serde_json::to_value(result?).map_err(|_|INVALID.into())
 }
 pub fn cancel_decision(&self,token:&str,request_id:&str)->Result<(),String>{
  if !stable(request_id){return Err(INVALID.into());}let state=self.state.lock().map_err(|_|INVALID)?;
  if let Some((owner,cancel))=state.decision_tasks.get(request_id){if owner!=token{return Err(PERMISSION.into());}cancel.store(true,Ordering::SeqCst);}Ok(())
 }
}
