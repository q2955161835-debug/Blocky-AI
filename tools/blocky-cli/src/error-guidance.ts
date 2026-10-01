const captureHint =
  "运行 rpa captures 查询当前资料目录的截图；用 capture-delete 删除不再需要的记录，capture-export 导出到新文件。";
const guidance: Record<string, { message: string; hint: string }> = {
  "BLK-RESOURCE-CONFLICT": { message: "本机资源已被其他写入修改，原配置保留。", hint: "重新查询 provider list 和 resource list，保留草稿，审查差异后使用当前修订重试。" },
  "BLK-PROVIDER-IN-USE": { message: "厂商连接仍被模型引用。", hint: "查询 model-profile list，先迁移或删除引用该连接的模型，再删除连接。" },
  "BLK-RESOURCE-BACKUP-MISSING": { message: "没有可用的旧资源账本备份。", hint: "保留当前配置；resource migrate 首次迁移才创建旧账本备份，不自动丢弃新配置。" },
  "BLK-MEMORY-CONFLICT": { message: "记忆已被其他写入修改，原内容保留。", hint: "读取当前版本，审查差异后用新的 expectedVersion 重试；merge 只合并对象顶层字段，reject 保留已有条目。" },
  ...Object.fromEntries(
    [
      "CONFIG",
      "INPUT",
      "INPUT-LIMIT",
      "METHOD",
      "TRANSPORT",
      "TIMEOUT",
      "REDIRECT",
      "AUTH",
      "STATUS",
      "CONTENT-TYPE",
      "JSON",
      "LIMIT",
    ].map((code) => [
      `BLK-TOOL-HTTP-${code}`,
      {
        message: "工具 HTTP 请求未完成或响应无效。",
        hint: "先运行 tool status --project-id 核实回执与实际副作用；unknown 须 reconcile，不能自动重发。检查资源的固定目标、认证引用、GET 标量输入、预算和 JSON 响应后重新预检。",
      },
    ]),
  ),
  "BLK-TOOL-SCHEMA": {
    message: "工具输入或输出与资源 Schema 不符。",
    hint: "核对资源和 discover 返回的 Schema，修正 input 后重新预检；调用失败先查询 tool status 并核实副作用。",
  },
  "BLK-TOOL-BINDING": {
    message: "工具资源或工件绑定发生变化。",
    hint: "核对资源及锁定工件后重新预检；旧审批不可复用。",
  },
  "BLK-TOOL-BUNDLE": {
    message: "MCP 工件缺失或完整性校验失败。",
    hint: "核对资源的锁定工件与版本，恢复完整工件后重新预检；不要运行未知文件。",
  },
  "BLK-TOOL-LIMIT": {
    message: "工具输入、输出或账本达到上限。",
    hint: "缩小输入和结果，保留现有回执；先用 tool status 核实未知副作用，不能删除回执后重发。",
  },
  "BLK-TOOL-INVALID": {
    message: "工具请求不符合 v2 契约。",
    hint: "运行 schema show blocky.tool-request/v2；只填写资源引用，检查 action/input 和超时，端点、请求头及启动配置使用 secret-env 导入。",
  },
  "BLK-TOOL-CONFIG": {
    message: "工具资源配置或秘密绑定缺失。",
    hint: "核对 resource list、secret status 与资源类型；endpoint/headers/launch 只通过本地 .env 的 secret-env 导入，再重新预检。",
  },
  "BLK-TOOL-PERMISSION": {
    message: "工具资源没有声明所需权限。",
    hint: "核对资源声明的 network.request 或 mcp.local 权限；重新预检并批准确需的操作。",
  },
  "BLK-TOOL-BUDGET": {
    message: "工具请求超过资源超时预算。",
    hint: "降低 timeoutMs 或明确调整资源预算，再重新预检。",
  },
  "BLK-TOOL-BUSY": {
    message: "工具调用或账本仍被占用。",
    hint: "停止原调用并等待结算，再用 tool status --project-id 查询；不要并发重发。",
  },
  "BLK-TOOL-RECOVERY-REQUIRED": {
    message: "已有工具调用结果未知，当前资源暂停执行。",
    hint: "用 tool status --project-id 核对请求。确认实际副作用后，运行 tool reconcile-preflight，再按摘要批准 tool reconcile；不能自动重发。",
  },
  "BLK-TOOL-RECOVERY-STATE": {
    message: "该回执当前不能核实结算。",
    hint: "刷新 tool status；只有 unknown 状态可 reconcile，仍在运行时先停止并等待结算。",
  },
  "BLK-TOOL-REPLAY": {
    message: "请求标识已经消费，禁止重复执行。",
    hint: "先用 tool status 核对原回执；未知结果须 reconcile。仅在确认下一次操作确需执行时创建新的 requestId 并重新预检批准。",
  },
  "BLK-TOOL-INTERRUPTED": {
    message: "工具会话中断，实际结果未知。",
    hint: "用 tool status --project-id 查询并核实实际副作用，再预检和批准 reconcile；不要自动重发。",
  },
  "BLK-TOOL-CANCELLED": {
    message: "工具调用已请求取消。",
    hint: "等待 Host 结算并查询 tool status；call 的实际副作用可能未知，核实后再 reconcile。",
  },
  "BLK-TOOL-TIMEOUT": {
    message: "工具调用达到超时上限。",
    hint: "先查询 tool status 并核实目标的实际副作用，unknown 状态须 reconcile；不要直接重试。",
  },
  "BLK-TOOL-RECEIPT": {
    message: "工具回执无法读写或核验。",
    hint: "保留账本，检查资料目录和磁盘权限；核对实际副作用，不要删除回执后重发。",
  },
  "BLK-TOOL-SCHEMA-CHANGED": {
    message: "MCP 服务的工具 Schema 已变化。",
    hint: "重新 discover，核对资源输入/输出 Schema 后重新预检；原批准不能用于变化后的服务。",
  },
  "BLK-MCP-SESSION-EXPIRED": {
    message: "MCP 会话已失效。",
    hint: "查询 tool status 核对原请求；工具调用可能已发生，先核实并 reconcile，不会自动初始化会话或重发。",
  },
  "BLK-LOCAL-MODEL-MISSING": {
    message: "托管模型或运行工件尚未安装。",
    hint: "运行 model catalog，选择 model install <id> --backend cpu --download；离线安装须同时提供 --model-file 与 --runtime-file。",
  },
  "BLK-LOCAL-MODEL-HASH": {
    message: "本地模型或运行工件的尺寸、SHA256 不匹配。",
    hint: "运行 model verify <id>；保留错误码，使用 model remove 后重新安装官方锁定工件，不要跳过校验。",
  },
  "BLK-LOCAL-MODEL-BUSY": {
    message: "模型正在运行或资源事务仍被占用。",
    hint: "停止使用该模型的运行并等待 Host 结算，再执行 model status/verify；不要按进程名称结束其他程序。",
  },
  "BLK-LOCAL-MODEL-BACKEND": {
    message: "已安装后端与模型资源设置不一致。",
    hint: "运行 model status <id> 核对 cpu/vulkan，在资源配置中使用相同后端；更换安装后端须先停止运行并移除旧安装。",
  },
  "BLK-LOCAL-MODEL-EXISTS": {
    message: "该模型已有安装，未覆盖。",
    hint: "先执行 model status/verify；确需替换时停止相关运行，再 model remove 后重新安装。",
  },
  "BLK-LOCAL-MODEL-OWNERSHIP": {
    message: "工件目录所有权或内容与安装清单不一致。",
    hint: "保留现场并核对 model status/verify；不要批量删除未知文件或外部模型目录。",
  },
  "BLK-LOCAL-MODEL-PATH": {
    message: "本地工件路径不符合受控安装边界。",
    hint: "使用 model catalog 的锁定工件及普通本地文件，避免链接、目录跳转与共享路径；路径仅发送给 Host。",
  },
  "BLK-LOCAL-MODEL-DOWNLOAD": {
    message: "官方模型工件下载未完成。",
    hint: "检查网络和磁盘空间后重试 model install --download；也可使用经过校验的模型与对应后端 zip 成对离线安装。",
  },
  "BLK-LOCAL-MODEL-SOURCE": {
    message: "模型工件来源不在允许的官方来源中。",
    hint: "使用 model catalog 指定的锁定工件；不要换用镜像或关闭来源校验。",
  },
  "BLK-LOCAL-MODEL-INVALID": {
    message: "托管模型请求或型号无效。",
    hint: "运行 model catalog 获取固定型号，并使用 cpu/vulkan 后端；安装下载与本地源不能混用。",
  },
  "BLK-LOCAL-MODEL-IO": {
    message: "托管模型工件无法读写。",
    hint: "检查选定资料目录的磁盘空间与当前用户权限；保留原模型，修正问题后运行 model verify。",
  },
  "BLK-LOCAL-MODEL-CANCELLED": {
    message: "托管模型操作已停止。",
    hint: "运行 model status/verify 读回工件状态，再决定是否继续安装或运行。",
  },
  "BLK-LOCAL-MODEL-UNSETTLED": {
    message: "模型进程尚未确认完整退出。",
    hint: "停止相关运行并保留错误码，检查 Host 结算状态；不要删除工件或自动重发生成。",
  },
  "BLK-LOCAL-MODEL-START": {
    message: "受控本地模型服务未能启动。",
    hint: "运行 model verify；先使用 cpu 后端检查基线，再核对 GPU 设备与驱动。",
  },
  "BLK-LOCAL-MODEL-TIMEOUT": {
    message: "本地模型在启动期限内未就绪。",
    hint: "先运行 model verify，检查内存、CPU/GPU 负载与资源超时；确认原进程结算后再试。",
  },
  "BLK-LOCAL-MODEL-IDENTITY": {
    message: "本地服务响应未匹配本次受控模型身份。",
    hint: "保留错误码并检查受控服务与端口；不要连接、接管或结束已有外部服务。",
  },
  "BLK-MODEL-REQUEST": {
    message: "模型请求或工具历史不符合 v2 契约。",
    hint: "运行 schema show blocky.model-request/v2；只使用资源引用，配对 toolCalls 与 toolCallId，不填写 URL 或秘密。",
  },
  "BLK-MODEL-RESPONSE": {
    message: "模型响应、工具调用或用量格式无效。",
    hint: "保留请求 ID 并核对 Host/CLI 版本；未知用量保持 unavailable，生成可能已发生，勿自动重试。",
  },
  "BLK-MODEL-CONFIG": {
    message: "模型资源或秘密绑定缺失、不兼容。",
    hint: "运行 resource list 和 secret status 核对本机用户模型；自定义/Ollama 端点通过 baseUrl 秘密引用导入。",
  },
  "BLK-MODEL-CAPABILITY": {
    message: "模型资源未声明此次请求所需能力。",
    hint: "核对文本、工具调用与结构化输出声明，删除不需要的 tools/outputSchema，或选择支持这些能力的资源。",
  },
  "BLK-MODEL-BUDGET": {
    message: "请求输出上限或超时超过模型资源预算。",
    hint: "降低请求 maxOutputTokens/timeoutMs，或在资源配置中明确调整预算后重新预检。",
  },
  "BLK-MODEL-ENDPOINT": {
    message: "模型端点不符合服务类型或网络边界。",
    hint: "通过本地配置更新 baseUrl 引用；远程服务使用公开 HTTPS，Ollama 使用本机端点，再重新预检。",
  },
  "BLK-MODEL-TRUNCATED": {
    message: "模型输出达到上限，结果不完整。",
    hint: "调整输出预算或缩短请求后重新预检；不接受截断工具参数或结构化输出。",
  },
  "BLK-MODEL-DEFAULT-001": {
    message: "本机模型未配置或不可用。",
    hint: "运行 resource list 核对模型；用 settings set --id models.defaultResourceId 选择已配置资源，或 settings reset --id models.defaultResourceId 恢复本地默认。",
  },
  "BLK-WORKFLOW-RUNTIME": {
    message: "受控运行组件缺失或未通过完整性校验。",
    hint: "开发环境从仓库根运行 pnpm build:cli；安装包请恢复同版本完整 cli 与 builder 目录，保留工作流记录。",
  },
  "BLK-WORKFLOW-APPROVAL": {
    message: "审批摘要与当前任务不一致。",
    hint: "不带 --approve 重新预检原 workflow decide 或 reconcile 命令，核对任务、步骤、修订和决定后使用新的 requestDigest。",
  },
  "BLK-WORKFLOW-CONFLICT": {
    message: "工作流修订已改变。",
    hint: "用 workflow show 读取最新修订，重新核对操作；不要重用旧审批摘要。",
  },
  "BLK-WORKFLOW-STATE": {
    message: "当前工作流状态不接受此操作。",
    hint: "运行 workflow show 查看待审批步骤及状态；仅批准正在等待的步骤。",
  },
  "BLK-WORKFLOW-CHANNEL": {
    message: "原生工作流会话未正常结束。",
    hint: "检查 workflow show 的持久状态；没有完成回执的步骤不可自动重放。",
  },
  "BLK-WORKFLOW-NOT-FOUND": {
    message: "当前资料目录中没有此工作流任务。",
    hint: "运行 profile show 核对资料目录，再用 workflow list --project-id 查询任务标识。",
  },
  "BLK-WORKFLOW-BINDING": {
    message: "任务与项目或执行定义不一致。",
    hint: "核对项目标识、模块、积木与计划摘要；不要用已修改的项目重放旧任务。",
  },
  "BLK-WORKFLOW-INVALID": {
    message: "工作流请求或摘要格式无效。",
    hint: "运行 command list --query workflow 和 schema show blocky.workflow-summary/v1 核对命令与结构。",
  },
  "BLK-WORKFLOW-STORE": {
    message: "工作流账本不可读取或未通过完整性校验。",
    hint: "保留现有记录，检查当前资料目录的文件访问及磁盘状态；不要删除记录后重跑副作用。",
  },
  "BLK-WORKFLOW-LIMIT": {
    message: "工作流状态或账本超出容量上限。",
    hint: "缩小步骤上下文；保留现有检查点，检查任务数量和磁盘占用。",
  },
  "BLK-WORKFLOW-OWNER": {
    message: "工作流仍由其他执行会话占用，或无法确认其已退出。",
    hint: "在原会话停止并核对实际进程状态；不可并发接管。",
  },
  "BLK-WORKFLOW-UNCERTAIN": {
    message: "步骤的实际执行结果尚不确定。",
    hint: "先核对原执行者、子任务及实际副作用；有停止凭证时使用 workflow reconcile 预检。缺少凭证仍不可恢复，不得自动重放。",
  },
  "BLK-RPA-RECORD-001": {
    message: "录制请求或结果不符合契约。",
    hint: "查看 blocky.rpa-recording-start/v1 和 result/v1 Schema；同一录制必须保留 projectId/sessionId 和目标绑定，不得添加输入正文。",
  },
  "BLK-RPA-RECORD-EMPTY": {
    message: "录制中没有可转换的步骤。",
    hint: "核对省略计数和目标；重新录制可唯一定位的点击或填写操作，或在面板手动添加步骤。",
  },
  "BLK-RPA-BROWSER-MISSING": {
    message: "未找到 Microsoft Edge 浏览器。",
    hint: "安装 Edge 后重新运行；WebView2 Runtime 不能替代完整浏览器。不会自动安装或使用现有个人浏览器会话。",
  },
  "BLK-RPA-RUNTIME-001": {
    message: "浏览器驱动缺失或不完整。",
    hint: "开发环境运行 pnpm build:browser 并重建 CLI/桌面；安装包请恢复随包 browser 目录。",
  },
  "BLK-RPA-RUNTIME-HASH": {
    message: "浏览器驱动未通过完整性校验。",
    hint: "恢复当前版本的完整 browser 目录；不会继续启动不匹配的驱动。",
  },
  "BLK-RPA-BROWSER-001": {
    message: "浏览器操作未完成。",
    hint: "检查网址、唯一定位器和页面状态；当前只允许初始来源，拒绝跨来源资源和所有 HTTP 重定向。核对回执后再安排后续操作。",
  },
  "BLK-FLOW-001": {
    message: "并行分支包含不支持的操作。",
    hint: "分支只允许结果、条件、等待、失败和并行积木；共享状态和外部副作用应放在汇合后的顺序步骤。",
  },
  "BLK-FLOW-002": {
    message: "流程超出并行或等待上限。",
    hint: "嵌套并行最多 4 层，等待为 0–30000 毫秒，汇合结果最多 32768 UTF-8 字节；缩减流程后重新编译。",
  },
  "BLK-FLOW-003": {
    message: "流程主动报告失败。",
    hint: "通过运行轨迹定位报告失败的积木；其余并行分支结束后运行才会失败，后续步骤不会执行。",
  },
  "BLK-EVENT-001": {
    message: "事件通道或等待参数无效。",
    hint: "通道使用稳定标识，等待时间为 0–30000 毫秒；通过 project compile 定位积木。",
  },
  "BLK-EVENT-002": {
    message: "事件队列达到容量上限。",
    hint: "先接收已有消息或减少负载。会话最多 128 条、总计 256 KiB，每条最多 16000 UTF-8 字节；重启会丢弃未处理消息。",
  },
  "BLK-PROFILE-001": {
    message: "独立资料目录无效或无法访问。",
    hint: "BLOCKY_PROFILE_DIR 或桌面 --profile-dir 必须是绝对本地目录，不得含上级跳转、网络路径或目录链接。修正后重新启动；不会回落默认资料目录。",
  },
  "BLK-RPA-LOCATOR-003": {
    message: "定位器匹配多个控件。",
    hint: "补充 automationId、name 或 controlType，使目标唯一；不会自动选择第一个。",
  },
  "BLK-RPA-LOCATOR-004": {
    message: "目标窗口内未找到控件。",
    hint: "检查控件标识、窗口状态和权限；需要等待出现时使用 wait 步骤。",
  },
  "BLK-RPA-TARGET-001": {
    message: "目标窗口已失效或身份发生变化。",
    hint: "重新运行 rpa targets，核对目标后生成新的授权；不要沿用旧窗口句柄。",
  },
  "BLK-RPA-SENSITIVE-001": {
    message: "此操作缺少敏感填写声明，或尝试读取敏感内容。",
    hint: "敏感填写使用 manual-input 与 sensitive:true；普通积木选择 INPUT_KIND=sensitive、SOURCE=manual，并逐步原生确认。读取敏感控件和通用 SecretStore 引用仍拒绝。",
  },
  "BLK-RPA-CAPTURE-001": {
    message: "截图存储无法读取或写入。",
    hint: captureHint,
  },
  "BLK-RPA-CAPTURE-002": { message: "截图标识或内容无效。", hint: captureHint },
  "BLK-RPA-CAPTURE-003": {
    message: "截图尺寸、大小或保留数量超过限制。",
    hint:
      "目标不超过 2048×2048，PNG 不超过 4 MiB，最多保留 32 张。" + captureHint,
  },
  "BLK-RPA-CAPTURE-004": {
    message: "截图已过期。",
    hint: "截图有效期 24 小时；需要新证据时重新授权截图步骤。",
  },
  "BLK-RPA-CAPTURE-005": {
    message: "目标变化或无法可靠遮盖，未保存截图。",
    hint: "选择更小、稳定且可访问的区域；嵌入网页使用隔离浏览器截图。",
  },
  "BLK-RPA-PORT-001": {
    message: "当前运行没有可用的自动化 Host。",
    hint: "CLI 模块自动化必须显式使用 run start --live；simulate 不执行真实桌面操作。原生批准仍按次请求。",
  },
  "BLK-RPA-SCOPE-001": {
    message: "自动化步骤不在有效会话中。",
    hint: "把操作放入连接窗口或打开浏览器的步骤插槽；不要混入另一目标或嵌套控制流。",
  },
  "BLK-RPA-INPUT-002": {
    message: "本次运行缺少手动填写内容。",
    hint: "桌面在运行时输入；CLI 使用 --rpa-inputs，键为 moduleId/blockId。内容不写入项目或轨迹。",
  },
  "BLK-RPA-RECEIPT-002": {
    message: "副作用结果尚未核对，禁止重放。",
    hint: "查看 checkpoint 与目标应用，核对实际结果后再安排新的流程。",
  },
  "BLK-RPA-JOURNAL-001": {
    message: "执行记录无法保存或读取。",
    hint: "保留记录并检查磁盘和当前 Windows 用户权限；使用 rpa checkpoint 查看回执并核对目标应用，不能盲目重放。",
  },
  "BLK-RPA-JOURNAL-002": {
    message: "执行记录与计划不匹配。",
    hint: "使用原计划和正确的 checkpoint-id 查询；修改后的计划不能沿用原执行记录。",
  },
  "BLK-RPA-JOURNAL-003": {
    message: "执行记录正被使用或修订已变化。",
    hint: "结束其他查询后重新读取记录；先核对实际操作结果，不要重新运行未确认的步骤。",
  },
  "BLK-RPA-JOURNAL-004": {
    message: "执行记录达到存储上限。",
    hint: "使用 rpa checkpoints 查询，选取 deletable=true 的记录，以 checkpoint-delete 和当前 revision 显式清理；未知结果不能删除。",
  },
  "BLK-RPA-CLEANUP-001": {
    message: "执行记录尚不具备安全删除条件。",
    hint: "保留未知副作用、未结算或旧格式记录；先在原 Host 停止并确认结算，再退出原 Host 后刷新。",
  },
  "BLK-RPA-CLEANUP-002": {
    message: "执行记录仍可申请恢复。",
    hint: "先核对剩余步骤并完成流程；清理入口保留所有可恢复记录。",
  },
  "BLK-RPA-RECOVERY-001": {
    message: "原执行进程仍在运行，或无法确认其已退出。",
    hint: "在原会话继续或停止；完全退出原 Host 后再请求恢复。旧格式缺少进程身份的记录仅供查看。",
  },
  "BLK-RPA-RECOVERY-002": {
    message: "此执行记录无法继续。",
    hint: "已完成流程无需恢复；存在进程结算失败时先处理结算问题，不能重新发送副作用。",
  },
  "BLK-RPA-RECOVERY-003": {
    message: "恢复条件没有完整覆盖已完成的副作用。",
    hint: "为每个已完成回执提供唯一的 UIA 状态核对条件；用 schema show blocky.rpa-recovery/v1 查看格式。",
  },
  "BLK-RPA-RECOVERY-004": {
    message: "目标当前状态与恢复条件不一致。",
    hint: "核对目标应用的实际业务状态与已完成步骤；未执行剩余步骤，不要盲目重放。",
  },
  "BLK-RPA-SETTLEMENT-001": {
    message: "自动化进程尚未确认全部结算。",
    hint: "保留 uncertain 回执，检查剩余进程；不能将此状态视为已停止或重新运行。",
  },
  "BLK-RPA-UNSUPPORTED-001": {
    message: "本机 Host 尚不支持该 RPA 操作。",
    hint: "支持 UIA 和隔离浏览器的 find/read/click/fill/wait/screenshot；浏览器需 --browser-url/--project-id。坐标回退仅支持显式批准的 click。",
  },
  "BLK-RPA-COORDINATE-001": {
    message: "坐标范围、窗口几何或输入状态不符合本次授权。",
    hint: "Windows 使用屏幕物理像素，运行 rpa targets 核对客户区，松开按键并清除遮挡；浏览器使用页面左上角 CSS 像素。位置、DPI 或视口改变后需重新核对授权；先检查副作用回执，勿盲目重放。",
  },
  "BLK-RPA-COORDINATE-003": {
    message: "系统未确认完整接收坐标点击。",
    hint: "该步骤结果不确定；检查目标和检查点回执，不得自动重试。部分输入只尝试释放本次按下的左键。",
  },
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
