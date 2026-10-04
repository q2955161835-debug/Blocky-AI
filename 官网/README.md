# Blocky 官网

公开地址：[blocky.donk55666.chatgpt.site](https://blocky.donk55666.chatgpt.site)

官网按完整产品愿景讲述教育与专业场景，具体开放进度集中在 FAQ。主页黄绿色、教育暖琥珀、专业冷蓝；导航栏保留唯一在线体验入口。

## 文件与运行

- `dist/index.html`：页面、首屏和工作台视觉预览。
- `dist/content.js`：核心能力、蓝图、创作步骤、服务说明与 FAQ。
- `dist/scenes.js` / `dist/scenes.css`：教育和专业场景。
- `dist/demo.js`：四蓝图、积木、对话与运行轨迹的预设 UI 演示。
- `dist/main.js`：首页与 `#/studio` 路由；`dist/styles.css` 为共享样式。
- `dist/assets/blocky.png`：既有官方 Logo。
- `.openai/hosting.json`：Sites 站点身份和静态目录配置。

从项目根目录运行 `node 官网/preview.mjs`，打开 `http://127.0.0.1:4177/`。无需安装新依赖，退出进程即可停止预览。`dist/` 为正式手写源文件，已纳入 Git，不是可随意清理的构建缓存。

## 发布与核对

使用 Sites 原生工作流，只以本站公开静态文件和站点清单组成发布包。上传源使用独立的 Sites 源仓库，不同步 Blocky 私有工程历史；根目录 GitHub 提交和推送另行处理。发布回执及独立验收见根目录 `doc/验收/网站/验收-2026-10-04-Blocky官网.md` 和 `Blocky官网证据/`。

在线体验没有真实模型、文件或持久数据接口；输入只用于本页 UI 展示。它与桌面运行内核分离，不代表真实 Agent 执行结果。
