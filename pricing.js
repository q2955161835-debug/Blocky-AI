import {getPreferences,subscribePreferences} from './preferences.js';
import {pricingPlans,topUp,pricingFaq} from './pricing-data.js';

export function mountPricing(container){
  container.setAttribute('data-no-translate','');
  let en=false;
  const t=(zh,english)=>en?english:zh;
  const pair=value=>value[en?1:0];
  const amount=value=>value.toLocaleString(en?'en-US':'zh-CN');
  function inquiry(subject){
    const body=t('你好，我想咨询 Blocky。\n\n使用场景：\n预计使用人数：\n模型与用量需求：\n预算或交付时间：','Hello, I would like to discuss Blocky.\n\nUse case:\nExpected number of users:\nModel and usage needs:\nBudget or timeline:');
    return `mailto:q2955161835@gmail.com?subject=${encodeURIComponent('Blocky · '+subject)}&body=${encodeURIComponent(body)}`;
  }
  function render(){
    en=getPreferences().resolvedLanguage==='en';
    container.innerHTML=`<main id="pricing-main" class="pricing-page section-shell">
      <section class="pricing-hero">
        <a class="pricing-return" href="#">← ${t('返回官网','Back to home')}</a>
        <div class="section-kicker">${t('定价与咨询','PRICING & INQUIRIES')}</div>
        <h1>${t('让创造自由。','Free to create.')}<br><span>${t('让用量有数。','Clear about usage.')}</span></h1>
        <p>${t('创作工具免费，模型算力按需选择。','Free creation tools. Model compute on your terms.')}<br>${t('从一个人的探索，到一间教室、一个团队。','For an individual, a classroom, or a team.')}</p>
        <div class="pricing-jumps"><button type="button" data-pricing-scroll="token-plans">${t('查看 Token 套餐','Explore Token plans')} ↓</button><button type="button" data-pricing-scroll="organization-pricing">${t('学校与团队咨询','Schools & teams')} ↗</button></div>
      </section>

      <section class="free-creation" aria-labelledby="free-title"><div><span class="pricing-eyebrow">BLOCKY STUDIO</span><h2 id="free-title">${t('完整创作，从免费开始。','Full creation starts free.')}</h2><p>${t('个人客户端完整创作能力免费。算力套餐不限制积木、蓝图与 CLI 的使用。','The personal client’s full creation tools are free. Compute plans do not gate blocks, blueprints, or CLI access.')}</p></div><div class="free-price"><strong>¥0</strong><span>${t('个人软件','Personal software')}</span><small>${t('自带 API · 向供应商付费','Bring your API · pay your provider')}</small></div></section>

      <section id="token-plans" class="token-plans" aria-labelledby="plans-title"><div class="pricing-section-head"><div><span class="pricing-eyebrow">TOKEN PLANS</span><h2 id="plans-title">${t('为你的下一步，准备算力。','Compute for your next step.')}</h2></div><span class="pricing-status">${t('方案拟定中 · 暂未开放购买','Proposed plans · purchasing not yet available')}</span></div><p class="pricing-intro">${t('构建助手与作品中的 Agent 共用托管额度；后续导出应用也沿用这一套餐体系。人民币计价，按模型实际 Token 消耗折算积分。','The builder and your agents share hosted credits. Future exported apps will use the same plan system. Prices in CNY; credits reflect actual model token consumption.')}</p>
      <div class="pricing-grid">${pricingPlans.map((plan,index)=>`<article class="pricing-card ${index===1?'pricing-featured':''}"><div class="plan-index">0${index+1}<span>${pair(plan.tag)}</span></div><h3>${pair(plan.name)}</h3><p class="plan-description">${pair(plan.description)}</p><div class="plan-price"><span>¥</span><strong>${plan.price}</strong><span>${t('/ 月','/ month')}</span></div><div class="plan-credits"><strong>${amount(plan.credits)}</strong><span>${t('积分 / 月','credits / month')}</span></div><ul><li>${t('完整个人创作能力','Full personal creation tools')}</li><li>${t('构建与运行共用托管额度','Shared credits for building and running')}</li><li>${t('按需补充加量包','Optional credit top-ups')}</li><li>${t('自有 API 独立计费','Your own API billed separately')}</li></ul><a class="button ${index===1?'button-accent':''} plan-inquiry" href="${inquiry(pair(plan.name)+' '+t('Token 套餐咨询','Token plan inquiry'))}">${t('咨询','Ask about')} ${pair(plan.name)} <span aria-hidden="true">↗</span></a></article>`).join('')}</div>
      <div class="topup-row"><div><span class="pricing-eyebrow">${t('临时需要更多？','NEED A LITTLE MORE?')}</span><h3>${t('Token 加量包','Token top-up')}</h3><p>${t('拟面向有效订阅用户，到账起 30 天有效。','Proposed for active subscribers; valid for 30 days from issue.')}</p></div><div class="topup-amount"><strong>¥${topUp.price}</strong><span>${amount(topUp.credits)} ${t('积分','credits')}</span></div><a class="text-link" href="${inquiry(t('Token 加量包咨询','Token top-up inquiry'))}">${t('咨询加量','Ask about top-ups')} ↗</a></div>
      </section>

      <section class="usage-principles" aria-labelledby="app-subscription-title"><div><span class="pricing-eyebrow">AGENT APPS · ${t('后续规划','PLANNED')}</span><h2 id="app-subscription-title">${t('把作品，带给真正使用它的人。','Bring your creation to the people who use it.')}</h2></div><div class="usage-grid"><article><span>01</span><h3>${t('一键导出应用','One-click app export')}</h3><p>${t('以 Windows、macOS 与手机应用为目标，交付独立界面与积木执行。各端工具、权限与分发分别适配。','Targeting Windows, macOS, and mobile apps with an independent interface and block execution. Tools, permissions, and distribution are adapted for each platform.')}</p></article><article><span>02</span><h3>${t('设置用量承担方式','Choose who pays for usage')}</h3><p>${t('在应用设置中选择使用者账户或开发者承担托管用量。构建、调试与运行按实际消耗合并扣减对应账户额度。','App settings will let you choose user-paid or developer-paid hosted usage. Building, testing, and running consume the responsible account’s shared allowance.')}</p></article><article><span>03</span><h3>${t('为你的应用创建订阅','Create a subscription for your app')}</h3><p>${t('开发者可快捷创建应用订阅、自主定价，并咨询企业级 Token 方案。应用售价与模型算力费用分别核算。','Developers will be able to create app subscriptions, set their own prices, and discuss enterprise Token plans. App pricing and model compute costs are accounted for separately.')}</p><a class="text-link" href="${inquiry(t('开发者应用订阅与企业 Token 定价咨询','Developer app subscriptions and enterprise Token pricing'))}">${t('咨询企业 Token 定价','Discuss enterprise Token pricing')} ↗</a></article></div></section>

      <section class="usage-principles" aria-labelledby="usage-title"><div><span class="pricing-eyebrow">${t('清楚每一份用量','UNDERSTAND YOUR USAGE')}</span><h2 id="usage-title">${t('按真实调用，计算消耗。','Usage follows actual calls.')}</h2></div><div class="usage-grid"><article><span>01</span><h3>${t('积分不是固定 Token 数','Credits aren’t a fixed token count')}</h3><p>${t('模型、输入、输出与缓存费率不同。正式开放时公布逐模型折算费率，不承诺固定对话次数。','Model, input, output, and cache rates vary. Per-model rates will be published at launch; no fixed number of conversations is promised.')}</p></article><article><span>02</span><h3>${t('任务越深入，用量越不同','Different tasks, different usage')}</h3><p>${t('长上下文、多轮推理、工具调用后的模型请求，都按实际发生的用量累计。','Long context, multiple reasoning rounds, and model requests following tool calls all contribute to actual usage.')}</p></article><article><span>03</span><h3>${t('软件、模型、服务分别核算','Software, models, and services')}</h3><p>${t('个人软件免费；托管算力按套餐；自带 API 向供应商付费；机构服务按需求报价。','Personal software is free; hosted compute uses plans; your own API is paid to its provider; organizational services are quoted to scope.')}</p></article></div></section>

      <section id="organization-pricing" class="organization-pricing" aria-labelledby="organization-title"><div class="organization-copy"><span class="pricing-eyebrow">FOR SCHOOLS & TEAMS</span><h2 id="organization-title">${t('把一份创造力，','Bring one spark')}<br>${t('带进更多人的日常。','to more people.')}</h2><p>${t('从课堂到团队，把组织、资源与支持配置到真正需要的地方。','From classrooms to teams, shape the management, resources, and support you need.')}</p><a class="button button-accent" href="${inquiry(t('学校与团队方案咨询','School and team plan inquiry'))}">${t('获取定制方案','Discuss a tailored plan')} ↗</a><small>${t('根据规模与交付范围报价，模型算力单独核算。','Quoted by scale and scope. Model compute is priced separately.')}</small></div><div class="organization-details">${[
      [['01','学校与教育机构','Schools & educators'],['师生与班级管理、课程与任务、学习过程和教学支持。','Teachers, students, classes, lessons, assignments, learning progress, and teaching support.']],
      [['02','专业团队','Professional teams'],['成员与权限、共享模型配置、工作流程与部署支持。','Members, permissions, shared model configuration, workflows, and deployment support.']],
      [['03','一起确定范围','Define the scope together'],['人数与班级规模、使用频率、部署方式、课程或技术支持，以及算力预算。','Headcount and class size, usage frequency, deployment, curriculum or technical support, and compute budget.']]
      ].map(([title,body])=>`<article><span>${title[0]}</span><div><h3>${title[en?2:1]}</h3><p>${pair(body)}</p></div></article>`).join('')}</div></section>

      <section class="pricing-faq" aria-labelledby="pricing-faq-title"><div><span class="pricing-eyebrow">FAQ</span><h2 id="pricing-faq-title">${t('先把问题讲清楚。','A few useful answers.')}</h2></div><div>${pricingFaq.map(([q,a])=>`<details><summary>${pair(q)}</summary><p>${pair(a)}</p></details>`).join('')}</div></section>
      <section class="pricing-contact"><p>${t('还不确定从哪里开始？','Not sure where to start?')}</p><a href="${inquiry(t('定价与用量咨询','Pricing and usage inquiry'))}">q2955161835@gmail.com <span aria-hidden="true">↗</span></a><small>${t('聊聊你想搭建什么。','Tell us what you want to build.')}</small></section>
    </main>`;
  }
  container.addEventListener('click',event=>{const button=event.target.closest('[data-pricing-scroll]');if(button)container.querySelector('#'+button.dataset.pricingScroll)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});});
  render();const unsubscribe=subscribePreferences(()=>{if(en!==(getPreferences().resolvedLanguage==='en'))render();});
  return ()=>{unsubscribe();container.replaceChildren();};
}
