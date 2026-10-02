# 内置代码 Agent 与 Host 工具

2026-10-01实现分支：`codex/feat-built-in-code-agent`。这是新桌面代码助手的接口；旧builder/v1仍兼容。当前仅完成Linux开发验证，Windows原生/普通包/完整Full尚未验收。

## 会话与存储

`builder-protocol/src/coding.ts`是共享严格Schema入口。`blocky.coding-start/v1`包含requestId/projectId/moduleId、prompt、originalJson、resourceId、selection、conversation与可选workspaceId；不含操作类型、模拟模式或页面复选框。conversation最多20条、每条16000 UTF-16单位、总64000，包含前轮完成/拒绝/取消状态。start整体最多9MiB UTF-8。

`blocky.coding-chat/v1`按项目保存最多40条角色/正文/状态消息，总64000 UTF-16单位，桌面另限编码96KiB。新旧聊天分开；不持久化目录授权、凭据或可接受项目候选。工作目录由原生选择器授予不透明workspaceId，仅在Host及当前会话内使用。当前提供单项目连续对话与新对话；历史会话管理和附件选择器未实现。

`blocky.coding-event/v1`绑定requestId/projectId与正整数sequence；kind为text.delta、tool.started/completed/failed、file.changed。前端只接受同owner的连续序号，结果中的相同事件重放必须完全相等。切项目、退出或取消后不能应用迟到项目候选。

`blocky.coding-result/v1`包含requestId/projectId/baseDigest、text、changes、events、generations、engine、modelApiCalled，可选正式Project。文本64000 UTF-16单位，changes128、events2048、generations12。模型响应证据区分本地推理与实际外部API，不从回复文字推断调用事实。

## Pi 与模型桥接

Pi Agent 0.86.0最多12次模型请求，总300000ms；纯文本可以结束，不强制draft/patch。worker只导入受审计Pi内核与共享领域模块，不直接导入文件系统、进程或Provider SDK。Host持有模型凭据，使用声明tools能力的已配置模型与auto tool choice；不存在静默模拟兜底。

`blocky.coding-ipc/v1`以requestId绑定start/provider.call/result/error、tool.call/result、event、complete/error/cancel；工具另带唯一callId。全部消息有界严格校验，Host执行工具并生成真实变更回执，模型不能伪造file.changed。取消须等当前操作与进程结算；写入前在同一状态锁内重查取消，已完成写入保留回执。

## 七个工具

| 工具 | 行为 |
|---|---|
| workspace_list | 范围内有界相对路径列表 |
| workspace_search | 文本检索，返回相对路径/行号/片段 |
| workspace_read | 读取有界UTF-8文本与SHA256版本 |
| workspace_write | 创建或摘要匹配替换，返回前后内容/摘要 |
| workspace_undo | 当前摘要匹配后撤回真实修改，产生逆向回执 |
| blocky_cli | 用参数数组执行锁定CLI bundle，返回真实退出码和结构化输出 |
| project_context | 当前隔离项目候选、模块与选区；实际诊断通过CLI compile |

工具参数Schema位于builder-engine/src/coding-tool-schemas.json，Pi与Rust共同消费。文件上限1MiB UTF-8；拒绝路径穿越、链接/重解析点、硬链接、二进制、秘密文件、敏感内容与直接编辑.blocky。Windows目录授权打开用户实际选择路径的no-follow句柄并读取最终路径；目录句柄禁止共享删除，子项打开/创建/枚举/发布锚定实际父目录句柄，禁止按绝对路径重新遍历；即使已授权目录被原地设置重解析点，也不能访问另一目录。普通文件句柄禁止共享写入/删除，保留版本与硬链接校验。Windows句柄操作独立在coding/files/windows.rs，不为此新增依赖。

原子文件发布先写入并sync私有临时文件，版本匹配后将原文件移到私有备份，再禁止覆盖地发布；失败恢复原件，恢复被外部名称占用时保留可恢复备份与真实失败回执。`CodingChange`含changeId/path/before/after/beforeDigest/afterDigest；撤回附可选revertsChangeId，原回执失效、逆向回执可继续按版本撤回。部分发布恢复的回执可选invalidatesChangeId，原回执标记失效而非已撤回；撤回失败同样读取Host真实journal。Host总回执最多512条/64MiB序列化JSON，写/撤回前预留最坏字符转义空间，满时只压缩已失效记录、保留仍可操作记录。coding_changes查询最多512条；单Agent结果changes仍限128。

## CLI 与项目候选

`coding run`使用同一Host/Pi，`--workspace`必须在本次helper原生选择目录。`blocky_cli`禁止Shell和递归builder/coding/provider/秘密/RPA实跑，只开放version、command/catalog/template/schema发现、project inspect/validate/compile/map/configure/edit、surface list、run preflight和patch preview/apply。

`$project`替换为Host保存的隔离未保存项目，写出新修订后验证项目ID与正式格式。`$json:<JSON>`只用于patch/operations的有界临时工件；普通相对JSON输入必须经已授权文件工具读取。CLI argv、路径位置、输出位置与stdout/stderr均有界，独立Job结束后等进程结算。

CLI的`--blocky-coding-run`helper读首帧任务，后续控制帧/EOF协作取消；调用者等待真实进程close，不在原子文件发布中kill helper。失败/取消返回严格`blocky.coding-failure/v1`：requestId/projectId/baseDigest、code、changes、modelApiCalled；绑定与实际错误退出保留。输出工件发布失败仍在CLI JSON中保留真实回执，返回非成功；文本脱敏可能改变文件内容时附带原JSON的Base64块数组（每块12000字符）及SHA256以准确恢复，不受普通输出的16000字节字符串截断影响。

Host校验`blocky.cli-runtime/v1`的bundle字节数/SHA256。构建先生成runtime-worker和CLI锁定bundle，再编译内嵌锁的原生helper/Host；dev/build/native-test/release按发行布局放置CLI与原生依赖。

桌面返回项目候选保持未应用；显示实际项目文件差异与新增能力，接受后再次由`coding_validate_project`核验任务绑定、项目基线、权限与正式格式，controller.edit一次事务保证可撤销。执行期间画布变化则拒绝旧候选；保存仍由用户显式进行。

Tauri入口：coding_workspace_pick、coding_run（Channel事件）、coding_cancel、coding_undo、coding_changes（失败/取消回执）、coding_validate_project。真正退出需settle活动任务与本地撤回/应用事务，再刷新聊天。

## 验证边界

Linux共享/组件测试、真实临时文本文件Rust测试、跨目标测试编译与Chromium实际渲染均为开发证据。便携Rust测试夹具替代了Provider、项目存储与Job集成，不是生产Windows构建。Windows目录/重解析竞态、原生模型批准、实际CLI构建与取消、普通包文件读写/画布保存重开、原生E2E、敏感扫描及360×5秒/30次真实重载Full须在Windows完成；当前0.8.0普通包与固定桌面入口保持原验收来源。
