# 本地音频转写物料

`runtime-lock.json` 锁定官方 Windows x64 CPU Whisper CLI v1.8.2 和多语言 tiny 模型。较新的 v1.9.4 release 在本次检查时无附带二进制，故使用有官方 x64 asset 的 v1.8.2。没有下载 server、stream、SDL 或 CUDA 物料；不创建监听端口。

来源与许可证：

- [whisper.cpp v1.8.2 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.2)，源码 `4979e04f5dcaccb36057e059bbaed8a2f5288315`；archive SHA256 来自 GitHub release API digest，解包的五个文件分别锁定本次读回 SHA256。
- [官方用法](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/README.md)与 [CLI 源码](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/examples/cli/cli.cpp)。CPU 运行使用 `-ng`；`-oj` 写 JSON，`-of` 指定不含扩展名的输出前缀。
- [ggml-tiny.bin](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin)，固定 revision，77,691,713 字节；SHA256 为 Hugging Face LFS `oid` 并经下载后独立核验。
- whisper.cpp MIT 许可证保留于 `LICENSE.whisper.cpp`；Whisper 权重 MIT 许可证保留于 `LICENSE.Whisper`，来源 [OpenAI Whisper LICENSE](https://github.com/openai/whisper/blob/6e3be77e1a105e59086e3e21ff5f609fd6fa89a5/LICENSE)。HF 模型卡也声明 MIT。

准备：`node scripts/prepare-audio-runtime.mjs`。安装到项目内指定父目录：`node scripts/install-audio-runtime.mjs <target>`。两者复用现有项目目录/链接检查及有界 SHA256 下载器，至多三次完整重试、每次十分钟，损坏物料明确拒绝。所有物料在 Git 忽略的 `try/agent-capability-upgrade/audio-assets/` 内；正式源码只保存锁文件、许可证和脚本。

布局为 `audio-runtime/{whisper-cli.exe,whisper.dll,ggml.dll,ggml-base.dll,ggml-cpu.dll,ggml-tiny.bin,licenses/LICENSE.whisper.cpp,licenses/LICENSE.Whisper,runtime-lock.json}`。八个 payload 文件总计 79,858,590 字节；Microsoft C++ runtime 的系统/产品依赖由现有 Windows 包负责，不能从本机运行成功外推全新 Windows 系统已安装。

Host 推荐参数：`-m <trustedModelPath> -f <trustedMediaPath> -l auto -t 4 -ng -oj -of <trustedOutputPrefix>`。参数应分开传递，禁止 shell 拼接。最小契约先固定 PCM WAV、单声道、16 kHz、16 bit；CLI 帮助另外列出 flac/mp3/ogg，但本轮没有验证这些格式，不能宣称通过。JSON `transcription[].offsets` 为毫秒区间，`result.language` 为检测语言；JSON 包含本机模型路径，产品应仅投影语义字段而非直接回传原文件。

tiny 支持多语言，但体积和速度优先，不能承诺中文/噪声/长音频准确率。不存在外部大模型 API 调用。Host 必须在受控作业中启动进程，超时/取消时终止该进程并等待退出，随后清理不完整输出；不要将一次性的 whisper-cli 当常驻服务。不启用提示词、translate、调试音频导出、外部 URL 或任意模型路径。
