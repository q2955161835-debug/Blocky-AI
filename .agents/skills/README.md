# Blocky 项目材料制作技能

2026-10-03 按用户授权引入以下三个技能，安装范围仅为本项目。每个技能的完整上游文件、MIT 许可证和来源提交均保留；版本及文件指纹见 [sources.json](sources.json)。

| 技能 | 用途 | 入口 |
| --- | --- | --- |
| build-client-business-plans | 商业计划书、市场证据、经营与财务假设、情景预测 | [SKILL.md](build-client-business-plans/SKILL.md) |
| sales-enablement | 产品展示场景、演示脚本、价值表达、竞品及质疑应答 | [SKILL.md](sales-enablement/SKILL.md) |
| creating-presentations | 路演叙事、每页观点、视觉结构与讲稿提示 | [SKILL.md](creating-presentations/SKILL.md) |

## 在 Blocky 中使用

- 先读取项目 `AGENTS.md` 和[当前市场与竞品调研](../../doc/产品设计/2026-10-02-Blocky市场与竞品深度调研.md)，复用已经确认的定位与资料。
- 当前材料围绕教育定位、完整产品免费、学校与教育机构联系报价展开；办公属于后期方向。
- 商业计划书采用与实际项目一致的中国市场、人民币口径；上游加拿大及 CAD 默认值、融资目标和预测数字不能直接作为项目事实。未确认金额明确列为假设。
- 产品展示优先选择已实现并有运行证据的完整场景。演示能力、真实用户使用、学校合作、收入及教学效果分别以对应证据表述。
- 现场演示按实际答辩时长组织；上游销售会议或投资人阅读版的时长、页数和融资结构仅作参考。
- 内容方法由这三个技能提供；PPT、Word、表格等文件的生成与视觉检查仍可配合本机已有的对应制作技能。

## 依赖与安装边界

- `sales-enablement` 和 `creating-presentations` 的内容工作流不要求额外安装软件。前者列出的其他营销技能与 Introw 集成为可选参考，本次没有一并安装。
- `build-client-business-plans` 附带三个 Office 模板、八个 Python 脚本和六份参考说明。脚本使用 Python 3.10+、`openpyxl`、`lxml`；财务模板自动重算还需要 LibreOffice、`soffice` 命令和与其匹配的 Python UNO 桥。
- 本次仅安装并检查技能文件。已检查的系统 Python 可导入 `openpyxl`、`lxml`；LibreOffice/UNO 重算环境未就绪，尚未运行模板填充、自动重算或成品生成。执行该部分前须补齐依赖，或按上游 `financial-model-map.md` 中适用条件选择替代工作簿流程，并验证最终数字。
- 安装器已清理下载文件；`try/skill-install-2026-10-03/codex/` 仅剩空目录，0 个文件、0 字节文件内容。收尾删除被自动审批以 `blocked by policy` 拒绝，保留待清理。没有向全局技能目录安装，也没有新增全局依赖。

## 本地适配与维护

- `sales-enablement/SKILL.md` 的两个可选工具文档链接改为锁定提交的上游链接，避免指向不存在的本地跨包目录；其余上游文件保持原始字节。
- `.gitattributes` 为三个技能目录保留原始字节。更新时先核对来源和许可证，再更新 `sources.json`，保留并复核上述本地适配。
