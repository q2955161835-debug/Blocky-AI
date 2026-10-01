import { z } from "zod";
import { canonicalJson, type Json } from "@blocky/language-schema";
import { memoryRequestSchema, type MemoryInput, type MemoryResult } from "./memory";
import { utf8 } from "./budget";
export const sessionMetadataSchema=z.object({version:z.number().int().positive(),sourceRef:z.string().max(256).nullable(),summary:z.string().max(2048),summaryKind:z.enum(['manual','extract']),updatedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative().nullable(),deleted:z.boolean()}).strict();
export type SessionMetadata=z.infer<typeof sessionMetadataSchema>;
export type SessionLedger={entries:Map<string,SessionMetadata>;revoked:Set<string>};
export const newSessionLedger=():SessionLedger=>({entries:new Map(),revoked:new Set()});
export const memoryKey=(project:string,session:string,key:string)=>JSON.stringify([project,session,key]);
const revokeKey=(project:string,session:string,source:string)=>JSON.stringify([project,session,source]);
export function sessionRequest(values:Map<string,Json>,ledger:SessionLedger,project:string,session:string,input:MemoryInput,time=Math.floor(Date.now()/1000),deniedSources:ReadonlySet<string>=new Set()):MemoryResult {
 const r=memoryRequestSchema.parse({schemaVersion:'blocky.memory-request/v1',requestId:'session-memory',projectId:project,sessionId:session,...input});
 if(r.action==='check-source')return {readable:!ledger.revoked.has(revokeKey(project,session,r.sourceRef))};
 const visible=(key:string,meta?:SessionMetadata)=>values.has(key)&&!meta?.deleted&&(meta?.expiresAt===undefined||meta.expiresAt===null||meta.expiresAt>time)&&(!meta?.sourceRef||(!deniedSources.has(meta.sourceRef)&&!ledger.revoked.has(revokeKey(project,session,meta.sourceRef))));
 const metadata=(key:string):SessionMetadata=>ledger.entries.get(key)??{version:1,sourceRef:null,summary:canonicalJson(values.get(key)??null).slice(0,256),summaryKind:'extract',updatedAt:time,expiresAt:null,deleted:false};
 const view=(key:string)=>{const {deleted,...entry}=metadata(key);return {...entry,value:structuredClone(values.get(key)??null)};};
 if(r.action==='search') {
  const terms=(r.query??'').toLowerCase().split(/\s+/).filter(Boolean),entries=[];
  for(const [key,value] of values){const [p,s,k]=JSON.parse(key);if(p!==project||s!==session||!visible(key,ledger.entries.get(key)))continue;
   const entry=view(key);if(terms.every(t=>(k+' '+entry.summary+' '+canonicalJson(value)).toLowerCase().includes(t)))entries.push({key:k,entry});if(entries.length>=(r.limit??20))break;}
  if(utf8(canonicalJson(entries))>32768)throw Error('BLK-MEMORY-001');return {entries,time};
 }
 if(r.action==='revoke-source'||r.action==='allow-source') {
  const rk=revokeKey(project,session,r.sourceRef);
  if(r.action==='allow-source')ledger.revoked.delete(rk);
  else {if(ledger.revoked.size>=1024&&!ledger.revoked.has(rk))throw Error('BLK-MEMORY-001');
   const affected=[...ledger.entries].filter(([key,meta])=>{const [p,s]=JSON.parse(key);return p===project&&s===session&&meta.sourceRef===r.sourceRef;});
   if(affected.some(([,meta])=>!Number.isSafeInteger(meta.version+1)))throw Error('BLK-MEMORY-CONFLICT');
   ledger.revoked.add(rk);
   for(const [key,meta] of affected){values.delete(key);ledger.entries.set(key,{...meta,version:meta.version+1,deleted:true,summary:''});}
  }return {ok:true};
 }
 const key=memoryKey(project,session,r.key),old=ledger.entries.get(key),version=old?.version??(values.has(key)?1:0),found=visible(key,old);
 if(r.action==='read')return {found,version,entry:found?view(key):null};
 if(r.expectedVersion!==version || (r.action==='upsert'&&r.conflictPolicy==='reject'&&found))throw Error('BLK-MEMORY-CONFLICT');
 if(!Number.isSafeInteger(version+1))throw Error('BLK-MEMORY-CONFLICT');
 let value:Json=null;
 if(r.action==='upsert') {
  if(r.sourceRef&&ledger.revoked.has(revokeKey(project,session,r.sourceRef)))throw Error('BLK-PERM-001');value=r.value;
  if(r.conflictPolicy==='merge') {const incoming=value,previous=found?values.get(key):{};
   if(!incoming||typeof incoming!=='object'||Array.isArray(incoming)||!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('BLK-MEMORY-001');value={...previous,...incoming};}
  if(utf8(canonicalJson(value))>32768)throw Error('BLK-MEMORY-001');
 }
 const meta:SessionMetadata={version:version+1,sourceRef:r.action==='upsert'?r.sourceRef??null:null,summary:r.action==='upsert'?r.summary??(typeof value==='string'?value:canonicalJson(value)).slice(0,256):'',summaryKind:r.action==='upsert'&&r.summary!==undefined?'manual':'extract',updatedAt:time,expiresAt:r.action==='upsert'&&r.ttlSeconds?time+r.ttlSeconds:null,deleted:r.action==='delete'};
 const candidate=new Map(values);if(meta.deleted)candidate.delete(key);else candidate.set(key,structuredClone(value));
 const next=new Map(ledger.entries);next.set(key,meta);
 if(next.size>1024||utf8(JSON.stringify([...candidate]))+utf8(JSON.stringify([...next]))>1048576)throw Error('BLK-MEMORY-001');
 ledger.entries.set(key,meta);if(meta.deleted)values.delete(key);else values.set(key,structuredClone(value));
 return {ok:true,version:meta.version,...(!meta.deleted?{entry:view(key)}:{})};
}
