import type {Project,Resource,WorkspaceBlock} from '@blocky/language-schema';
import {createAgentExample} from '../agent-example';
export function delegationStarter(projectId:string):Project {
 const project=createAgentExample(projectId);project.manifest.displayName='协作 Agent';project.manifest.format.minimumReaderVersion='0.8.0';
 project.resources['agent-model'].definition.parameters={maxOutputTokens:256};
 project.schemas['schemas/agent-answer.json']={type:'string',maxLength:16000};
 const resource:Resource={schemaVersion:'blocky.resource/v1alpha1',resourceId:'collaborator',displayName:'协作模块',kind:'tool',scope:'project',secretBindings:[],capabilityRequirements:['module.execute'],definition:{version:'1',permissions:['module.execute'],implementationRef:{kind:'adapter',id:'module-tool-v1'},moduleId:'collaborator',exportId:'answer',inputSchemaRef:{kind:'schema',id:'text-input'},outputSchemaRef:{kind:'schema',id:'agent-answer'},inputSchemaJson:JSON.stringify(project.schemas['schemas/text-input.json']),outputSchemaJson:JSON.stringify(project.schemas['schemas/agent-answer.json']),timeoutMs:120000}};
 project.resources.collaborator=resource;project.manifest.resources.push({resourceId:'collaborator',kind:'tool',scope:'project',definitionRef:'resources/collaborator.json',secretRefs:[]});
 project.manifest.modules.push({moduleId:'collaborator',displayName:'协作 Agent 模块',purpose:'agent',workspaceRef:'workspaces/collaborator.workspace.json',exports:[{exportId:'answer',displayName:'回答',kind:'tool',inputSchemaRef:'schemas/text-input.json',outputSchemaRef:'schemas/agent-answer.json'}]});
 project.workspaces.collaborator={blocks:{languageVersion:0,blocks:[{type:'core.tool.entry',id:'collaborator-entry',fields:{EXPORT:'answer'},inputs:{BODY:{block:{type:'core.model.compose',id:'collaborator-model',fields:{RESOURCE:'agent-model'},next:{block:{type:'core.output.structured',id:'collaborator-answer',fields:{SCHEMA:'schemas/agent-answer.json'}}}}}}}]}};
 const root=project.workspaces['research-agent'].blocks.blocks[0];
 const delegate:WorkspaceBlock={type:'core.agent.delegate',id:'delegate',fields:{TASKS:JSON.stringify([{agentId:'draft',resourceId:'collaborator',permissions:['module.execute'],instruction:'根据用户需求提出简短初稿。'},{agentId:'review',resourceId:'collaborator',permissions:['module.execute'],instruction:'检查输入初稿并提出具体改进。'}]),MODE:'sequential',FAILURE:'stop',SOURCE:'input'},next:{block:{type:'core.output.answer',id:'summary',fields:{STYLE:'段落'}}}};
 root.inputs!.BODY.block!.next={block:{type:'core.run.budget',id:'collaboration-budget',fields:{STEPS:'100',CALLS:'8',OUTPUT_TOKENS:'1024',TIMEOUT_MS:'120000'},next:{block:delegate}}};
 return project;
}
