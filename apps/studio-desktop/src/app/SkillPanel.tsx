import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {InstalledSkills,skillResultSchema,type InstalledSkill,type SkillInput,type SkillResult} from '@blocky/runtime-core';
import {studioAgentServices} from '../composition/agent';
export function SkillPanel({projectId,onBind}:{projectId:string;onBind:(skill:InstalledSkill)=>void}) {
 const [skills,setSkills]=useState<InstalledSkill[]>([]),[body,setBody]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort();}},[]);
 async function operate(input:SkillInput,consume:(value:SkillResult)=>void){
  if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');const services=studioAgentServices();
  try{const result=await new InstalledSkills(services.skills!,projectId,`skill-panel-${crypto.randomUUID()}`).request(input,controller.signal);if(alive.current&&!controller.signal.aborted)consume(result);}
  catch(error){if(alive.current)setMessage(error instanceof Error&&/^BLK-/.test(error.message)?error.message:'Skill 操作未完成。');}
  finally{await services.close?.(controller.signal);active.current=null;if(alive.current)setBusy(false);}
 }
 async function install(){
  if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');
  try{const result=skillResultSchema.parse(await invoke('agent_skill_install',{projectId,sessionId:`skill-panel-${crypto.randomUUID()}`}));if(alive.current&&!controller.signal.aborted&&result.action==='install'){setSkills(old=>[...old.filter(s=>s.metadata.skillId!==result.skill.metadata.skillId),result.skill]);setMessage('Skill 已安装。');}}
  catch(error){if(alive.current)setMessage(typeof error==='string'&&/^BLK-/.test(error)?error:'安装未完成。请选择包含 blocky-skill.json 的技能目录。');}
  finally{active.current=null;if(alive.current)setBusy(false);}
 }
 return <section aria-label="已安装 Skill"><h3>已安装 Skill</h3>
  <button disabled={busy} onClick={()=>void operate({action:'discover'},r=>{if(r.action==='discover')setSkills(r.skills);})}>发现 Skill</button>
  <button disabled={busy} onClick={()=>void install()}>从目录安装</button>
  <p>选择后绑定到当前资源；正文按需加载，附属脚本不会自动运行。</p>
  <ul>{skills.map(skill=><li key={skill.metadata.skillId}><strong>{skill.metadata.name}</strong> · {skill.metadata.version}<p>{skill.metadata.summary}</p><p>声明工具：{skill.metadata.toolIds.join('、')||'无'}</p>
   <button disabled={busy} onClick={()=>onBind(skill)}>绑定此 Skill</button>
   <button disabled={busy} onClick={()=>void operate({action:'load',skillId:skill.metadata.skillId,expectedDigest:skill.digest},r=>{if(r.action==='load')setBody(r.body);})}>查看正文</button>
   <button disabled={busy} onClick={()=>void operate({action:'uninstall',skillId:skill.metadata.skillId,expectedDigest:skill.digest},()=>{setSkills(old=>old.filter(s=>s.digest!==skill.digest));setBody('');})}>卸载</button>
  </li>)}</ul>
  {body&&<textarea aria-label="Skill 正文" readOnly value={body}/>}
  {busy&&<button onClick={()=>active.current?.abort()}>停止</button>}{message&&<p role="status">{message}</p>}
 </section>;
}
