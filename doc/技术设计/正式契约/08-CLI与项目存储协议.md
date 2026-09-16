# CLI 与项目存储协议

2026-09-16 用户要求提前同步 CLI；本节为阶段 1 新增协议，不改变阶段 0 已冻结的项目、运行或补丁语义。消费者为 `tools/blocky-cli` 和 `apps/studio-host/src/bin/blocky-project-io.rs`。

## CLI 响应 `blocky.cli/v1`

沿用 [CLI 产品设计](../../产品设计/CLI与官方Agent-Skill.md) 第 6 节。必需字段：`schemaVersion`、`ok`、`command`、`data`、`warnings`、`artifacts`、`nextCursor`。失败时追加 `error: {code,message,path,hint}`，不输出栈或原始输入；当前错误 path 为空，领域 Diagnostic 自带项目内 SourceRef。工件返回文件名、bytes 与 sha256，不默认返回本机绝对路径。

列表默认最多 20 项，`--limit` 上限 100，`--cursor` 为目录偏移。运行必须显式 `--simulate --jsonl`；每行正式 RuntimeEvent，最后一行为 CLI 响应，包含运行状态、引用和 `modelApiCalled:false`。超时/取消不丢弃终态事件。旧读取器忽略新增字段，未知 schemaVersion 拒绝。

CLI 输出边界统一脱敏项目显示文本、诊断、事件和工件名称中的凭据模式与本机绝对路径；发生替换时响应 warnings 明确说明。结构字段和安全引用保留，digest/sha256 始终对应未修改的原始项目语义或文件字节；不能将脱敏后的显示结果当作项目写回。Host 同时拒绝 token、secret 等凭据值字段，secretRef/secretRefs/secretBindings 只保存引用。

## 原生存储 `blocky.project-io/v1alpha1`

CLI 创建受控子进程，经 stdin 发送一个 UTF-8 JSON 请求；stdout 一个 JSON 响应后退出。请求/响应必含 schemaVersion。不使用 TCP、不监听端口、不启动 UI。请求上限 20 MiB，项目展开内容上限 8 MiB/1000 文件，调用上限 30 秒。

请求操作：

- `version`：仅版本字段与 operation，不接受 path/files。
- `read`：增加必需 path，读取调用者明确指定的 `.blocky`；不接受 files。
- `create`：增加 path 和 files（项目相对文件名到 UTF-8 JSON 文本的映射）；目标已存在时原子拒绝，不能覆盖。

path 只存在于本机 CLI→存储的单次 IPC，不返回 UI、日志或项目。CLI 作为当前用户的本机文件工具拥有显式路径输入；桌面 WebView 仍只能调用对话框与不透明句柄，不暴露此 CLI 进程入口。files 经过同一 Rust 项目边界验证及原子持久化。读取拒绝重复 JSON 键、ZIP 路径穿越、符号链接、超限输入、未知版本和未声明文件。

响应共有字段 schemaVersion/ok；成功 version 返回 version，read 返回 files，create 无额外数据；失败只返回稳定 code。程序 exit 0/3 供 CLI 转换为用户退出码。协议不存盘，包含项目事实的 stdin/stdout 不作为日志记录。

迁移：新增接口没有旧磁盘状态；未知版本直接拒绝，不静默降级。正反机器夹具和消费者测试位于 `tests/cli/commands.test.ts`、原生二进制模块测试、`apps/studio-host/src/project_store.rs`。
