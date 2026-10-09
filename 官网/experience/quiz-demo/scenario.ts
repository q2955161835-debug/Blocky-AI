import type { Workspace, WorkspaceBlock } from '../../../packages/language-schema/src/index';
import type { DemoAction } from '../guided-demo/scenario';
import finalWorkspace from './workspace.json';
import { localizeWorkspace } from '../data';
import { quizPrompt, generatePrompt, explanationPrompt, explanationReply, followupPrompt, followupReply } from './content';

export const quizDuration = 180;
export const quizTimeline: { at: number; action: DemoAction }[] = [
  {at:7,action:{kind:'message',mode:'builder',role:'user',text:quizPrompt}},
  {at:10,action:{kind:'message',mode:'builder',role:'assistant',text:'先确定老师角色与学习任务入口，再把资料、逐题出题和练习页面连接起来。'}},
  {at:14,action:{kind:'quiz-workspace',stage:1,focus:'assistant-root'}},
  {at:19,action:{kind:'trace',mode:'builder',text:'创建角色与任务入口 · 空白画布 → 2 块积木'}},
  {at:25,action:{kind:'quiz-workspace',stage:2,focus:'assistant-coding-instructions'}},
  {at:28,action:{kind:'message',mode:'builder',role:'assistant',text:'读取《分数入门》，提取五个知识点。生成练习与普通追问分开处理，已有题目可以继续讲解。'}},
  {at:33,action:{kind:'trace',mode:'builder',text:'连接资料 · 分数含义、比较、加法、减法、整体与剩余'}},
  {at:37,action:{kind:'quiz-workspace',stage:3,focus:'quiz-retrieve'}},
  {at:42,action:{kind:'trace',mode:'builder',text:'连接模型 · 为每道题提供资料与当前知识点'}},
  {at:49,action:{kind:'message',mode:'builder',role:'assistant',text:'按五个知识点依次循环。每次生成一道题，检查四个选项、答案与解析，然后立即发布到页面。'}},
  {at:53,action:{kind:'quiz-workspace',stage:4,focus:'quiz-loop'}},
  {at:60,action:{kind:'trace',mode:'builder',text:'逐题循环 · 生成 → 结构校验 → 发布页面数据'}},
  {at:67,action:{kind:'quiz-workspace',stage:5,focus:'quiz-save'}},
  {at:73,action:{kind:'message',mode:'builder',role:'assistant',text:'保存本轮练习记忆，让后续提问能引用当前题目。现在构建白底题卡、黄绿按钮和右侧聊天。'}},
  {at:79,action:{kind:'trace',mode:'builder',text:'检查积木结构 · 24 块积木连接完成'}},
  {at:85,action:{kind:'trace',mode:'builder',text:'创建今日练习 · 题卡、计数、解析与聊天'}},
  {at:90,action:{kind:'quiz-view',view:'practice'}},
  {at:93,action:{kind:'message',mode:'builder',role:'assistant',text:'出题助手与今日练习页面已搭好。点击“生成今日小测”，看看题目如何逐一出现。'}},
  {at:101,action:{kind:'quiz-generate'}},
  {at:107,action:{kind:'quiz-item',count:1}},
  {at:115,action:{kind:'quiz-item',count:2}},
  {at:123,action:{kind:'quiz-item',count:3}},
  {at:131,action:{kind:'quiz-item',count:4}},
  {at:139,action:{kind:'quiz-item',count:5}},
  {at:144,action:{kind:'quiz-select',index:1,answer:1}},
  {at:150,action:{kind:'quiz-chat',role:'user',text:explanationPrompt}},
  {at:154,action:{kind:'quiz-chat',role:'assistant',text:explanationReply}},
  {at:164,action:{kind:'quiz-select',index:4,answer:1}},
  {at:166,action:{kind:'quiz-view',view:'synced'}},
  {at:168,action:{kind:'quiz-chat',role:'user',text:followupPrompt}},
  {at:171,action:{kind:'quiz-chat',role:'assistant',text:followupReply}},
  {at:180,action:{kind:'quiz-complete'}},
];

/** Public canvas only: copied from the successful work, with local bindings removed. */
export function quizBuildStage(stage:number):Workspace {
  const workspace=structuredClone(finalWorkspace) as Workspace;
  const allowed=new Set(['assistant-root','assistant-chat-trigger']);
  if(stage>=2)['assistant-coding-instructions','assistant-run-budget'].forEach(id=>allowed.add(id));
  if(stage>=3)['quiz-condition','quiz-retrieve','quiz-instruction'].forEach(id=>allowed.add(id));
  if(stage>=4)['quiz-indexes','quiz-loop','quiz-compose','quiz-publish'].forEach(id=>allowed.add(id));
  function prune(block:WorkspaceBlock|undefined):WorkspaceBlock|undefined {
    if(!block)return;
    if(stage<5&&!allowed.has(block.id!))return prune(block.next?.block);
    for(const [key,input] of Object.entries(block.inputs??{})){const child=prune(input.block);if(child)input.block=child;else delete block.inputs![key];}
    if(block.next){const child=prune(block.next.block);if(child)block.next.block=child;else delete block.next;}
    return block;
  }
  workspace.blocks.blocks=workspace.blocks.blocks.map(prune).filter((block):block is WorkspaceBlock=>!!block);
  return localizeWorkspace(workspace);
}
export { generatePrompt };
