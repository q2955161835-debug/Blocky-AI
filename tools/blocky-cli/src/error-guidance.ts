const guidance: Record<string, { message: string; hint: string }> = {
  "BLK-RPA-BROWSER-MISSING": { message: "未找到 Microsoft Edge 浏览器。", hint: "安装 Edge 后重新运行；WebView2 Runtime 不能替代完整浏览器。不会自动安装或使用现有个人浏览器会话。" },
  "BLK-RPA-RUNTIME-001": { message: "浏览器驱动缺失或不完整。", hint: "开发环境运行 pnpm build:browser 并重建 CLI/桌面；安装包请恢复随包 browser 目录。" },
  "BLK-RPA-RUNTIME-HASH": { message: "浏览器驱动未通过完整性校验。", hint: "恢复当前版本的完整 browser 目录；不会继续启动不匹配的驱动。" },
  "BLK-RPA-BROWSER-001": { message: "浏览器操作未完成。", hint: "检查网址、唯一定位器和页面状态；当前只允许初始来源，拒绝跨来源资源和所有 HTTP 重定向。核对回执后再安排后续操作。" },
  "BLK-FLOW-001": { message: "并行分支包含不支持的操作。", hint: "分支只允许结果、条件、等待、失败和并行积木；共享状态和外部副作用应放在汇合后的顺序步骤。" },
  "BLK-FLOW-002": { message: "流程超出并行或等待上限。", hint: "嵌套并行最多 4 层，等待为 0–30000 毫秒，汇合结果最多 32768 UTF-8 字节；缩减流程后重新编译。" },
  "BLK-FLOW-003": { message: "流程主动报告失败。", hint: "通过运行轨迹定位报告失败的积木；其余并行分支结束后运行才会失败，后续步骤不会执行。" },
  "BLK-EVENT-001": { message: "事件通道或等待参数无效。", hint: "通道使用稳定标识，等待时间为 0–30000 毫秒；通过 project compile 定位积木。" },
  "BLK-EVENT-002": { message: "事件队列达到容量上限。", hint: "先接收已有消息或减少负载。会话最多 128 条、总计 256 KiB，每条最多 16000 UTF-8 字节；重启会丢弃未处理消息。" },
  "BLK-RPA-LOCATOR-003": { message: "定位器匹配多个控件。", hint: "补充 automationId、name 或 controlType，使目标唯一；不会自动选择第一个。" },
  "BLK-RPA-LOCATOR-004": { message: "目标窗口内未找到控件。", hint: "检查控件标识、窗口状态和权限；需要等待出现时使用 wait 步骤。" },
  "BLK-RPA-TARGET-001": { message: "目标窗口已失效或身份发生变化。", hint: "重新运行 rpa targets，核对目标后生成新的授权；不要沿用旧窗口句柄。" },
  "BLK-RPA-SENSITIVE-001": { message: "当前桌面自动化不允许此敏感输入操作。", hint: "密码控件和通用 SecretStore 引用尚未开放给 RPA；由用户在目标应用中直接完成敏感步骤。" },
  "BLK-RPA-PORT-001": { message: "当前运行没有可用的自动化 Host。", hint: "CLI 模块自动化必须显式使用 run start --live；simulate 不执行真实桌面操作。原生批准仍按次请求。" },
  "BLK-RPA-SCOPE-001": { message: "自动化步骤不在有效会话中。", hint: "把操作放入连接窗口或打开浏览器的步骤插槽；不要混入另一目标或嵌套控制流。" },
  "BLK-RPA-INPUT-002": { message: "本次运行缺少手动填写内容。", hint: "桌面在运行时输入；CLI 使用 --rpa-inputs，键为 moduleId/blockId。内容不写入项目或轨迹。" },
  "BLK-RPA-RECEIPT-002": { message: "副作用结果尚未核对，禁止重放。", hint: "查看 checkpoint 与目标应用，核对实际结果后再安排新的流程。" },
  "BLK-RPA-JOURNAL-001": { message: "执行记录无法保存或读取。", hint: "保留记录并检查磁盘和当前 Windows 用户权限；使用 rpa checkpoint 查看回执并核对目标应用，不能盲目重放。" },
  "BLK-RPA-JOURNAL-002": { message: "执行记录与计划不匹配。", hint: "使用原计划和正确的 checkpoint-id 查询；修改后的计划不能沿用原执行记录。" },
  "BLK-RPA-JOURNAL-003": { message: "执行记录正被使用或修订已变化。", hint: "结束其他查询后重新读取记录；先核对实际操作结果，不要重新运行未确认的步骤。" },
  "BLK-RPA-JOURNAL-004": { message: "执行记录达到存储上限。", hint: "保留未核对的回执并检查记录数量和磁盘占用；本版本不会自动删除执行记录。" },
  "BLK-RPA-RECOVERY-001": { message: "原执行进程仍在运行，或无法确认其已退出。", hint: "在原会话继续或停止；完全退出原 Host 后再请求恢复。旧格式缺少进程身份的记录仅供查看。" },
  "BLK-RPA-RECOVERY-002": { message: "此执行记录无法继续。", hint: "已完成流程无需恢复；存在进程结算失败时先处理结算问题，不能重新发送副作用。" },
  "BLK-RPA-RECOVERY-003": { message: "恢复条件没有完整覆盖已完成的副作用。", hint: "为每个已完成回执提供唯一的 UIA 状态核对条件；用 schema show blocky.rpa-recovery/v1 查看格式。" },
  "BLK-RPA-RECOVERY-004": { message: "目标当前状态与恢复条件不一致。", hint: "核对目标应用的实际业务状态与已完成步骤；未执行剩余步骤，不要盲目重放。" },
  "BLK-RPA-SETTLEMENT-001": { message: "自动化进程尚未确认全部结算。", hint: "保留 uncertain 回执，检查剩余进程；不能将此状态视为已停止或重新运行。" },
  "BLK-RPA-UNSUPPORTED-001": { message: "本机 Host 尚不支持该 RPA 操作。", hint: "支持 UIA 和隔离浏览器的 find/read/click/fill/wait；浏览器需 --browser-url/--project-id。坐标回退和截图仍在开发。" },
  "BLK-PATCH-001": {
    message: "项目基线已改变，候选或恢复请求已过期。",
    hint: "重新运行 project inspect 获取 digest，再生成或审查候选；不要重用旧批准。",
  },
  "BLK-PATCH-002": {
    message: "补丁未通过结构、目录或 Host 校验；原项目未改变。",
    hint: "运行 schema show blocky.cli-operations/v1 和 patch preview；构建请求可用 builder evidence --request-id 查询失败阶段。",
  },
  "BLK-PATCH-003": {
    message: "补丁权限增量不一致，或新增权限尚未批准。",
    hint: "运行 patch preview 审查 permissionDelta，再用 --approve-permissions 批准确需的权限。",
  },
  "BLK-PATCH-004": {
    message: "候选应用后仍有编译错误。",
    hint: "运行 project compile 与 project block show 定位诊断，修正候选后重新验证。",
  },
  "BLK-RESOURCE-001": {
    message: "积木引用的资源不存在或类型不匹配。",
    hint: "运行 project resource list 与 project block show，使用已声明且类型正确的资源。",
  },
  "BLK-RESOURCE-002": {
    message: "资源秘密引用不一致。",
    hint: "核对 resource list 与 secret status；不要在积木或参数中写入密钥。",
  },
  "BLK-BUILDER-LOCAL-LIMIT": {
    message: "离线构建仅支持角色调整和解释，当前需求需要在线模型。",
    hint: "选择已配置资源使用 builder draft/explain/repair --live --model，先预检再批准。",
  },
  "BLK-CONFIG-001": {
    message: "目标积木、字段或配置值无效。",
    hint: "使用 project block show 查询字段，catalog show 获取目录定义。",
  },
  "BLK-CLI-005": {
    message: "输出目标已存在，未覆盖。",
    hint: "选择新的 --output 路径，保留原文件作为检查点。",
  },
  "BLK-PERM-001": {
    message: "请求尚未获准，或批准已失效。",
    hint: "重新预检项目、资源与摘要，仅批准本次明确的操作。",
  },
};
export const errorGuidance = (code: string) =>
  Object.hasOwn(guidance, code) ? guidance[code] : undefined;
