# 后台 UI 开发与验收入口

用户于2026-10-01要求验收不影响前台工作。开发驱动通过Windows独立desktop运行自有Blocky或测试runner；不调用SwitchDesktop、系统SendInput、剪贴板或前台激活。它只隔离显示与输入，不是用户文件或账号安全沙箱，也不修改Host权限、审批、窗口可见/最小化规则。

## 驱动与数据边界

- `scripts/run-background-desktop.ps1`创建唯一测试desktop及kill-on-close Job，先suspended启动、绑定Job后Resume。应用、controller及其后代随Job结算；每秒记录前台是否属于测试Job，用户可正常切换自己的窗口。
- `scripts/BackgroundDesktop.cs`提供Win32生命周期、Job进程归属及Windows参数引用。测试程序通过STARTUPINFO.lpDesktop分配桌面；不切换当前输入桌面。
- 可选controller通过只绑定loopback且由Job拥有的WebView2 CDP获取普通WebView截图与控件交互。CDP仅通过本次子进程环境设置，无注册表或普通产品选项改动。普通包仍不包含测试钩子。
- `scripts/background-native-dialog.ps1`必须作为同desktop子进程执行，验证本次启动PID及desktop后处理唯一自有原生文件对话框；用明确控件定位和后台绘制，不捕捉桌面像素。缺失或多义控件、空白图像、密码控件必须失败，不能猜测或回退系统鼠标。
- 所有profile、TEMP、截图和回执在项目`try/`；不复制用户资料。WindowsPowerShell、.NET/UI Automation和Edge使用本机已有运行时，不新增全局依赖。

## 使用约定

原生驱动支持inspect/capture/set-value/invoke/file-select/file-cancel，以及类型化approve/reject。审批仅支持media-store与local-capability：固定标题/公开正文/根直属Button6/7严格匹配并在点击前重新读取；local-capability必须绑定ExpectedProjectId与ExpectedSessionId及30分钟期限，不能提供通用标题/控件/Value。原生UIA观察缺失模式时只按已观测Win32树操作，不能跳过真实产品审批。file-select通过FileKind明确限定类型：project为.blocky，media为.png/.jpg/.jpeg/.webp/.wav，knowledge为.txt/.pdf/.docx/.md；均只接受项目try下的绝对本地盘路径。媒体和知识必须已存在且只允许打开，project打开必须存在、保存必须不存在；祖先reparse、覆盖保存和凭据控件均排除。WindowsPowerShell 5子进程须继承launcher桌面；后台UIA缺失模式时，文件选择只按本机观测到的两种Win32控件树定位，不使用全局输入。

launcher必填Application和RunDirectory，支持Arguments、TimeoutSeconds、ChildEnvironment、ControllerScript和CdpPort。RunDirectory限定在仓库try下，不能覆盖已有background-result.json。

```powershell
# GUI controller参数依次为port、RunDirectory，脚本必须属于本项目。
& ./scripts/run-background-desktop.ps1 `
  -Application './dist/Blocky-Studio-0.8.0-candidate2/Blocky Studio.exe' `
  -RunDirectory 'try/agent-capability-upgrade/background-ui/new-gui-run' `
  -ControllerScript './try/agent-capability-upgrade/background-ui/capture.mjs' `
  -CdpPort 19389 -TimeoutSeconds 120

# 原生suite可由独立PowerShell runner调用原check-native-core.ps1，
# 将此runner整体启动到隔离desktop，正常后代继承该desktop。
# runner须自行保存命令日志/退出码；不能缩短Full的360×5秒和30次重载。
```

`background-start.json`绑定本次PID、desktop和应用；`background-observations.jsonl`记录Job归属检查；`background-result.json`记录自然退出、controller/runner退出码及Job、线程、进程、desktop和CDP结算。`applicationExitedNaturally=false`表示launcher通过Job收尾，不能据此签普通产品正常退出通过。普通退出需controller先执行真实退出流程，再核验自然退出及副进程结算。

源码headless网页检查只证明渲染或布局；普通包GUI须连接实际普通tauri.localhost WebView。原生文件/审批证据须来自真实Windows对话框，不能由设置项目文件或直接调用业务API代替。Core/Full测试构建与普通包GUI来源分别记录。

## 已有开发证据与剩余验证

首轮普通candidate1已实际通过独立desktop启动、自有WebView截图、loopback所有权及Job/句柄结算；正式launcher的smoke2通过。原生打开、另存为取消及新文件保存已在普通candidate1后台实测，旧项目显示三画布，保存文件2735字节且ZIP六条目有效；新候选GUI及Full仍由独立Agent签发，不外推本开发探针。精确证据在`try/agent-capability-upgrade/background-ui/`及当日进展记录；这些探针没有外部大模型API请求。

依据：[CreateDesktopW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw)、[线程desktop绑定](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop)、[WebView2调试环境](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code)。子进程继承行为和普通包可绘制性仍以本机实测为准。
