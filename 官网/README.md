# Blocky 官网

公开地址：[blocky.donk55666.chatgpt.site](https://blocky.donk55666.chatgpt.site)

官网按完整产品愿景讲述教育与专业场景，具体开放进度集中 FAQ。主页黄绿色、教育暖琥珀、专业冷蓝；固定导航保留唯一在线体验入口。

官网和在线体验支持中文/English及深色/浅色。首次访问，两项均跟随系统；手动选择后保留偏好，也可恢复“跟随系统”。系统语言以浏览器提供的首选系统语言为准，中文使用中文，其余使用英文；系统外观变化会立即同步。切换保留当前锚点与演示编辑内容。只有两项显示偏好写入 localStorage，演示内容不持久化。

## 文件与运行

- `dist/index.html`、`content.js`、`scenes.js`：官网内容。
- `dist/styles.css`、`scenes.css`、`navigation.css`：官网样式与固定页头。
- `dist/main.js`、`demo.js`：首页及 `#/studio` 路由、隔离演示 iframe。
- `dist/preferences-boot.js`、`preferences.js`、`preferences.css`：首次外观、共享偏好及紧凑切换控件；`translations.js`、`ui-translations.js` 为两类文案字典，`appearance.css` 为官网浅色与英文排版适配。
- `experience/`：在线体验 React 源码。直接复用桌面 Canvas、MenuBar、CommandIcon、ResizeHandle、ChatControls，以及真实积木目录、四类蓝图、产品 CSS；演示壳与预设聊天拆分管理。
- `build-experience.mjs`：用根目录既有 esbuild 构建 `dist/studio/`，输出哈希资源与第三方许可证。构建拒绝包含桌面 composition、Tauri Host 或 worker；不新增依赖。
- `.openai/hosting.json`：Sites 站点身份和静态目录配置。

根目录执行 `node 官网/build-experience.mjs` 构建演示；`node node_modules/typescript/bin/tsc --project 官网/tsconfig.json --noEmit` 检查类型。执行 `node 官网/preview.mjs` 预览 `http://127.0.0.1:4177/`。

`dist/` 为受 Git 管理的发布目录，包含手写官网和生成的 `studio/`，不要整体清空。演示改动后必须重新构建；官网主页无需构建。

## 界面依据与演示边界

当前普通包 `Blocky-Studio-0.8.0-budgets` 是界面基准。对应桌面源码的 `app/App.tsx`、`Library.tsx`、`StudioSidebar.tsx`、`BuilderPanel.tsx` 提供壳布局依据，实际画布与积木定义直接导入复用。灰蓝配色、单行图标栏、七/十二分类、嵌套积木、可调宽度三栏、默认收起底栏、右侧聊天均按此基准。

网站额外提供一条体验说明/返回官网栏；窄屏以积木库、画布、对话切换访问同一工作区。对话、轨迹和运行结果为预设；文件、模型和部署入口仅说明桌面版能力，不操作本机文件。输入只存在当前 iframe 内存，离开后销毁。CSP 禁止 connect-src、media、表单提交，不加载运行内核或真实模型配置。

## 发布与核对

使用 Sites 原生工作流，只发布 `dist/` 和托管清单。Sites 独立源码仓库不包含 Blocky 私有 Git 历史；根 GitHub 合并/推送另行处理。验收与回执见 `doc/验收/网站/`。当前组件复用避免再次手绘积木；网站适配壳仍需随桌面主要布局变化维护。
