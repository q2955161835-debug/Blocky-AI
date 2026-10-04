import { createWorkspace, flatten } from '../data';
import type { Workspace, WorkspaceBlock } from '../../../packages/language-schema/src/index';

export const duration=60;
export const buildPrompt='帮我搭建一个工作助手：接收任务，在选定的工作目录中读取资料、汇总数据，生成 Markdown 周报并读回核对。把角色、指令、运行预算、文件工具、计算工具、记忆和回答连接成一个可编辑的积木 Agent。';
export const taskPrompt='读取示例工作目录里的本周任务清单，按已完成、进行中和待协作整理周报，汇总工时，并生成周报.md。';
export const delivery='周报已整理完成。\n\n已完成：官网文案，4 小时。\n进行中：登录页联调，3 小时。\n待协作：测试用例，2 小时。\n合计：9 小时。\n\n已生成周报.md，并读回核对了任务分类与工时。';
export const report='# 本周工作周报\n\n| 状态 | 任务 | 工时 |\n| --- | --- | --- |\n| 已完成 | 官网文案 | 4 小时 |\n| 进行中 | 登录页联调 | 3 小时 |\n| 待协作 | 测试用例 | 2 小时 |\n\n**合计：9 小时**\n\n下周重点：完成登录页联调，协调测试用例评审。';
export const stageLabels=['构建工作助手','交给 Agent 执行','查看工作成果'] as const;
export type DemoAction=
  | {kind:'message';mode:'builder'|'agent';role:'user'|'assistant';text:string}
  | {kind:'trace';mode:'builder'|'agent';text:string;blockId?:string}
  | {kind:'workspace';stage:1|2|3|4;focus:string}
  | {kind:'mode';mode:'agent'}
  | {kind:'result'};
export const timeline:{at:number;action:DemoAction}[]=[
  {at:6,action:{kind:'message',mode:'builder',role:'user',text:buildPrompt}},
  {at:8,action:{kind:'message',mode:'builder',role:'assistant',text:'我会搭建一个能读取资料、整理周报并核对交付的工作助手。先定义角色与任务入口，再连接工具和输出。'}},
  {at:10,action:{kind:'trace',mode:'builder',text:'project_context · 查看空白 main 画布'}},
  {at:13,action:{kind:'workspace',stage:1,focus:'assistant-root'}},
  {at:14,action:{kind:'trace',mode:'builder',text:'blocky_cli · 创建智能体与任务入口'}},
  {at:18,action:{kind:'workspace',stage:2,focus:'assistant-work-instructions'}},
  {at:19,action:{kind:'trace',mode:'builder',text:'blocky_cli · 加入工作指令与运行预算'}},
  {at:22,action:{kind:'message',mode:'builder',role:'assistant',text:'现在连接文件与计算工具。助手会先读取资料，计算汇总，再生成周报并读回检查。'}},
  {at:25,action:{kind:'workspace',stage:3,focus:'assistant-tool-loop'}},
  {at:26,action:{kind:'trace',mode:'builder',text:'blocky_cli · 连接模型、文件工具与计算工具'}},
  {at:30,action:{kind:'workspace',stage:4,focus:'assistant-root'}},
  {at:31,action:{kind:'trace',mode:'builder',text:'blocky_cli · 加入交付记忆与回答，检查积木结构'}},
  {at:33,action:{kind:'message',mode:'builder',role:'assistant',text:'工作助手已搭好。角色、任务入口、指令、预算、工具、记忆与回答都已连接。接下来给它一项工作，看看完整流程。'}},
  {at:36,action:{kind:'mode',mode:'agent'}},
  {at:40,action:{kind:'message',mode:'agent',role:'user',text:taskPrompt}},
  {at:42,action:{kind:'message',mode:'agent',role:'assistant',text:'我先读取本周任务清单，按状态整理，并核算总工时。随后生成周报，再读回核对。'}},
  {at:44,action:{kind:'trace',mode:'agent',text:'workspace_list · 找到本周任务.csv',blockId:'assistant-tool-1'}},
  {at:46,action:{kind:'trace',mode:'agent',text:'workspace_read · 读取 3 项任务与工时',blockId:'assistant-tool-3'}},
  {at:49,action:{kind:'trace',mode:'agent',text:'calculate · 4 + 3 + 2 = 9 小时',blockId:'assistant-tool-6'}},
  {at:52,action:{kind:'trace',mode:'agent',text:'workspace_write · 生成周报.md',blockId:'assistant-tool-4'}},
  {at:55,action:{kind:'trace',mode:'agent',text:'workspace_read · 读回周报，核对分类与工时',blockId:'assistant-tool-3'}},
  {at:58,action:{kind:'message',mode:'agent',role:'assistant',text:delivery}},
  {at:60,action:{kind:'result'}},
];

/** Stage snapshots keep the actual blueprint's IDs, fields and nested language. */
export function buildStage(stage:1|2|3|4):Workspace {
  const value=createWorkspace('work-assistant');
  const allowed=new Set(['assistant-root','assistant-chat-trigger']);
  if(stage>=2){allowed.add('assistant-work-instructions');allowed.add('assistant-run-budget');}
  if(stage>=3){allowed.add('assistant-tool-loop');for(const block of flatten(value))if(block.type==='core.tool.expose')allowed.add(block.id!);}
  if(stage>=4){allowed.add('assistant-remember-delivery');allowed.add('assistant-answer');}
  function prune(block:WorkspaceBlock|undefined):WorkspaceBlock|undefined {
    if(!block)return;
    if(!allowed.has(block.id!))return prune(block.next?.block);
    for(const [name,input] of Object.entries(block.inputs??{})){const child=prune(input.block);if(child)input.block=child;else delete block.inputs![name];}
    if(block.next){const next=prune(block.next.block);if(next)block.next.block=next;else delete block.next;}
    return block;
  }
  value.blocks.blocks=value.blocks.blocks.map(prune).filter((block):block is WorkspaceBlock=>!!block);
  return value;
}
