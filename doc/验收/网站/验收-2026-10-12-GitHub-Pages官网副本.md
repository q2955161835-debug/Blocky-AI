# GitHub Pages 官网副本独立最终验收

- 验收人：独立子 Agent `accept_github_pages_copy`，未参与发布、源码或部署实现。
- 本地执行时段：首轮2026-10-12 02:53 ~ 2026-10-12 02:59；第二轮文本证据采集/独立裁决2026-10-12 03:11 ~ 2026-10-12 03:12。
- 验收等级：L2；涉及模块：GitHub Pages 项目子路径、官网 hash 子页、Studio iframe、预设演示入口、语言/主题及窄屏导航。
- 对象：https://q2955161835-debug.github.io/Blocky-AI/ ，长期托管分支 `gh-pages`，最终提交 `23b9e3ba5ef01b3e93559f776c032ba399b5eb92`；首轮提交 `c88696b5207097c639e095d1fc875a3cc6be750a`。
- 方式：真实 Codex IAB 浏览器 DOM、语义控件点击、截图及控制台读取。默认桌面截图实际为官网1265×712、Studio1280×720；手机测试实际使用 viewport API 设置390×844，DOM读取innerWidth=390/innerHeight=844，官网菜单截图内容宽375、Studio截图390×844，结束后已 reset。
- 来源边界：主 Agent 的[发布回执](GitHub-Pages证据/发布回执.json)记录首轮 Pages built/Actions `38165794906`成功，最终提交对应Actions `38166518776`成功、Pages built、52份HTTP200/5,737,992原始字节逐SHA256一致。最终只改变content.js/translations.js两文本资产，其余50份（含全部Studio/3D/CSS/行为）Git blob保持首轮字节；G01–G03对未变范围精确复用首轮亲自操作证据。第二轮两文本浏览器DOM/截图由root采集，本独立Agent只读取原始JSON和两图裁决，不冒充独立操作。本验收不重复资产下载或CI核对。

## 汇总表格

| 编号 | 用户功能 / 场景 | 结果 | 证据 |
| --- | --- | --- | --- |
| G01 | 浏览官网 / 项目子路径及教育、专业、定价进入返回 | 通过 | browser-evidence.json 的 home、education、professional、pricing 及对应 return；01–04截图 |
| G02 | 在线体验 / iframe、真实积木、两助手与两种演示开始退出 | 通过 | studio-entry/canvas/agent、actual-block-added、两 demo start-paused/exit；05–07、12截图 |
| G03 | 阅读与进入体验 / 中英、深浅、390像素导航及CSP隔离 | 通过 | english/light、mobile-menu/nav-result/studio、csp；08–11截图 |
| T01 | 获取源码 / 最终两文本中英公开状态、许可证边界及链接 | 通过 | root原始采集final-text-evidence.json、13–14截图；独立Agent二次裁决 |

## 详细报告

### 浏览官网

#### G01 项目子路径和子页返回

首屏标题“让想法，一块块成真。”、3D品牌形象及完整导航实际渲染，无空白或错误覆盖。点击“进入积木校园”到 `/Blocky-AI/#/education`，实际显示“校园全景”、学习路径和五章节；点击“返回官网”恢复首页。随后从首页进入创作园区，地址为 `/Blocky-AI/#/professional`，显示“园区全景”、专业创作生命周期和五章节，返回恢复首页。点击“查看完整套餐”进入 `/Blocky-AI/#/pricing`，显示定价标题、免费软件及三档咨询套餐，再返回首页。所有目标保留项目根子路径。

### 在线体验

#### G02 iframe、两助手和演示入口

从“在线体验”进入 `/Blocky-AI/#/studio`，iframe 实际地址为 `https://q2955161835-debug.github.io/Blocky-AI/studio/index.html`。欢迎页、四蓝图、两个演示入口及返回官网可用。创建空白项目后看到 Blockly Blocks 工作区、两助手 tab 和构建输入区；切换 Blocky Agent 出现对应面板。再从积木库点击“收到问题 ＋”，真实画布出现选中积木，画布大纲由0变1，运行按钮可用，证明不是静态截图替代画布。

一分钟演示点击后出现“构建工作助手”、01:00控制区及工作助手项目；暂停和退出实际执行，退出恢复原可编辑项目与两个演示入口。三分钟演示启动后出现“从零开始”、03:00控制区、五演示章节及固定构建需求，暂停截图在00:07，退出同样恢复入口。本轮只检查新host路径、起始阶段和退出恢复，不把这次短测表述为重新完整播放60秒/180秒或真实模型验收。

### 阅读与进入体验

#### G03 中英、深浅、窄屏及预设隔离

官网从系统中文切到 English 后，标题、Features/Blueprints/Education/Professionals/Pricing和Try Blocky同步变为英文；选Light后浅色渲染可见。设置390×844实际视口，Open navigation可展开全部主要目标，点击Blueprints跳到 `#blueprints`，随后Try Blocky进入Studio。iframe欢迎页、两演示入口同步英文；在iframe切简体中文和深色，实际变为中文深色，返回官网仍可用。默认桌面初始深色及英文浅色、手机中文深色均有截图。

通过iframe DOM读取到有效 CSP meta：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`。本轮浏览器记录的 error/warn 为零。CSP结论限于实际加载的Studio预设资源与声明，不外推桌面Host、真实网络调用或渗透测试。

### 问题与风险

- 首轮发现的“当前个人版开源仓库尚未公开”陈旧文案已在第二轮解决，见T01。首轮历史证据不删改，不再作为最终文本状态。
- 390像素Studio欢迎页保留横向滚动，右侧蓝图区域部分位于视口外；欢迎页主要创建、两演示入口、语言/外观及返回控件可达。本结论不表示整个Studio工作台完成手机适配，也不扩大本轮托管副本范围。
- 初次 `visible:true` 在子Agent被工具明确拒绝，改用隐藏IAB成功；未使用Windows原生控制、未安装/下载浏览器依赖。一次未支持的heading level过滤导致locator歧义，改读DOM并使用确切名称后正常，非产品错误。
- 证据只包含公开页面与预设内容，没有读取其他用户标签。工具未返回新增C盘缓存文件路径；Agent主动保存文件全部在工作区内。

### 获取源码

#### T01 最终中英状态与源码链接定向复核

root在新部署实际页面 `https://q2955161835-debug.github.io/Blocky-AI/?verify=23b9e3b` 采集中文、英文DOM可见文字、展开FAQ AX与截图。本独立Agent读取JSON并亲自审阅13/14两张图：中文开放说明和展开FAQ均写明源码仓库已公开、开源许可证尚待确定；英文两处均为repository is now public及license still to be selected，未宣称已选许可证。中文“查看源码仓库”和英文“View source repository”的实际href均为 `https://github.com/q2955161835-debug/Blocky-AI`；可见文字未出现原仓库未公开声明。截图FAQ与DOM对应，故定向复核通过。未重新执行G01–G03、完整长演示或手机全流程。

第二轮独立子Agent连接曾不可用：原IAB与新tab均报Browser unavailable，listBrowsers返回空数组；root重新建IAB后子Agent重新绑定和重置仍不可用。按明确分工由root采集、独立Agent裁决，工具连接异常不当作产品失败。root采集一次summary定位错误后按实际summary成功，非产品异常。

### 证据位置

浏览器原始DOM/URL/控件下一状态及CSP最终整理位置：`D:\1Folder\Blocky-AI\try\待清理\GitHub-Pages-2026-10-12\浏览器验收\browser-evidence.json`。首轮12张JPEG与JSON共13文件、867,885字节；第二轮新增 `final-text-evidence.json`、`13-final-chinese-source.jpg`、`14-final-english-source.jpg`。首屏 `01-home.jpg`、实际积木 `12-block-added.jpg`、手机中文深色 `11-mobile-chinese-dark.jpg` 可供复核。验收执行时先保存在同项目 `try\GitHub-Pages-2026-10-12\浏览器验收`，root负责整体可逆整理到上述最终路径；过程文件未删除，正式发布来源另见上方回执。

## 最终结论

通过

结论绑定最终提交23b9e3b：两文本采用第二轮独立证据裁决，未变50资源采用首轮c88696b的G01–G03精确范围复用。不改变原Sites发布结论，不代表新桌面包、真实模型或完整长演示重新验收。
