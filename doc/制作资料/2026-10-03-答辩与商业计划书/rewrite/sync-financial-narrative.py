"""Keep BP financial prose tied to the recalculated workbook summary."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
summary = json.loads((root.parent / 'funding-24m/funding-summary.json').read_text(encoding='utf-8'))
path = root / 'business-plan-v2.json'
content = json.loads(path.read_text(encoding='utf-8'))
base = summary['base']
wan = lambda value: f'{value / 10000:,.3f}'
phase = summary['phase_cash']
replacements = {
    '资源规划以24个月': f"24个月基准覆盖规划的最低追加资金为{wan(base['required_additional_funding'])}万元，取整目标{wan(base['proposed_funding'])}万元。它覆盖研发与产品准备后条件场景，按关口分阶段投入；前18个月研发现金支出为{wan(phase[0]['cash']+phase[1]['cash'])}万元。完整覆盖额的主要增量来自未来专业云创作者的算力容量，人数与启用时间是情景输入，不能解读为当前市场需求。内部研发与外部用户用量分开，未确认收入、自有资金与厂商优惠均不抵减需求。",
    '内部开发与评测算力随': f"算力采用三类依据。项目历史10个有回执任务含30个响应，累计输入76,845、输出5,738 Token，缓存拆分及部分失败用量不完整；按DeepSeek当前Pro峰时未命中输入9元、输出27元/百万Token重定价，每个短任务参考{summary['usage']['short_task_peak_cny']:.8f}元，不能称为息壤实际账单。[F11][F12] 学生每月4次活动、每次10任务，教师每月12次准备、每次20任务，均是短任务频次假设，不能代表完整专业Agent或真实课堂成本。",
    '表17按共享资金模型': f"表17按共享资金模型列示24个月建设、条件用户用量及缓冲。基准外部算力采购{wan(base['customer_token_cost'])}万元，内部研发算力{wan(base['dev_compute'])}万元，二者分开。规划前18个月用于研发，之后仅在产品准备关口与实际场景条件满足后启用平台采购容量；预算按学生、教师与专业创作者的实际采购人头滚动更新，BYOK及本地用户排除。设备现金与折旧、预付额度与消耗、保证金与费用分别处理。",
    '表18区分现金支出': f"表18中现金支出为{wan(base['cash_paid'])}万元，最低追加资金{wan(base['required_additional_funding'])}万元，取整目标{wan(base['proposed_funding'])}万元。目标是24个月条件覆盖预算，不是估值、已到账资金或当前一轮融资的固定报价。第1至6月模板研发支出{wan(phase[0]['cash'])}万元，第7至18月后续产品开发支出{wan(phase[1]['cash'])}万元，第19至24月条件场景支出{wan(phase[2]['cash'])}万元；月序为资源排期假设，关口延期则重新安排。现金储备和预留随实际执行调整，已确认自有资金及回款才能抵减外部需求。",
}
blocks = []
for block in content['blocks']:
    if block.get('financialNarrativeKey') == 'professional-reference':
        continue
    text = block.get('text', '')
    for prefix, replacement in replacements.items():
        if text.startswith(prefix) or block.get('financialNarrativeKey') == prefix:
            block['text'] = replacement
            block['financialNarrativeKey'] = prefix
            break
    blocks.append(block)
    if block.get('financialNarrativeKey') == '内部开发与评测算力随':
        blocks.append({'type': 'p', 'financialNarrativeKey': 'professional-reference', 'text': f"Claude Code官方企业使用统计为150–250美元/开发者月，专业云创作者采用200美元中点作外部资源参照；按2026年9月30日参考中间价6.7351换算，区间为{summary['usage']['professional_low_cny']:,.2f}–{summary['usage']['professional_high_cny']:,.2f}元/月。[F13][F14] 该统计不是Blocky实测，也不套用于小学生。研发采用另一独立口径，13美元/活跃日乘22个假设活跃日及参考汇率，每等效资源月{summary['usage']['developer_monthly_cny']:,.2f}元，不再叠加典型月成本。厂商实际采购价格、托管适用条款和合作条件须以账单及合同校准。[F15]"})
content['blocks'] = blocks
# Replace reference paragraphs by stable identifiers; keep all URLs public.
references = {
    '[F11]': '[F11] Blocky项目调用样本，调用日期2026-10-02。10个有回执任务、30个响应，输入76,845与输出5,738；部分失败及缓存分类未覆盖。用于短任务重定价参考，不作为课堂或完整模板月账单。',
    '[F12]': '[F12] DeepSeek中文Models & Pricing，访问2026-10-03。Pro峰时未命中输入9元、输出27元/百万Token；直供价格不能替代息壤付款记录。https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    '[F13]': '[F13] Claude Code Manage costs effectively，访问2026-10-03。企业开发者150–250美元/月、活跃日均约13美元；供应商统计，采样期间未披露，不是本项目用户实测。https://code.claude.com/docs/en/costs',
    '[F14]': '[F14] 中国外汇交易中心主办中国货币网，官方网页索引读回2026-09-30 9:15美元/人民币中间价6.7351。历史预算换算基准，不是实际银行付款汇率。https://www.chinamoney.com.cn/chinese/index.html',
    '[F15]': '[F15] 天翼云AI专项页，访问2026-10-03。公开编程Token Plan不能证明本项目Pro分类扣费、托管或转售条款；合作报价未知。https://www.ctyun.cn/act/AI/zhuanxiang',
}
content['blocks'] = [b for b in content['blocks'] if not any(b.get('text', '').startswith(k) for k in references)]
reference_pos = next(i for i, b in enumerate(content['blocks']) if b.get('text') == 'Appendix C. 情景分析')
content['blocks'][reference_pos:reference_pos] = [{'type': 'p', 'text': v} for v in references.values()]
path.write_text(json.dumps(content, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'version': content['version'], 'funding': base['proposed_funding'], 'research_cash': phase[0]['cash']+phase[1]['cash']}, ensure_ascii=False))
