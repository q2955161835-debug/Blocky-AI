import {expect,it} from 'vitest';
import { delegationStarter } from "../../test-fixtures/src/scenarios";
import {compileProject} from '../../compiler/src';
import {Runtime,localAdapters} from '../src';
import type {GenerationRequest,Generation} from '../src';
function fixture(mode='sequential') {
 const project=delegationStarter('delegation-test');const root=project.workspaces['research-agent'].blocks.blocks[0];const delegate=root.inputs!.BODY.block!.next!.block!.next!.block!;delegate.fields!.MODE=mode;
 project.resources['agent-model'].definition={provider:'deepseek',modelId:'unit-model',protocol:'openai-chat',timeoutMs:30000,capabilities:['text'],parameters:{maxOutputTokens:64},implementationRef:{kind:'adapter',id:'deepseek-v1'}};
 const requests:GenerationRequest[]=[],adapters=localAdapters();adapters.agent={generate:async(request)=>{requests.push(structuredClone(request));await new Promise(r=>setTimeout(r,10));return {text:'result-'+requests.length,provider:'unit',transport:'local',model:'unit-model',requestId:request.requestId,usage:null} satisfies Generation;}};
 return {project,delegate,requests,adapters};
}
it('runs actual child module model ports in sequence and carries result and identity',async()=>{
 const f=fixture();expect((await compileProject(f.project)).diagnostics).toEqual([]);const result=await new Runtime({adapters:f.adapters}).run(f.project,'on-question','lesson');
 expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');expect(f.requests).toHaveLength(2);expect(f.requests[1].messages[1].content).toContain('result-1');expect(result.generations).toHaveLength(2);
 const receipts=result.events.filter(e=>e.type==='tool.completed'&&e.blockId==='delegate');expect(receipts.map(e=>e.data.agentId)).toEqual(['draft','review']);expect(result.structured).toMatchObject([{agentId:'draft',status:'completed'},{agentId:'review',status:'completed'}]);
});
it('allows independent parallel calls to the same export and preserves both sources',async()=>{
 const f=fixture('parallel');const result=await new Runtime({adapters:f.adapters}).run(f.project,'on-question','lesson');expect(result.status).toBe('completed');expect(f.requests).toHaveLength(2);expect(new Set(f.requests.map(r=>r.requestId)).size).toBe(2);expect(result.events.filter(e=>e.blockId==='collaborator-model'&&e.type==='block.completed').map(e=>e.data.agentId).sort()).toEqual(['draft','review']);
});
it('child cannot expand memory permissions by adding an undeclared block',async()=>{
 const f=fixture();const body=f.project.workspaces.collaborator.blocks.blocks[0].inputs!.BODY.block!;body.next={block:{type:'core.memory.write',id:'forbidden',fields:{SCOPE:'session',KEY:'steal',SOURCE:'result'}}};
 const result=await new Runtime({adapters:f.adapters}).run(f.project,'on-question','lesson');expect(result.structured).toMatchObject([{status:'failed',code:'BLK-AGENT-PERMISSION'},{status:'skipped'}]);expect(f.requests).toHaveLength(1);
});
