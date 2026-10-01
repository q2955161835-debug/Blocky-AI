import {createAgentExample} from '../agent-example';
import type {Project} from '@blocky/language-schema';
export function decisionStarter(projectId:string):Project {
 const p=createAgentExample(projectId);p.manifest.displayName='英文候选评分';p.manifest.format.minimumReaderVersion='0.8.0';
 const model=p.resources['agent-model'];model.displayName='本地英文相关性模型';model.definition={provider:'local-cpu',protocol:'local',modelId:'ms-marco-minilm-l6-v2-int8-v1',capabilities:['rerank'],timeoutMs:120000,implementationRef:{kind:'adapter',id:'local-score-v1'}};model.capabilityRequirements=['model.score'];
 const root=p.workspaces['research-agent'].blocks.blocks[0];root.inputs!.BODY.block!.next={block:{type:'core.model.score',id:'candidate-score',fields:{RESOURCE:'agent-model',SOURCE:'input',LABELS:JSON.stringify([{id:'geography',description:'Geography and location information'},{id:'sports',description:'Sports and athlete information'}]),RULES:JSON.stringify([{contains:'scoreboard',label:'sports'}]),THRESHOLD:'0',FALLBACK:'unknown'},next:{block:{type:'core.output.answer',id:'decision-answer',fields:{STYLE:'段落'}}}}};return p;
}
