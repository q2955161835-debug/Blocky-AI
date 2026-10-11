import { sceneSections } from './scenes.js';
import {pricingPlans,topUp} from './pricing-data.js';
import {getPreferences,subscribePreferences} from './preferences.js';
export function mountContent() {
document.querySelector('#more-content').innerHTML = `
<section class="features section-shell" aria-label="产品能力">
  <article class="feature-row">
    <div class="feature-copy"><span class="feature-number">01 — A LANGUAGE YOU CAN SEE</span><h3>把抽象的能力，<br>握在手里。</h3><p>像搭积木一样组合角色、模型、知识与工具。嵌套结构让思考过程清晰可见，入门与专业视图，让创作跟着你的理解一起成长。</p><div class="inline-tags"><span>可视化画布</span><span>自由组合</span><span>双视图</span></div></div>
    <div class="feature-visual visual-blocks dotted" aria-label="积木组合示意"><div class="visual-label">YOUR IDEAS, CONNECTED.</div><div class="small-stack"><div class="block block-yellow cap">开始 <b>我的创作</b></div><div class="block block-purple">设定 <b>一个有趣的角色</b></div><div class="block block-blue bracket">遇到问题时<div class="block block-green">查找 <b>知识</b></div><div class="block block-orange">使用 <b>工具</b></div></div><div class="block block-cyan">表达 <b>你的答案</b></div></div><span class="visual-footnote">可展开、可修改、可复用</span></div>
  </article>
  <article class="feature-row reverse">
    <div class="feature-copy"><span class="feature-number">02 — A LITTLE HELP TO GO FURTHER</span><h3>从一句“我想”，<br>开始下一步。</h3><p>构建助手就在画布旁，帮助搭建、解释和修改当前项目。也可通过 Blocky CLI 继续使用你熟悉的开发 Agent，无需更换助手。每一次改变，都可以继续审阅与撤销。</p><div class="inline-tags"><span>自然语言创作</span><span>项目上下文</span><span>可撤销修改</span></div></div>
    <div class="feature-visual visual-conversation"><div class="conversation-question">我想让它记住我的学习偏好。</div><div class="assistant-label"><span class="chat-avatar">B.</span>构建助手</div><p>可以在回答前加入记忆能力。<br>下一次交流，就从更了解你开始。</p><div class="change-line"><span>＋</span> 加入记忆积木 <span class="tag-outline">示意</span></div><div class="block block-pink">记住 <b>学习偏好</b></div><div class="conversation-status">◇ 读懂改变，再决定下一步。</div></div>
  </article>
  <article class="feature-row">
    <div class="feature-copy"><span class="feature-number">03 — UNDERSTAND EVERY STEP</span><h3>让过程可见，<br>让理解发生。</h3><p>沿着运行轨迹，看到智能体如何调用知识与工具，定位问题发生的位置。结果之外，创作过程本身也值得被理解。</p><div class="inline-tags"><span>运行轨迹</span><span>逐步调试</span><span>诊断与日志</span></div></div>
    <div class="feature-visual visual-trace"><div class="trace-title">运行轨迹 <span>示意</span></div><div class="trace-line"><i style="--step:#e4bd60"></i><div>收到问题<small>“天空为什么是蓝色的？”</small></div><span>01</span></div><div class="trace-line"><i style="--step:#bb9ddd"></i><div>理解角色<small>用适合初学者的方式解释</small></div><span>02</span></div><div class="trace-line"><i style="--step:#8cc9af"></i><div>查找知识<small>连接科学知识库</small></div><span>03</span></div><div class="trace-line"><i style="--step:#9bcbd4"></i><div>组织回答<small>从一个生活中的例子讲起</small></div><span>04</span></div></div>
  </article>
  <article class="feature-row reverse">
    <div class="feature-copy"><span class="feature-number">04 — MAKE ROOM FOR YOUR IDEAS</span><h3>自定义积木，<br>让创造没有预设上限。</h3><p>将常用逻辑封装成可展开的积木，或用代码把算法、工具与业务能力变成新的积木。清楚定义输入与输出，再与模型、知识和流程自由组合，把自己的能力带进下一件作品。</p><div class="inline-tags"><span>可视化封装</span><span>代码扩展</span><span>组合复用</span></div></div>
    <div class="feature-visual visual-blocks dotted" aria-label="自定义积木示意"><div class="visual-label">BUILD YOUR OWN CAPABILITIES.</div><div class="small-stack"><div class="block block-yellow cap">定义 <b>我的能力</b></div><div class="block block-purple bracket">输入 <b>资料</b><div class="block block-orange">使用 <b>自有工具</b></div><div class="block block-green">返回 <b>结果</b></div></div><div class="block block-cyan">复用 <b>我的能力</b></div></div><span class="visual-footnote">可展开逻辑 · 清楚的接口 · 可复用能力</span></div>
  </article>
</section>
<section class="blueprints-section" id="blueprints"><div class="section-shell"><div class="section-heading"><div><div class="section-kicker">02 / 一个起点，无数种可能</div><h2>从蓝图出发。<br>把它变成你的。</h2></div><p>四种起始蓝图，一张自由创作的画布。<br>保留你需要的，改变你想改变的。</p></div>
<div class="blueprint-grid">
<article style="--card-color:#8cc9af"><span class="blueprint-index">01</span><div class="blueprint-character art-stage" data-art="character-knowledge" aria-hidden="true"></div><h3>知识问答助手</h3><p>连接你的资料，围绕知识展开对话。</p><span class="blueprint-use">学习 / 资料问答</span></article>
<article style="--card-color:#e4bd60"><span class="blueprint-index">02</span><div class="blueprint-character art-stage" data-art="character-work" aria-hidden="true"></div><h3>工作助手</h3><p>组合工具与步骤，探索自己的工作方式。</p><span class="blueprint-use">日常 / 任务处理</span></article>
<article style="--card-color:#8cb7e8"><span class="blueprint-index">03</span><div class="blueprint-character art-stage" data-art="character-coding" aria-hidden="true"></div><h3>Coding 助手</h3><p>用积木组织编程任务，理解工具协作。</p><span class="blueprint-use">代码 / 创作实践</span></article>
<article style="--card-color:#bb9ddd"><span class="blueprint-index">04</span><div class="blueprint-character art-stage" data-art="character-pi" aria-hidden="true"></div><h3>Pi Agent</h3><p>探索智能体循环，继续改造你的 Agent。</p><span class="blueprint-use">进阶 / 智能体探索</span></article>
</div><p class="blueprint-bottom">也可以从一张空白画布开始。你的想法，决定它的样子。</p></div></section>
<section class="how-section section-shell" id="how-it-works"><div class="section-kicker">03 / 创作，比想象中更近</div><h2>想一想。搭一搭。<span>再多走一步。</span></h2><div class="steps"><article><span>01</span><h3>从一个好问题开始</h3><p>它应该扮演谁？解决什么问题？<br>挑选蓝图，或打开一张空白画布。</p></article><article><span>02</span><h3>拼出你的想法</h3><p>组合积木，调整角色、知识与工具。<br>需要帮助时，和构建助手聊一聊。</p></article><article><span>03</span><h3>运行，然后更进一步</h3><p>观察轨迹，检查回答，修改与再试。<br>把探索留下，成为自己的作品。</p></article></div></section>
${sceneSections()}
<section class="access-section section-shell" id="access"><div><div class="section-kicker">05 / 开放创作的可能</div><h2>自由探索。<br>一起向前。</h2></div><div class="access-details"><article class="beta-download-card"><span class="access-label">Windows x64 安装包</span><h3>0.8.0-beta.1 测试版</h3><p>仅供体验与反馈，不代表正式稳定版。</p><a class="button button-accent beta-download-link" href="https://github.com/I-dont-know-codex-is-right/Blocky-Studio-Releases/releases/download/v0.8.0-beta.1/Blocky-Studio-0.8.0-beta.1-setup.exe">下载测试版 · 0.8.0-beta.1</a></article><article><span class="access-label">个人创作</span><h3>个人创作，源码公开</h3><p>源码公开，采用 PolyForm Noncommercial 1.0.0。可按协议允许的非商用目的使用、修改和分发；商业用途若不属于协议明确允许的用途，需另行授权。模型服务与算力独立核算。</p></article><article><span class="access-label">学校与组织</span><h3>服务围绕需求展开</h3><p>根据教学与协作规模，组合组织后台、课程支持、部署与维护服务。组织服务的价值，来自共同创造的方式。</p><a class="text-link contact-inquiry" href="mailto:q2955161835@gmail.com">机构咨询 <span aria-hidden="true">↗</span></a></article></div><article class="access-token"><div class="access-token-head"><div><span class="access-label">Token 订阅计划</span><h3>按需选择，让创作继续。</h3><p>一个 Token 套餐，覆盖构建助手与作品中的 Agent；后续导出应用也可使用。按实际用量共用额度。</p></div><a class="button access-pricing-button" href="#/pricing">查看完整套餐 <span aria-hidden="true">↗</span></a></div><div id="access-token-plans" data-no-translate></div></article></section>
<section class="faq-section section-shell" id="faq"><div><div class="section-kicker">06 / 再多了解一点</div><h2>你可能想知道。</h2></div><div class="faq-list">
<details><summary>这些能力目前都开放了吗？<span aria-hidden="true">＋</span></summary><p>官网按完整产品愿景介绍，各项能力分阶段开放。当前以 Windows 桌面创作端为主；完整自定义积木编辑与分发、教育组织、专业团队与部署、社区、更多平台及 Agent App 按产品计划推进。具体可用能力以发布版本为准。</p></details>
<details><summary>没有编程基础，可以从哪里开始？<span aria-hidden="true">＋</span></summary><p>可以先选择一份起始蓝图，读懂每块积木的作用，再修改角色、知识与回答方式。入门视图按“开始、角色、会思考、会查找、会记住、会行动、会回答”组织能力。</p></details>
<details><summary>Blocky 和直接与 AI 聊天有什么区别？<span aria-hidden="true">＋</span></summary><p>除了得到回答，你还可以决定智能体的角色、知识、工具与执行方式，将它们组合成可查看、可修改、可复用的项目，并沿运行轨迹理解过程。</p></details>
<details><summary>目前支持哪些设备？<span aria-hidden="true">＋</span></summary><p>当前产品以 Windows 桌面端为主。macOS 创作端，以及 Android、HarmonyOS 和 iOS 运行端属于后续规划。网页中的在线体验展示预设 UI，不提供真实 AI 服务。</p></details>
<details><summary>作品和模型连接如何管理？<span aria-hidden="true">＋</span></summary><p>桌面端使用 .blocky 项目文件保存作品，可配置自己的模型连接。真实模型调用是否发送内容、产生费用，取决于使用的模型服务及项目配置。在线 UI 体验不需要填写密钥，也不读取本地文件。</p></details>
<details><summary>在哪里获取桌面版和源码？<span aria-hidden="true">＋</span></summary><p>获取 Windows x64 安装包： <a class="faq-download-link" href="https://github.com/I-dont-know-codex-is-right/Blocky-Studio-Releases/releases/download/v0.8.0-beta.1/Blocky-Studio-0.8.0-beta.1-setup.exe">下载测试版 · 0.8.0-beta.1</a>。此版本为测试版，仅供体验与反馈，不代表正式稳定版。源码仓库已公开：<a href="https://github.com/q2955161835-debug/Blocky-AI">查看源码仓库</a>。项目采用 <a href="./LICENSE.txt">PolyForm Noncommercial 1.0.0</a> 非商用许可，协议允许范围之外的商业用途需另行授权；第三方材料保留各自许可。</p></details>
</div></section>
<section class="closing section-shell"><span class="section-kicker">CURIOSITY IS THE FIRST BLOCK.</span><h2>下一个想法，<br>从你开始。</h2><div class="closing-actions"><a class="button button-accent" href="#blueprints">找到你的创作起点</a><a class="button closing-experience" href="#/studio">在线体验 <span aria-hidden="true">↗</span></a></div></section>`;
  const plans=document.querySelector('#access-token-plans');
  function renderPlans(){
    const en=getPreferences().resolvedLanguage==='en';
    const t=(zh,english)=>en?english:zh;
    const number=value=>value.toLocaleString(en?'en-US':'zh-CN');
    plans.innerHTML=`<div class="access-plan-grid">${pricingPlans.map(plan=>`<div class="access-plan"><strong>${plan.name[en?1:0]}</strong><p><b>¥${plan.price}</b><small>${t('/ 月','/ month')}</small></p><span>${number(plan.credits)} ${t('积分 / 月','credits / month')}</span></div>`).join('')}</div><div class="access-plan-note"><span>${t('拟定方案 · 人民币计价 · 暂未开放购买','Proposed plans · prices in CNY · purchasing not yet available')}</span><span>${t('加量包','Top-up')}: ¥${topUp.price} / ${number(topUp.credits)} ${t('积分','credits')}</span></div>`;
  }
  renderPlans();subscribePreferences(renderPlans);
}
