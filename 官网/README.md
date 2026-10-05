# Blocky 官网

公开地址：[blocky.donk55666.chatgpt.site](https://blocky.donk55666.chatgpt.site)

定价页候选位于 `#/pricing`：个人客户端免费，托管 Token 服务采用拟定月度积分套餐，机构服务单独报价。方案及来源见根目录 `doc/产品设计/2026-10-05-官网定价拟案.md`。本轮开发检查已完成，独立验收范围待确认、尚未发布；当前公开版本仍为下方版本11。

当前公开版本11采用用户选中的第2版豆形眼表情；造型参考`art/references/face-options-2026-10-05/02-soft-beans.png`，实时建模入口`art/expressions.js`。四角色以好奇、笑眼、专注和眨眼区分；独立验收见根目录`doc/验收/网站/验收-2026-10-05-Blocky豆形表情.md`。

官网按完整产品愿景讲述教育与专业场景，具体开放进度见05开放方式与06 FAQ。主页黄绿色、教育暖琥珀、专业冷蓝；固定胶囊导航保留唯一在线体验入口。首屏居中文字与彩色3D积木角色环绕，蓝图四宫格角色跟随鼠标；品牌从初始原2D Logo连续转为左上圆环3D角色。

官网和在线体验支持中文/English及深色/浅色。首次访问，两项均跟随系统；手动选择后保留偏好，也可恢复“跟随系统”。系统语言以浏览器提供的首选系统语言为准，中文使用中文，其余使用英文；系统外观变化会立即同步。切换保留当前锚点与演示编辑内容。只有两项显示偏好写入 localStorage，演示内容不持久化。

## 文件与运行

- `dist/index.html`、`content.js`、`scenes.js`：官网内容。
- `dist/styles.css`、`scenes.css`、`navigation.css`：官网样式与固定页头。
- `dist/main.js`、`demo.js`：首页及 `#/studio` 路由、隔离演示 iframe。
- `dist/pricing-data.js`、`pricing.js`、`pricing.css`：套餐数据、双语定价页与响应式样式；咨询为预填邮件链接，不收集资料或执行支付。
- `dist/preferences-boot.js`、`preferences.js`、`preferences.css`：首次外观、共享偏好及紧凑切换控件；`translations.js`、`ui-translations.js` 为两类文案字典，`appearance.css` 为官网浅色与英文排版适配。
- `experience/`：在线体验 React 源码。直接复用桌面 Canvas、MenuBar、CommandIcon、ResizeHandle、ChatControls，以及真实积木目录、四类蓝图、产品 CSS；演示壳与预设聊天拆分管理。
- `build-experience.mjs`：用根目录既有 esbuild 构建 `dist/studio/`，输出哈希资源与第三方许可证。构建拒绝包含桌面 composition、Tauri Host 或 worker；不新增依赖。
- `.openai/hosting.json`：Sites 站点身份和静态目录配置。
- `art/`：独立Three.js依赖与程序化几何；角色、积木、教育/专业世界、镜头与共享渲染器分模块。`art/references/`保存ImageGen建模参考，不进入发布包。
- `art/expressions.js`、`character-accessories.js`：浅弧嘴与六种表情、四蓝图连贯配件；场景人物带接地脚部。`campus-buildings.js`、`district-buildings.js`按功能建筑建立固定地坪和连续结构；`world-camera.js`沿外部球面轨道插值位置与朝向，按当前建筑几何轮廓和可用画面取景。
- `build-art.mjs`：通过根esbuild生成公开`dist/art3d.js`及Three.js许可证。无远程模型、贴图、运行时CDN或真实模型连接。
- `dist/world-pages.js`：`#/education`积木校园与`#/professional`创作园区。正常滚动驱动转向及远近镜头，章节按钮定位；“阅读全部”、减少动态效果或3D失败时按普通文档阅读原全部正文。
- `dist/brand-motion.js`、`active-navigation.js`、`content-motion.js`与`capsule.css`/`art.css`/`worlds.css`：品牌迁移与圆环、活动导航画线/擦除、内容入场及3D版式。

根目录执行 `node 官网/build-experience.mjs` 构建演示；`node node_modules/typescript/bin/tsc --project 官网/tsconfig.json --noEmit` 检查类型。执行 `node 官网/preview.mjs` 预览 `http://127.0.0.1:4177/`。

3D环境首次安装：`pnpm --dir 官网/art install --ignore-workspace --frozen-lockfile`；改动`art/`后运行`node 官网/build-art.mjs`。`dist/`为受Git管理的发布目录，包含手写官网、生成的`studio/`及`art3d.js`，不要整体清空。演示改动后须重新构建；手写官网内容无需构建。

## 界面依据与演示边界

当前普通包 `Blocky-Studio-0.8.0-budgets` 是界面基准。对应桌面源码的 `app/App.tsx`、`Library.tsx`、`StudioSidebar.tsx`、`BuilderPanel.tsx` 提供壳布局依据，实际画布与积木定义直接导入复用。灰蓝配色、单行图标栏、七/十二分类、嵌套积木、可调宽度三栏、默认收起底栏、右侧聊天均按此基准。

网站额外提供一条体验说明/返回官网栏；窄屏以积木库、画布、对话切换访问同一工作区。对话、轨迹和运行结果为预设；文件、模型和部署入口仅说明桌面版能力，不操作本机文件。输入只存在当前 iframe 内存，离开后销毁。CSP 禁止 connect-src、media、表单提交，不加载运行内核或真实模型配置。

## 发布与核对

在线体验另有“工作助手 · 1分钟演示”：固定提示词→逐步搭建真实蓝图结构→自动切换Agent→预设读取/计算/生成/读回周报，60秒结束。所有工具轨迹及文件结果均为合成示例，不产生外部副作用。剧情和调度拆分在 `experience/guided-demo/`，中英文本在 `dist/demo-translations.js`；播放支持暂停、退出恢复原项目、重播及完成后继续编辑。计时不受语言/主题切换重置。

使用 Sites 原生工作流，只发布 `dist/` 和托管清单。Sites 独立源码仓库不包含 Blocky 私有 Git 历史；根 GitHub 合并/推送另行处理。验收与回执见 `doc/验收/网站/`。当前组件复用避免再次手绘积木；网站适配壳仍需随桌面主要布局变化维护。
