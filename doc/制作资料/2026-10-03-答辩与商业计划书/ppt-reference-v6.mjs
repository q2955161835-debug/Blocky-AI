import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Presentation,PresentationFile} from '@oai/artifact-tool';

const root='D:/1Folder/Blocky-AI';
const base=path.join(root,'try/defense-2026-10-03');
const dir=path.join(base,'slides');
const skill='C:/Users/29551/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const python='C:/Users/29551/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const {finalizePresentation,applyPresentationChartFont}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const finance=JSON.parse(await fs.readFile(path.join(base,'finance/finance-summary.json'),'utf8'));
const ppt=Presentation.create({slideSize:{width:1280,height:720}});
const artDir=path.join(root,'doc/设计素材/2026-10-03-答辩');
const heroBytes=new Uint8Array(await fs.readFile(path.join(artDir,'blocky-cover-imagegen.png')));
const C={paper:'#F7F7F3',ink:'#152326',teal:'#007C73',purple:'#7050B5',muted:'#596869',rule:'#CCD5D0',white:'#FFFFFF',navy:'#17212C',gold:'#AE6800'};
const family='Microsoft YaHei';const notes=[];const crops=[];const pics={};let num=0;
function text(s,t,x,y,w,h,size=28,color=C.ink,bold=false,alignment='left'){const a=s.shapes.add({geometry:'textbox',name:`text-${num}-${s.shapes.items?.length??Math.random().toString(16).slice(2)}`,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});a.text=t;a.text.style={typeface:family,fontSize:size,bold,color,alignment,autoFit:'none',wrap:'word',insets:{left:0,right:0,top:0,bottom:0}};return a;}
function rect(s,x,y,w,h,color){return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill:color,line:{fill:'none',width:0}});}
function slide(label,title,subtitle='',dark=false){const s=ppt.slides.add();num++;s.background.fill=dark?C.navy:C.paper;if(dark){s.images.add({blob:heroBytes,contentType:'image/png',alt:'积木主题概念插图',fit:'cover',position:{left:0,top:0,width:1280,height:720}});pics[num]=1;}const col=dark?C.white:C.ink;text(s,label,64,35,1110,30,16,dark?'#7DD8C9':C.teal,true);text(s,title,64,88,dark?630:1152,112,43,col,true);if(subtitle)text(s,subtitle,64,196,1148,58,22,dark?'#BBCBCB':C.muted);text(s,'Blocky Studio',64,675,360,22,14,dark?'#A8BABD':C.muted);text(s,String(num).padStart(2,'0'),1155,673,62,24,15,dark?'#A8BABD':C.muted);return s;}
function note(s,seconds,body,sources=[]){const n=`${seconds?`建议讲述 ${seconds} 秒。`:'问答备份页，主讲不计时。'}\n${body}\n${sources.length?'资料来源（访问日期：2026-10-03）：\n'+sources.join('\n'):''}`;s.speakerNotes.textFrame.setText(n);notes.push({slide:num,seconds,body,sources});}
async function img(s,file,x,y,w,h,crop){const filePath=path.join(base,'captures',file);const b=new Uint8Array(await fs.readFile(filePath));const frame={left:x,top:y,width:w,height:h};s.images.add({blob:b,contentType:'image/png',alt:'2026年10月3日 Blocky Studio 当前Windows版本实际画面，合成教学资料演示',fit:'contain',position:frame});const picture=pics[num]??0;pics[num]=picture+1;if(crop)crops.push({slide:num,picture,crop,frame,file:filePath});}
async function art(s,file,x,y,w,h,crop){const filePath=path.join(artDir,file);const b=new Uint8Array(await fs.readFile(filePath));const frame={left:x,top:y,width:w,height:h};s.images.add({blob:b,contentType:'image/png',alt:'积木创作方式的概念插图',fit:'contain',position:frame});const picture=pics[num]??0;pics[num]=picture+1;if(crop)crops.push({slide:num,picture,crop,frame,file:filePath});}
function table(s,values,x,y,width,height,widths,size=23){const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width,height,columnWidths:widths,values});t.styleOptions={headerRow:true,bandedRows:false,bandedColumns:false};t.borders.assign({fill:C.rule,width:0.8,style:'solid'});t.cells.block({row:0,column:0,rowCount:values.length,columnCount:values[0].length}).assign({fill:C.paper,textStyle:{typeface:family,fontSize:size,color:C.ink},margins:{top:13,bottom:13,left:16,right:16}});for(let c=0;c<values[0].length;c++){const z=t.getCell(0,c);z.fill=C.teal;z.text.style={typeface:family,fontSize:size,color:C.white,bold:true};}return t;}
function line(s,y){rect(s,64,y,1152,1,C.rule);}
const source={scratch:'https://scratchfoundation.org/learn/learning-library/starter-projects',bba:'https://blocksbuilder.ai/features',price:'https://blocksbuilder.ai/pricing',dify:'https://dify.ai/education'};

{
 const s=slide('息壤杯 · 高校赛区 · 项目答辩','Blocky Studio','',true);
 text(s,'让学生把 AI\n搭成看得懂的作品',64,245,690,186,58,C.white,true);
 text(s,'积木创作  /  资料出处  /  运行过程',66,471,660,52,27,'#A9E3D7');
 text(s,'TB快重置就队\n2026年10月',68,568,650,61,21,'#C5D2D2');
 note(s,20,'大家好，我们是TB快重置就队。Blocky Studio是一款面向教育的积木AI创作软件。我们希望学生不只拿到一个答案，还能搭出作品，看到它用了什么资料、经过哪些步骤，并知道怎样修改。下面用一个水循环课程任务，展示作品如何运行、AI如何参与，以及这些设计带来的应用价值。');
}
{
 const s=slide('01 / 教学场景','做一张学习卡，也要解释它怎么来的','自然科学课程：查资料、问问题、整理学习卡。');
 await art(s,'blocky-classroom-imagegen.png',64,251,1152,329,{left:0,top:0.195,right:0,bottom:0.06});
 [['找到依据','回答能回到课程资料',C.teal],['调整步骤','作品结构可以修改',C.purple],['讲清结果','解释过程与未知信息',C.gold]].forEach((a,i)=>{let x=218+i*280;text(s,a[0],x,589,280,45,31,a[2],true,'center');text(s,a[1],x,632,280,30,20,C.muted,false,'center');});
 note(s,35,'请看一个具体任务：学生根据水循环资料做一张学习卡。除了得到文字，教师还需要看它依据哪段资料、经过哪些步骤，学生能否自己修改和解释。Blocky围绕这个过程提供创作工具：让资料、步骤与结果留在同一件作品中。下面的案例使用合成课程资料，展示当前产品能力；真实课堂中的学习效果仍需验证。');
}
{
 const s=slide('02 / 产品方式','把一次 AI 任务拆成可修改的积木');
 text(s,'同一个作品承载角色、资料、模型、工具和输出。',64,172,1140,42,22,C.muted);
 await art(s,'blocky-process-imagegen.png',64,216,1152,363,{left:0,top:0.24,right:0,bottom:0.13});
 [['搭建','决定步骤，保存作品',C.teal],['运行','查看过程，定位问题',C.purple],['改进','检查结果，再次运行',C.gold]].forEach((a,i)=>{let x=148+i*340;text(s,a[0],x,584,300,46,32,a[2],true,'center');text(s,a[1],x,629,300,32,22,C.muted,false,'center');});
 note(s,30,'交互上，我们借鉴Scratch的积木创作方式。学生把角色、资料、模型、工具与输出放在一个作品里。运行后可以查看过程，定位问题，再修改作品。角色、资料、模型和工具是可修改的组成部分；运行事件又能对应回这些积木。接下来看当前软件里实际完成的流程。',[source.scratch]);
}
{
 const s=slide('03 / 当前产品','一个自然科学课程资料作品','Windows 桌面版 · 实际运行 · 合成教学资料');
 await img(s,'run4/05-latest-course-answer.png',345,237,870,430);
 text(s,'设置角色',65,288,260,48,29,C.teal,true);text(s,'收到问题\n查找课程资料\n组织与输出',65,354,260,180,28);
 text(s,'运行与编辑\n在同一工作区',65,561,260,79,23,C.muted);
 note(s,55,'这张图来自当前Blocky桌面版的实际运行。画布上的角色要求按课程资料回答并提供出处，下方依次是收到问题、查找资料、组织回答和输出。我们导入了合成的水循环资料，再提问水循环有哪些过程。这一步使用本地原文整理器，目的是展示真实资料检索与作品结构，输出保留原文与出处；稍后再展示外部模型参与生成学习卡的流程。下一页把结果与过程放大。');
}
{
 const s=slide('04 / 过程可检查','看出处，也能回到产生结果的步骤','当前案例：检索真实导入的合成资料，以原文摘录方式输出。');
 await img(s,'run4/05-latest-course-answer.png',64,265,504,346,{left:0.753,top:0.235,right:0.01,bottom:0.38});
 await img(s,'run4/06-latest-course-trace.png',649,265,554,346,{left:0.759,top:0.292,right:0.016,bottom:0.38});
 text(s,'两条资料来源，保留未知提示',65,620,535,37,24,C.teal,true);text(s,'点击运行事件，定位对应积木',649,620,554,37,24,C.purple,true);
 note(s,55,'左边是实际输出，能看到课程文件和行号，界面保留了原文摘录的提示，资料里没有的信息保持待核实。右边是同一次运行的彩色事件，可以回到对应积木。引用是核查入口，不能代替对内容的判断。我们想让教师和学生有材料讨论：这句话从哪里来，哪一步需要修改。点击事件后，画布会定位到对应积木，便于继续修改作品。');
}
{
 const s=slide('05 / 构建助手','用自然语言，把课程资料变成学习卡','真实模型演示 · 读取课程文件 → 生成文件 → 可查看变更与撤回');
 text(s,'“请整理一张水循环学习卡，\n标明出处，把资料缺少的\n具体降雨量列为待核实。”',66,300,590,157,32,C.ink,true);
 text(s,'已生成：水循环学习卡.md',66,498,550,56,30,C.teal,true);text(s,'用于备课材料创作的辅助流程',66,575,550,58,24,C.muted);
 await img(s,'run3/03-latest-builder-completed.png',726,244,470,407,{left:0.755,top:0.296,right:0.01,bottom:0.22});
 note(s,60,'这是独立的构建助手流程。本次它通过息壤deepseek-v4-pro真实读取课程文件，创建了水循环学习卡。结果包括过程解释、资料出处和缺失信息的待核实项。界面能看到实际文件变更和撤回入口。它支持教师准备材料，但材料仍需教师审阅。这条文件生成流程与刚才的画布检索相互独立：一个展示资料检索和过程，一个展示模型决策与受控文件操作。');
}
{
 const s=slide('06 / AI 如何实现','积木定义步骤，模型调用受控工具','作品运行与构建助手复用同一套项目语义和权限边界。');
 text(s,'作品运行',64,259,300,39,26,C.teal,true);
 text(s,'画布编译与校验后，按作品结构执行',350,263,840,34,22,C.muted);
 const lane=(items,y,color)=>items.forEach((v,i)=>{const x=64+i*302;rect(s,x,y,248,89,color);text(s,v[0],x+15,y+13,218,33,25,C.white,true,'center');text(s,v[1],x+13,y+53,222,26,18,C.white,false,'center');if(i<3)text(s,'→',x+260,y+24,35,41,29,C.muted,true,'center');});
 lane([['收到问题','确定本次输入'],['检索课程资料','返回可定位出处'],['组织并输出','本例为原文摘录'],['运行事件','关联到对应积木']],309,C.teal);
 text(s,'构建助手',64,428,300,39,26,C.purple,true);
 text(s,'本次：息壤 deepseek-v4-pro 实际完成文件生成',350,432,844,34,22,C.muted);
 lane([['自然语言任务','指定资料与目标'],['模型提出请求','读取文件、生成内容'],['Host 检查权限','限定目录与写入版本'],['实际文件变更','查看差异、按版本撤回']],478,C.purple);
 text(s,'模型参与决策与生成；文件操作由受控工具执行。',65,608,1143,46,28,C.ink,true);
 note(s,75,'AI如何进入这个软件，可以分两条路径理解。上面是作品运行：画布先编译和校验，运行内核按照角色、资料和输出等步骤执行，事件关联回具体积木。这个水循环问答示例只整理检索到的原文，强调依据可追溯。下面是构建助手：用户给出任务，模型提出读取文件或写入内容的请求，Host检查所选目录、权限和文件版本，再交给受控工具执行。工具结果返回给模型，直到形成学习卡。模型负责理解任务和生成内容，实际读写由权限边界约束，界面展示真实差异并提供撤回入口。这样，模型能力与作品的执行、检查和修改衔接起来。');
}
{
 const s=slide('07 / 方案创新','把创作结构、运行过程和修改连在一起','Blocky 的应用创新体现在完整工作台，以及结构与实际行为的对应。');
 const rows=[['可修改的作品','角色、资料、模型、工具以积木组合；作品可保存与复用。',C.teal],['可回查的过程','回答定位资料，运行事件定位积木；问题回到具体步骤。',C.purple],['可审阅的改动','构建助手展示文件差异；项目候选经审阅后应用并可撤销。',C.gold]];
 rows.forEach((v,i)=>{const y=274+i*117;rect(s,64,y+4,7,87,v[2]);text(s,v[0],90,y,337,46,30,v[2],true);text(s,v[1],437,y+7,768,74,25,C.ink);});
 text(s,'底层使用 Blockly、Tauri、Pi；自研作品语义、运行映射与受控集成。',66,640,1148,31,19,C.muted);
 note(s,60,'我们的创新重点是让创作结构、执行过程和修改保持对应。第一，积木构成可保存、可复用的作品，学生可以改变资料和步骤。第二，结果中的出处和运行轨迹把问题带回具体资料、具体积木。第三，模型协助修改时展示实际差异，项目候选经过用户审阅再应用。底层采用Blockly、Tauri和Pi等开源组件，Blocky实现自身的作品格式、语义编译、运行事件映射和Host集成。Scratch提供成熟的积木创作参照，Blocks Builder AI也是直接教育竞品；我们以这套工作台的完整使用过程说明项目贡献，不把通用能力说成独家发明。',[source.scratch,source.bba]);
}
{
 const s=slide('08 / 商业模式','完整软件免费，机构按需求报价','学生使用，教师组织；机构为课程、部署与支持服务付费。');
 text(s,'完整功能免费',187,267,440,67,42,C.teal,true,'center');text(s,'机构联系报价',701,267,440,67,42,C.purple,true,'center');
 await art(s,'blocky-services-imagegen.png',64,335,1152,265,{left:0,top:0.28,right:0,bottom:0.135});
 text(s,'外部模型费用按约承担',187,604,440,33,23,C.ink,false,'center');text(s,'课程、部署、培训与支持',701,604,440,33,23,C.ink,false,'center');
 text(s,'机构账户、额度管理与计费尚待建设；早期服务只承诺当前可交付范围。',66,645,1123,28,17,C.muted);
 note(s,40,'我们选择完整软件免费，机构联系报价。首批收入来自范围明确的课程准备、教师培训、安装配置、支持和约定模型额度。报价按规模和工作量核定，而不是统一给每所学校一个价格。个人使用软件免费也不代表外部模型调用没有成本。统一机构账户、额度和计费尚待建设，早期合同只承诺已经具备且可以履约的服务。');
}
{
 const s=slide('09 / 完成度与落地','桌面产品已可运行，下一步进入真实课程','已交付：积木创作、资料引用、运行轨迹、构建助手与项目保存。');
 await art(s,'blocky-roadmap-imagegen.png',64,268,1152,262,{left:0,top:0.388,right:0,bottom:0.067});
 [['当前成果','完整课程案例与学习卡',C.teal],['课程试用','教师组织学生完成任务',C.purple],['持续应用','教师独立复用，再拓展服务',C.gold]].forEach((a,i)=>{let x=137+i*350;text(s,a[0],x,545,325,49,32,a[2],true,'center');text(s,a[1],x,600,325,50,21,C.ink,false,'center');});
 text(s,'真实课堂效果、机构合同与收入，尚未形成验证结果。',66,650,1145,26,18,C.muted);
 note(s,30,'当前已经有可运行的Windows桌面软件，前面展示的资料问答、运行轨迹和学习卡文件都来自实际结果。下一步围绕同一课程开展教师试用，观察学生是否能完成、解释和修改作品，再验证教师能否独立复用。商业化从范围清楚的课程与支持服务开始；课堂效果与机构收入目前仍待验证。');
}
{
 const s=slide('10 / 项目价值','Blocky Studio','',true);
 text(s,'让 AI 创作\n看得懂，改得动',64,254,660,172,57,C.white,true);
 text(s,'从课程资料到作品\n把依据、步骤与修改留在过程里',66,464,649,103,29,'#A9E3D7',true);
 text(s,'TB快重置就队  ·  谢谢各位评委',66,619,620,42,23,'#C5D2D2');
 note(s,20,'Blocky希望让学生不只获得一段AI输出，还能搭建作品、检查依据、解释过程并亲手修改。当前桌面产品已经实现这条创作链路，我们将用真实课程继续验证它的教学与应用价值。谢谢各位评委。');
}
{
 const b=finance.scenarios['基准'];const s=slide('备份 / 经营测算','基准情景前两年亏损，先控制现金','2027–2029规划假设 · 人民币万元 · 尚无实际合同、收入或资金承诺');
 const chart=s.charts.add('bar',{position:{left:64,top:256,width:782,height:322},categories:b.years.map(x=>String(x.year)),series:[{name:'收入',values:b.years.map(x=>Number((x.revenue/10000).toFixed(3))),fill:C.teal,valuesFormatCode:'0.00'},{name:'费用',values:b.years.map(x=>Number((x.cost/10000).toFixed(3))),fill:C.purple,valuesFormatCode:'0.00'}],barOptions:{direction:'column',grouping:'clustered',gapWidth:80,overlap:0},hasLegend:true,legend:{position:'bottom',overlay:false,textStyle:{typeface:family,fontSize:19,fill:C.ink}},chartFill:C.paper,plotAreaFill:C.paper,xAxis:{textStyle:{typeface:family,fontSize:21,fill:C.ink},majorGridlines:null},yAxis:{min:0,max:40,majorUnit:10,numberFormatCode:'0',textStyle:{typeface:family,fontSize:17,fill:C.muted},majorGridlines:{fill:C.rule,width:0.5}},dataLabels:{showValue:true,position:'outEnd',textStyle:{typeface:family,fontSize:18,fill:C.ink,bold:true}}});applyPresentationChartFont(chart,{fontFamily:family});
 text(s,'10.30万元',918,310,300,68,39,C.teal,true);text(s,'基准追加资金预算',918,394,290,45,24,C.ink,true);text(s,'峰值缺口 8.30万\n最低储备 2.00万',918,458,295,93,24,C.muted);
 text(s,'合同目标：4 / 10 / 18 份；每份均价 1.8 万元为假设。',65,595,1149,37,23,C.muted);text(s,'2029单年转正，三年累计仍亏1.472万元。',65,633,1149,33,23,C.ink,true);
 note(s,0,'我们把财务做成逐月模型。基准假设三年交付四、十、十八份合同，每份均价一万八千元，首年收入七万二千元。计入人工、模型、支持、固定运营与设备折旧后，前两年亏损，第三年单年转正，但三年累计仍亏损。假设两万元自有资金后，峰值缺口八万三千元，加两万元储备，追加资金预算十万三千元。所有这些都未承诺，资金不到位就缩小支出。');
}
{
 const s=slide('备份 / 竞争位置','免费之外，要证明课堂复用价值','Scratch 是交互参照；Blocks Builder AI 是直接教育竞品。');
 table(s,[['选择','公开重点','Blocky 需要证明的价值'],['Scratch','积木创作与学习资源','把创作方式扩展到 AI 任务'],['Blocks Builder AI','积木 AI；个人免费、机构洽谈','桌面作品、资料与过程的教学价值'],['Dify','AI 应用构建与教育计划','让课程组织与学生创作更易开展']],64,279,1152,267,[230,365,557],24);
 text(s,'我们的验证重点：教师能否独立复用一套课程作品。',65,585,1140,61,30,C.teal,true);
 note(s,0,'这个方向并不是空白市场。Scratch提供成熟的积木学习方式。Blocks Builder AI已经公开提供积木AI、个人免费和教育机构洽谈。Dify也有教育计划。因此免费不能成为我们的主要差异。Blocky要证明的是，桌面作品、资料出处和可查看过程能否帮助教师反复组织课程。我们不会因为有这些功能就宣称已经超过竞品。',[source.scratch,source.bba,source.price,source.dify]);
}
{
 const s=slide('备份 / 成本与情景','合同量和支持成本，比市场大数字更关键','全部为规划情景，非客户报价或已实现业绩。');
 const rows=[['情景','三年收入（万元）','三年损益（万元）','追加资金（万元）']];
 for(const key of ['悲观','基准','积极']){const a=finance.scenarios[key];rows.push([key,(a.years.reduce((n,v)=>n+v.revenue,0)/10000).toFixed(2),(a.years.reduce((n,v)=>n+v.net_income,0)/10000).toFixed(3),(a.required_additional_cash_with_reserve/10000).toFixed(3)]);}
 table(s,rows,64,269,1152,242,[200,325,325,302],23);
 text(s,'基准单份：1.8万元收入，80小时交付，1400元模型额度预算。',65,556,1144,53,27,C.teal,true);text(s,'低迷情景不能只补基准资金；必须收缩费用、调整任务或暂停扩张。',65,615,1146,34,22,C.muted);
 note(s,0,'情景来自可编辑的36个月财务模型。悲观假设合同更少、均价更低、支持工时与模型费用更高，且当月只收30%款；积极假设更高成交与效率，但同时增加固定支出与外部增援。税费按收入比例预留，只是管理预算，不是法定税率。三年累计损益仍为负的情景不能表述成已盈利。');
}
{
 const s=slide('备份 / 评委追问','为什么还需要积木，怎样面对错误？','作品结构、资料核查与工具权限，是三个可继续展开的问题。');
 const qs=[['已有聊天工具，为什么用积木？','用于需要保存、修改、解释步骤的课程任务；价值需看教师能否复用。'],['有引用就不会错吗？','引用提供核查入口；教师仍需检查内容、资料范围与模型输出。'],['谁能改文件或调用工具？','当前由Host控制工具权限，变更可查看和撤回；不承诺所有工具都安全。']];
 qs.forEach((a,i)=>{const y=274+i*121;text(s,a[0],65,y,1110,40,29,C.teal,true);text(s,a[1],65,y+48,1146,62,24,C.ink);});
 note(s,0,'积木适合解释、修改与复用流程，并不意味着所有任务都优于聊天。资料引用不保证答案正确。文件和工具操作遵循当前Host权限边界，具体机构仍需结合资料与设备要求核实。不要承诺绝对安全、零幻觉或未经验证的教学提升。');
}
{
 const s=slide('备份 / 产品演示','同一课程资料，两种可检查的创作方式','画布作品检索原文；构建助手生成学习卡。');
 const a=[['画布作品','提问 → 出处 → 轨迹'],['构建助手','选资料 → 任务 → 文件'],['模型边界','原文摘录 / 外部生成']];
 a.forEach((v,i)=>{let y=293+i*112;text(s,v[0],64,y,365,44,28,[C.teal,C.purple,C.gold][i],true);text(s,v[1],64,y+48,390,43,23);});
 await img(s,'run3/02-latest-builder-task.png',475,258,741,394);
 note(s,0,'演示前先准备同一合成课程资料、正确作品和可用模型配置。画布示例展示资料检索与原文引用，构建助手示例展示文件读写与生成。真实模型请求耗时与网络有关，不在现场临时承诺固定等待时长。若条件不足，按真实截图和结果说明，不伪装现场实时运行。');
}
{
 const s=slide('备份 / 资料来源','外部比较与数字都有可回溯来源','公开页面访问日期：2026年10月3日');
 text(s,'Scratch Foundation',65,275,470,42,27,C.teal,true);text(s,'Starter Projects · 学习与积木创作参照',65,327,1140,42,25);
 text(s,'Blocks Builder AI',65,402,470,42,27,C.teal,true);text(s,'Features / Pricing · 功能、个人免费与教育洽谈',65,454,1140,42,25);
 text(s,'Dify',65,529,470,42,27,C.teal,true);text(s,'Dify for Education · 专业AI应用构建的教育路径',65,581,1140,42,25);
 note(s,0,'外部产品以公开页面描述为依据，不将公开功能推断为教学效果或营收。Blocky截图来自2026年10月3日的当前Windows版本实际运行，全部使用合成教学资料。经营数字来自配套财务模型，全部为假设。',[source.scratch,source.bba,source.price,source.dify]);
}

await fs.mkdir(dir,{recursive:true});
await fs.writeFile(path.join(dir,'speaker-notes.json'),JSON.stringify(notes,null,2));
await fs.writeFile(path.join(dir,'font-policy.json'),JSON.stringify({basis:'design',families:[family]},null,2));
const candidate=path.join(dir,'candidate-v1.pptx');
await (await PresentationFile.exportPptx(ppt)).save(candidate);
await fs.writeFile(path.join(dir,'crop-layout.json'),JSON.stringify(crops));
const meta=spawnSync(python,[path.join(dir,'prepare_metadata.py'),candidate,path.join(dir,'crop-layout.json')],{encoding:'utf8'});if(meta.status!==0)throw new Error(meta.stderr);
const revision=process.env.DECK_REVISION||'v1';
await fs.mkdir(path.join(dir,'finalized'),{recursive:true});
const final=path.join(dir,'finalized',`Blocky-Studio-新版答辩-2026-10-03-${revision}.pptx`);
const r=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:final,pythonExecutable:python,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit',...[13,14].flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:17,requiredNativeTableOwnerSlides:[13,14],requiredNativeChartOwnerSlides:[12],materializeLiteralChartWorkbooks:true,fontPolicy:{basis:'design',families:[family]},verifyArtifactToolImport:true,receiptPath:path.join(dir,`validation-${revision}.json`)});
console.log(JSON.stringify({final,slides:num,totalSeconds:notes.reduce((n,v)=>n+(v.seconds||0),0),result:r}));
