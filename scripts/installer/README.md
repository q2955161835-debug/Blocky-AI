# Windows 测试版安装器

本目录只把已经验过的普通包封装为每用户 NSIS 安装器，不构建产品、不修改版本或关联文件类型。

在仓库根目录运行（Windows、已安装 NSIS）：

```powershell
node scripts/build-installer.mjs --package dist/已验普通包 --manifest doc/验收/已验包清单.json --output dist/Blocky-Studio-0.8.0-beta.1-setup.exe --display-name 'Blocky Studio（测试版）0.8.0-beta.1' --release-version 0.8.0-beta.1
node --test scripts/installer/build-installer.test.mjs
```

输入清单须包含相对于仓库的 `directory` 和 `files` 数组，每条文件记录为 `path`（包内正斜线相对路径）、`bytes`、`sha256`。脚本逐文件检查编译前后的 SHA256、实际文件集合、符号链接/硬链接和 Windows 路径规则；已有输出文件不会覆盖。可用 `--makensis` 指定编译器，否则复用本机 Tauri 缓存或已安装的 NSIS，不下载工具。

`--release-version` 只设置安装器显示版本、卸载项及内置清单，须与根产品版本的数字部分一致，缺省使用产品版本；不会改 package.json 或锁文件。Windows 数字文件版本仍是 `0.8.0.0`，字符串显示可以是 `0.8.0-beta.1`。

安装默认位于当前用户的 `%LOCALAPPDATA%\Programs\Blocky Studio Beta`，桌面和开始菜单使用独立的“Blocky Studio（测试版）”名称，HKCU 卸载键为 `BlockyStudioBeta`。已有测试版须先卸载，安装目标必须为空目录。缺少 WebView2 或包实际 PE 导入所需的 VC x64 运行库时，安装前提示官方手动安装地址；不静默安装依赖。

卸载文件名单编译在安装器内，只删除包清单中的文件及安装器自己的清单、卸载程序和测试版快捷方式；仅移除空目录，不递归删除未知文件，不访问作品或用户配置目录。用户新增的文件会留下其所在目录。

构建回执写入输出旁的 `.build.json`，临时编译输入和日志位于 `try/installer-2026-10-09/build-*`。编译成功和脚本测试不代表真实安装、启动或卸载验收；发布前应另外验证正常安装/启动、缺依赖提示、已有版本隔离、未知文件保留、作品/配置保留及卸载后的快捷方式和 HKCU 注册项。
