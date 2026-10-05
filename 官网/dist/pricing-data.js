// Proposed hosted-compute plans. Software capabilities stay free.
export const pricingPlans = [
  {id:'standard',name:['标准','Standard'],price:99,credits:2000,tag:['日常创作','Everyday creation'],description:['为学习探索与日常任务准备。','For learning, exploration, and everyday tasks.']},
  {id:'plus',name:['进阶','Plus'],price:199,credits:4500,tag:['持续创作','Keep creating'],description:['适合经常搭建、调试与改进作品。','For frequent building, testing, and iteration.']},
  {id:'pro',name:['专业','Pro'],price:999,credits:25000,tag:['深度创作','Deeper work'],description:['为复杂任务与高频模型调用准备。','For complex tasks and frequent model calls.']}
];
export const topUp={price:50,credits:1000,days:30};
export const pricingFaq=[
  [['不购买套餐，也能使用 Blocky 吗？','Can I use Blocky without a subscription?'],['可以。个人客户端完整创作能力免费，Token 套餐只面向托管模型服务。你也可以连接自己的 API，由模型供应商独立计费。','Yes. The personal client’s full creation tools are free. Token plans cover hosted models only. You can also connect your own API and pay the model provider directly.']],
  [['积分与 Token 是什么关系？','How do credits relate to tokens?'],['Token 是模型处理文本的计量单位，积分是托管模型用量的统一结算单位。不同模型的输入、输出与缓存费率不同，积分不对应固定 Token 数。各模型折算费率将在服务正式开放时公布。','Tokens measure the text processed by models. Credits account for hosted model usage. Input, output, and cache rates differ by model, so credits do not equal a fixed token count. Per-model credit rates will be published when the service launches.']],
  [['多轮 Agent 任务如何消耗额度？','How do multi-step agents use credits?'],['一次任务可能包含多轮思考、资料上下文和工具调用后的模型请求，按实际发生的模型用量累计。不能把一条消息或一次任务等同于固定积分。','A task may include multiple reasoning rounds, document context, and model requests after tool calls. Actual model usage is accumulated; one message or task does not have a fixed credit cost.']],
  [['月度额度与加量包何时到期？','When do monthly credits and top-ups expire?'],['拟定规则：月度额度按订阅周期发放，当期有效，不结转。加量包从到账起 30 天有效，优先使用最早到期的额度。','Proposed policy: monthly credits are issued per billing cycle and expire at its end without rollover. Top-ups are valid for 30 days from issue. Credits expiring soonest are used first.']],
  [['学校与团队需要另外购买 Token 吗？','Do schools and teams pay separately for tokens?'],['组织后台、课程支持、部署与维护按需求报价，模型算力单独核算。可根据人数、使用频率与预算讨论托管额度，也可使用组织自有模型连接。','Organization management, curriculum support, deployment, and maintenance are quoted to scope. Model compute is billed separately. Discuss hosted credits based on headcount, usage, and budget, or use your organization’s model connection.']],
  [['现在可以购买这些套餐吗？','Can I purchase these plans now?'],['当前为拟定方案，尚未开放在线购买。可以通过本页咨询用途与用量；正式上线时，以公布的模型费率、套餐与服务条款为准。','These are proposed plans; online purchasing is not available yet. Contact us to discuss your use case and usage. Published model rates, plans, and terms will apply when the service launches.']]
];
