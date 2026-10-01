import {expect,it,vi} from 'vitest';
import {createAgentExample} from '../../block-catalog/src';
import {AgentExecution} from '../src/agent-execution';
import {RunBudget} from '../src/budget';
import {NativeMedia,type MediaPort} from '../src/media';
import type {IrNode,Resource} from '@blocky/language-schema';
const reference={mediaId:'media-one',sha256:'a'.repeat(64),version:1};
const metadata={...reference,mimeType:'image/png' as const,byteLength:10,width:1,height:1};
const node=(blockType:string,fields:IrNode['fields']):IrNode=>({nodeId:'media-step',blockType,fields,inputs:{}});
const model:Resource={schemaVersion:'blocky.resource/v1alpha1',resourceId:'vision',kind:'model',scope:'project',displayName:'Vision',definition:{provider:'deepseek',modelId:'deepseek-flash',capabilities:['text','image'],implementationRef:{kind:'adapter',id:'deepseek-v1'}},secretBindings:[],capabilityRequirements:[]};
it('attaches only an opaque image reference to the normal model port and blocks a text-only model',async()=>{
 const budget=new RunBudget(),generate=vi.fn(async(_request:Parameters<NonNullable<import('../src/agent-context').AgentServices['generate']>>[0])=>({text:'Red circle.',provider:'deepseek',transport:'remote' as const,model:'deepseek-flash',requestId:'response-one',usage:{inputTokens:2,outputTokens:2,totalTokens:4}}));
 try{const state=new AgentExecution(createAgentExample('media-project'),'Describe it','run-one','session-one',budget,{media:async()=>({metadata}),generate});state.allowedCapabilities=['media.read'];
 await state.execute(node('core.media.image',{MEDIA_ID:reference.mediaId,SHA256:reference.sha256,VERSION:1}),async()=>{});
 await expect(state.compose({...model,definition:{...model.definition,capabilities:['text']}},'',[],'request-one')).rejects.toThrow('BLK-MODEL-CAPABILITY');expect(generate).not.toHaveBeenCalled();
 await state.compose(model,'',[],'request-two');expect(generate.mock.calls[0]?.[0]).toMatchObject({messages:expect.arrayContaining([expect.objectContaining({role:'user',imageRefs:[reference]})])});expect(JSON.stringify(generate.mock.calls)).not.toContain('data:image');
 }finally{budget.dispose();}
});
it('a deleted media source invalidates a restored durable context before model dispatch',async()=>{
 const project=createAgentExample('media-project'),budget=new RunBudget(),generate=vi.fn();let deleted=false;
 const media:MediaPort=async()=>{if(deleted)throw Error('BLK-MEDIA-MISSING');return {metadata};};
 try{const state=new AgentExecution(project,'input','run-one','session-one',budget,{media,generate});state.allowedCapabilities=['media.read'];await state.execute(node('core.media.image',{MEDIA_ID:reference.mediaId,SHA256:reference.sha256,VERSION:1}),async()=>{});state.generated='Old private image result';const checkpoint=state.checkpoint();
 const restored=new AgentExecution(project,'input','run-two','session-one',budget,{media,generate});restored.restoreCheckpoint(checkpoint);deleted=true;await expect(restored.compose(model,'',[],'request-two')).rejects.toThrow('BLK-MEDIA-MISSING');expect(restored.value).toBeNull();expect(restored.generated).toBeUndefined();expect(generate).not.toHaveBeenCalled();
 }finally{budget.dispose();}
});
it('session memory from a transcription keeps provenance and becomes unreadable after deletion',async()=>{
 const budget=new RunBudget();let readable=true;try{const state=new AgentExecution(createAgentExample('media-project'),'input','run-one','session-one',budget,{media:async()=>({metadata:{...reference,mimeType:'audio/wav',byteLength:44,durationMs:10},transcript:{language:'en',segments:[{text:'private transcript',fromMs:0,toMs:10}]}}),memoryEntries:async()=>({readable})});state.allowedCapabilities=['media.read'];
 await state.execute(node('core.media.transcribe',{MEDIA_ID:reference.mediaId,SHA256:reference.sha256,VERSION:1}),async()=>{});await state.execute(node('core.memory.write',{SCOPE:'session',KEY:'note',SOURCE:'result'}),async()=>{});expect(state.checkpoint().sessionMemoryMetadata?.[0]?.entry.sourceRef).toBe(`media/${reference.mediaId}/${reference.sha256}/1`);
 readable=false;await state.execute(node('core.memory.read',{SCOPE:'session',KEY:'note'}),async()=>{});expect(state.value).toBeNull();expect(state.memory).toBeNull();
 }finally{budget.dispose();}
});
it('media access rejects capabilities, substituted metadata, and a late response after cancellation',async()=>{
 const budget=new RunBudget(),port=vi.fn(async()=>({metadata}));try{const state=new AgentExecution(createAgentExample('media-project'),'input','run-one','session-one',budget,{media:port});state.allowedCapabilities=[];await expect(state.execute(node('core.media.image',{MEDIA_ID:reference.mediaId,SHA256:reference.sha256,VERSION:1}),async()=>{})).rejects.toThrow('BLK-PERM-001');expect(port).not.toHaveBeenCalled();}finally{budget.dispose();}
 const input={action:'summary' as const,mediaId:reference.mediaId,expectedSha256:reference.sha256,expectedVersion:1};await expect(new NativeMedia(async()=>({metadata:{...metadata,version:2}}),'project','session').request(input,new AbortController().signal)).rejects.toThrow('BLK-MEDIA-INTEGRITY');
 const controller=new AbortController();await expect(new NativeMedia(async()=>{controller.abort();return {metadata};},'project','session').request(input,controller.signal)).rejects.toThrow();
});
it('project memory records the Host entry version and remains usable until its media is deleted',async()=>{
 const budget=new RunBudget();let saved:import('../src/memory').MemoryEntry|undefined;let deleted=false;
 try{const state=new AgentExecution(createAgentExample('media-project'),'input','run-one','session-one',budget,{media:async()=>{if(deleted)throw Error('BLK-MEDIA-MISSING');return {metadata};},memoryEntries:async(request):Promise<import('@blocky/language-schema').Json>=>{
  if(request.action==='check-source')return {readable:!deleted};
  if(request.action==='read')return {found:!!saved&&!deleted,version:saved?.version??0,entry:deleted?null:saved??null};
  if(request.action==='upsert'){saved={version:1,value:request.value,sourceRef:request.sourceRef??null,summary:'',summaryKind:'extract',updatedAt:1,expiresAt:null};return {ok:true,entry:saved};}
  throw Error('Unexpected memory operation');
 }});state.allowedCapabilities=['media.read'];await state.execute(node('core.media.image',{MEDIA_ID:reference.mediaId,SHA256:reference.sha256,VERSION:1}),async()=>{});await state.execute(node('core.memory.write',{SCOPE:'project',KEY:'note',SOURCE:'result'}),async()=>{});
 expect(state.checkpoint().memoryBinding?.keys).toEqual([{key:'note',version:1}]);await expect(state.refreshMemoryContext()).resolves.toBeUndefined();deleted=true;await expect(state.refreshMemoryContext()).rejects.toThrow('BLK-MEDIA-MISSING');expect(state.value).toBeNull();expect(state.memory).toBeNull();
 }finally{budget.dispose();}
});
