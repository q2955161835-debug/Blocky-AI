import {createAgentExample} from '../../../../packages/block-catalog/src/index';
import {Runtime} from '../../../../packages/runtime-core/src/index';
import {writeFileSync} from 'node:fs';
const rows=[];
for(const keyword of ['勇敢','友善']){
 const p=createAgentExample('story-choice-teaching');
 const root=p.workspaces['research-agent'].blocks.blocks[0];
 root.fields.ROLE='故事创作搭档';
 root.inputs.BODY.block.next={block:{type:'core.logic.condition',id:'story-choice',fields:{SOURCE:'input',OP:'contains',VALUE:keyword},inputs:{THEN:{block:{type:'core.data.set',id:'forest',fields:{VALUE:'"到森林探险"'}}},ELSE:{block:{type:'core.data.set',id:'garden',fields:{VALUE:'"去花园交朋友"'}}}},next:{block:{type:'core.output.answer',id:'show',fields:{STYLE:'段落'}}}}};
 p.schemas['schemas/story.json']={type:'string'}; const choice=root.inputs.BODY.block.next.block; choice.next={block:{type:'core.output.structured',id:'story-result',fields:{SCHEMA:'schemas/story.json'}}};
 const r=await new Runtime().run(p,'on-question','勇敢的小猫');
 rows.push({keyword,input:'勇敢的小猫',status:r.status,structured:r.structured,events:r.events});
 writeFileSync(`try/education-rewrite/story-${keyword}.json`,JSON.stringify(p,null,2));
}
writeFileSync('try/education-rewrite/local-example-results.json',JSON.stringify({boundary:'本地领域Runtime真实条件执行；非生成式故事、Windows普通包或学生试用；无外部模型请求',rows},null,2));
console.log(rows.map(x=>({keyword:x.keyword,status:x.status,structured:x.structured,blocks:x.events.filter(e=>e.type==='block.completed').map(e=>e.blockId)})));
