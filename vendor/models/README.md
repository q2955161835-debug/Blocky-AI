# 本地知识模型与运行库

`registry.json` 是构建资产锁；模型和 DLL 均不进入 Git。`node scripts/prepare-knowledge-model.mjs` 仅下载缺失资产，按锁定字节数和 SHA-256 校验，再原子重命名。已有损坏文件报错，不自动覆盖。产物位于 `try/stage3/models/multilingual-e5-small/`。

模型来自 Xenova/multilingual-e5-small 的锁定 commit，转换模型卡明确指向 intfloat/multilingual-e5-small；后者锁定模型卡含 `license: mit`。Xenova 卡没有独立许可证声明，不能把它描述成另有一份授权。保留这条派生关系及 Microsoft UniLM 不可变 commit 的 MIT 许可证全文。上游卡哈希及来源见 registry；`Xenova-CARD.md` 为原文副本。

DirectML 1.15.4 来自 Microsoft 官方 NuGet 包，DLL、包和包内许可均有哈希。其许可证允许随 Windows/Xbox 机器学习应用分发。项目将 x64 DLL 放在 Studio 和原生 CLI 可执行文件旁；ORT 静态链接，无需另附 onnxruntime.dll。ONNX Runtime 1.28.0 的 MIT 和第三方告知来自锁定上游 commit；ort-sys 分发 URL/校验值同时锁定。

Microsoft Visual C++ 2015–2022 x64 Runtime（14.44 或更新版本）为系统前提，不随产品分发。微软再分发清单限制分发者资格；仅发现本机 Build Tools 安装不足以证明该资格。构建脚本检查必需系统 DLL，发行使用说明提供官方安装入口。`LICENSE.VC-Runtime.txt` 仅由微软官方 docx 按段落提取文本，来源 URL 和文本哈希在 registry 中，不能替代分发授权。

`prepare-native-runtime.mjs` 优先读已存在的 ort-sys 缓存并独立验证 DLL，否则下载锁定的官方 NuGet 包，仅提取固定 x64 DLL 条目。下载和提取写入项目 `try/stage3/runtime/`。工具既有外部缓存为 `%LOCALAPPDATA%/ort.pyke.io/dfbin/`；此脚本只读该缓存。模型与 DLL 进入发行扫描；上游 tokenizer 字典包含普通单词（例如 webdriver），因此对严格哈希锁定的供应商资产不执行应用测试钩子字串规则，路径和秘密模式扫描仍执行。
