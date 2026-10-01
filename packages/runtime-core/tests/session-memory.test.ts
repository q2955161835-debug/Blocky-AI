import {it,expect} from 'vitest';
import {sessionRequest,newSessionLedger} from '../src/session-memory';
import {AgentExecution} from '../src/agent-execution';
import {RunBudget} from '../src/budget';
import {createAgentExample} from '../../block-catalog/src';
import type {Json} from '@blocky/language-schema';
it('filters expiry and source revocation, keeps versions and conflict state',()=>{
 const values=new Map<string,Json>(),ledger=newSessionLedger();const run=(input:Parameters<typeof sessionRequest>[4],time=100)=>sessionRequest(values,ledger,'project','session',input,time);
 const input={action:'upsert' as const,key:'note',value:{language:'zh'},expectedVersion:0,conflictPolicy:'replace' as const,ttlSeconds:2,sourceRef:'source'};
 expect(run(input).version).toBe(1);expect(run({action:'search',query:'zh'}).entries).toHaveLength(1);expect(run({action:'read',key:'note'},102).found).toBe(false);
 expect(()=>run(input)).toThrow('BLK-MEMORY-CONFLICT');expect(values.size).toBe(1);
 run({action:'revoke-source',sourceRef:'source'});run({action:'allow-source',sourceRef:'source'});expect(run({action:'read',key:'note'}).found).toBe(false);expect(run({action:'read',key:'note'}).version).toBe(2);
 expect(sessionRequest(values,ledger,'other','session',{action:'search'}).entries).toEqual([]);
});
it('preserves session provenance and expiry across a durable checkpoint',()=>{
 const budget=new RunBudget();try {
 const project=createAgentExample('project');const values=new Map<string,Json>(),ledger=newSessionLedger();sessionRequest(values,ledger,'project','session',{action:'upsert',key:'note',value:'hello',expectedVersion:0,conflictPolicy:'replace',sourceRef:'notes',summary:'manual',ttlSeconds:120});
 const source=new AgentExecution(project,'input','run','session',budget,{},undefined,values,undefined,ledger);const checkpoint=source.checkpoint();
 const restored=new AgentExecution(project,'input','run-two','session',budget);restored.restoreCheckpoint(checkpoint);expect(restored.checkpoint().sessionMemoryMetadata).toEqual(checkpoint.sessionMemoryMetadata);
 }finally{budget.dispose();}
});
