import { catalog, startingBlueprints } from '../../packages/block-catalog/src/index';
import type { Workspace, WorkspaceBlock } from '../../packages/language-schema/src/index';
import { localizeDefault, getPreferences } from '../dist/preferences.js';
export { catalog, startingBlueprints };
export type BlueprintId = (typeof startingBlueprints)[number]['id'];
export const descriptions = {
  'knowledge-assistant': '连接并同步资料，让回答带上可核对的来源。',
  'work-assistant': '在你选择的工作目录中整理资料并交付结果。',
  'coding-assistant': '在授权仓库里读、改、检查并保留差异。',
  'pi-agent': '配置模型和工具，搭建可自定义的 Agent。',
};
export const examples = {
  'knowledge-assistant': ['根据资料，解释水循环。', '水循环由蒸发、凝结与降水等过程组成。太阳使地表水蒸发，水汽冷却形成云，再以降水回到地面。'],
  'work-assistant': ['整理本周的工作清单。', '周报示例已整理为：本周完成、正在推进、需要协作。你可以继续调整步骤与输出形式。'],
  'coding-assistant': ['检查这个项目的代码。', '代码检查示例：先阅读项目结构，再定位修改范围，最后运行对应检查并整理差异。'],
  'pi-agent': ['展示如何分步完成一个任务。', '任务示例分为理解目标、选择工具、观察结果和整理答复。你可以在积木中调整循环与工具。'],
};
export const blank: Workspace = { blocks: { languageVersion: 0, blocks: [] } };
export function createWorkspace(id: BlueprintId | 'blank') {
  return id === 'blank' ? structuredClone(blank) : localizeWorkspace(startingBlueprints.find(b => b.id === id)!.create('website-demo').workspaces.main);
}
const presetFields=new Map<string,Set<string>>();
for(const blueprint of startingBlueprints)for(const block of flatten(blueprint.create('website-demo').workspaces.main))for(const [field,value] of Object.entries(block.fields??{})) {
  if(typeof value!=='string'||!['NAME','ROLE','TEXT'].includes(field))continue;
  const key=block.type+':'+field,values=presetFields.get(key)||new Set<string>();
  values.add(value);values.add(localizeDefault(value,'en'));presetFields.set(key,values);
}
export function localizeWorkspace(workspace:Workspace) {
  const next=structuredClone(workspace),language=getPreferences().resolvedLanguage;
  for(const block of flatten(next))for(const [field,value] of Object.entries(block.fields??{})) {
    if(typeof value==='string'&&presetFields.get(block.type+':'+field)?.has(value))block.fields![field]=localizeDefault(value,language);
  }
  return next;
}
export function flatten(workspace: Workspace): WorkspaceBlock[] {
  const result: WorkspaceBlock[] = [];
  function visit(block: WorkspaceBlock) {
    result.push(block);
    for (const value of Object.values(block.inputs ?? {})) if (value.block) visit(value.block);
    if (block.next?.block) visit(block.next.block);
  }
  workspace.blocks.blocks.forEach(visit);
  return result;
}
export function removeBlock(workspace: Workspace, id: string): Workspace {
  const value = structuredClone(workspace);
  function prune(block: WorkspaceBlock | undefined): WorkspaceBlock | undefined {
    if (!block) return;
    if (block.id === id) return prune(block.next?.block);
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.block) input.block = prune(input.block);
    }
    if (block.next) {
      const next = prune(block.next.block);
      if (next) block.next.block = next; else delete block.next;
    }
    return block;
  }
  value.blocks.blocks = value.blocks.blocks.map(prune).filter((b): b is WorkspaceBlock => !!b);
  return value;
}
