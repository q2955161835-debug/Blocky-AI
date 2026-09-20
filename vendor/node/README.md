# 构建助手 Node 运行库

锁定 Windows x64 Node.js 22.23.1。`scripts/build-builder.mjs` 只接受与官方发布相同哈希的可执行文件，生成随产品分发的固定运行库；不依赖用户全局 Node 来运行构建助手。

- 官方文件：https://nodejs.org/dist/v22.23.1/win-x64/node.exe
- 官方校验表：https://nodejs.org/dist/v22.23.1/SHASUMS256.txt
- node.exe SHA-256：`f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed`
- 许可证来源：https://raw.githubusercontent.com/nodejs/node/v22.23.1/LICENSE
- LICENSE SHA-256：`c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4`

Node permission 限制是纵深防护，不宣称隔离任意恶意 Node 程序。仅运行哈希锁定的构建助手 bundle，模型只产生严格验证的四工具参数。网络请求与密钥由 Rust Host 处理；Job Object 结算本轮进程树。
