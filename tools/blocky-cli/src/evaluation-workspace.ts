import {createInterface} from 'node:readline/promises';
import {digest,type Json} from '@blocky/language-schema';
import {projectDigest} from '@blocky/project-model';
import {compileProject} from '@blocky/compiler';
import {resolveResource} from '@blocky/resource-registry';
import {Runtime,hostAdapters,nativeAgentServices,NativeEvaluationStore,createRuntimeEvaluationExecutor,runEvaluation,createEvaluationDataset,forkEvaluationDataset,saveEvaluationAsset,importEvaluationDataset,evaluationCheckpointSchema,type PendingApproval} from '@blocky/runtime-core';
import {evaluationCommand,evaluationHelp} from './evaluation';
import {readJsonArtifact} from './artifacts';
import {readProject,nativeUserOperation} from './native-store';
import {userRegistryMap} from './user-config';
import {allow,required,type Args} from './arguments';
import {CliError,envelope} from './protocol';
import type {RunAgentContext} from './run-agent';
import {cliWorkflowPorts} from './workflow-session';
import {cliRpaModules} from './rpa-module';
export const evaluationWorkspaceHelp=[...evaluationHelp,
 'evaluation create <file.blocky> --input <cases.json> [--name <name>] [--model <resource-id>] --interactive --json',
 'evaluation fork <file.blocky> --dataset-key <id:vN> [--model <resource-id>] --interactive --json',
 'evaluation run <file.blocky> --dataset-key <id:vN> [--entry <id>] [--module <id>] [--checkpoint-key <key>] --interactive --jsonl',
];
export async function evaluationWorkspaceCommand(args:Args,write:(v:unknown)=>void,signal:AbortSignal,context?:RunAgentContext){
 if(args.words[0]!=='evaluation'||['preflight','execute'].includes(args.words[1]))return;
 const action=args.words[1],special=['create','fork','run'].includes(action),approved=new Set<string>();
 if(args.options.has('approval-file')){const hashes=await readJsonArtifact(required(args,'approval-file'),65536);if(!Array.isArray(hashes)||hashes.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x)))throw new CliError(2,'BLK-CLI-002','批准清单无效。');hashes.forEach(x=>approved.add(x));}
 const approve=async(value:PendingApproval,s:AbortSignal)=>{write(envelope('evaluation.approval-required',value));if(context)return context.approve(value,s);const lines=createInterface({input:process.stdin,output:process.stderr,terminal:false});try{return(await lines.question('输入该请求的完整摘要以批准，其他输入拒绝：\n',{signal:s})).trim()===value.requestDigest;}finally{lines.close();}};
 const call=async(operation:string,fields:Record<string,unknown>,s?:AbortSignal)=>{try{return await nativeUserOperation(operation,fields,s);}catch(e){if(e instanceof CliError)throw Error(e.code);throw e;}};
 const nativeOptions={mode:'cli' as const,live:true,approved,...(args.options.has('interactive')?{approve}:{}),pending:(value:PendingApproval)=>write(envelope('evaluation.approval-required',value))};
 const services=nativeAgentServices(call,nativeOptions);
 const assetLifetime=new AbortController();
 const clean:Args={words:args.words,options:new Map([...args.options].filter(([k])=>!['interactive','approval-file'].includes(k)))};
 try {
  if(!special)return await evaluationCommand(clean,signal,services.evaluation);
  allow(clean,action==='create'?['input','name','model','json']:action==='fork'?['dataset-key','model','json']:['dataset-key','checkpoint-key','entry','module','json','jsonl'],3);
  const project=await readProject(clean.words[2]),registry=await userRegistryMap(),configurationHash=await digest({project,resources:[...registry.values()]} as unknown as Json);
  signal.throwIfAborted();
  const store=new NativeEvaluationStore(services.evaluation!,project.manifest.projectId,`evaluation-cli-${crypto.randomUUID()}`,assetLifetime.signal);
  if(action==='create'||action==='fork'){
   const modelId=typeof clean.options.get('model')==='string'?String(clean.options.get('model')):project.manifest.resources.find(r=>r.kind==='model')?.resourceId;if(!modelId)throw Error('BLK-EVAL-MODEL-BINDING');const model=resolveResource(project,modelId,'model',registry),modelHash=await digest(model as unknown as Json);
   const binding={configurationHash,model:{resourceId:model.resourceId,provider:String(model.definition.provider),modelId:String(model.definition.modelId),version:`configuration-${modelHash.slice(0,16)}`}};
   let dataset;if(action==='fork'){const old=await store.read('dataset',required(clean,'dataset-key'));if(!old||old.kind!=='dataset')throw Error('BLK-EVAL-DATASET-NOT-FOUND');dataset=await forkEvaluationDataset(old.value,{binding},Date.now());}else{const cases=await readJsonArtifact(required(clean,'input'),8*1024*1024);dataset=createEvaluationDataset({datasetId:`dataset-${crypto.randomUUID()}`,name:typeof clean.options.get('name')==='string'?String(clean.options.get('name')):'项目评估集',createdAt:Date.now(),binding,cases:cases as never});}
   const saved=await saveEvaluationAsset(store,'dataset',dataset,null);return {code:0,result:envelope(`evaluation.${action}`,{key:saved.key,revision:saved.revision,dataset})};
  }
  const asset=await store.read('dataset',required(clean,'dataset-key'));if(!asset||asset.kind!=='dataset')throw Error('BLK-EVAL-DATASET-NOT-FOUND');const dataset=await importEvaluationDataset(asset.value);if(dataset.binding.configurationHash!==configurationHash)throw Error('BLK-EVAL-MODEL-BINDING');
  const bound=resolveResource(project,dataset.binding.model.resourceId,'model',registry);if(bound.definition.provider!==dataset.binding.model.provider||bound.definition.modelId!==dataset.binding.model.modelId||`configuration-${(await digest(bound as unknown as Json)).slice(0,16)}`!==dataset.binding.model.version)throw Error('BLK-EVAL-MODEL-BINDING');
  const compiled=await compileProject(project,registry),entries=compiled.interaction.entries.filter(e=>(!clean.options.has('entry')||e.interactionId===clean.options.get('entry'))&&(!clean.options.has('module')||e.moduleId===clean.options.get('module')));if(entries.length!==1)throw Error('BLK-EVAL-RUN-ENTRY');const entry=entries[0];
  const candidateHash=await projectDigest(project),candidate={id:project.manifest.projectId,version:`configuration-${candidateHash.slice(0,16)}`,contentHash:candidateHash};let checkpoint;
  if(clean.options.has('checkpoint-key')){const old=await store.read('checkpoint',required(clean,'checkpoint-key'));if(!old||old.kind!=='checkpoint')throw Error('BLK-EVAL-CHECKPOINT');checkpoint={value:evaluationCheckpointSchema.parse(old.value),revision:old.revision};}
  const execute=createRuntimeEvaluationExecutor({project,userRegistry:registry,interactionId:entry.interactionId,moduleId:entry.moduleId,createRuntime:caseContext=>{const owned=nativeAgentServices(call,nativeOptions),runtime=new Runtime({adapters:{...hostAdapters(call,owned,cliRpaModules({})),workflow:context?.workflow??cliWorkflowPorts()}});return {run:runtime.run.bind(runtime),dispose:()=>owned.close?.(caseContext.signal)};}});
  const result=await runEvaluation({dataset,candidate,store,execute,signal,checkpointId:checkpoint?.value.checkpointId??`checkpoint-${crypto.randomUUID()}`,reportId:checkpoint?.value.reportId??`report-${crypto.randomUUID()}`,...(checkpoint?{checkpoint}:{})});
  return {code:result.report.status==='completed'?0:7,result:envelope('evaluation.run',result)};
 }finally{try{await services.close?.(assetLifetime.signal);await services.close?.(signal);}finally{assetLifetime.abort();}}
}
