# Windows 测试版安装器

本目录只把已经验过的普通包封装为每用户 NSIS 安装器，不构建产品、不修改版本或关联文件类型。

在仓库根目录运行（Windows、已安装 NSIS）：

```powershell
node scripts/build-installer.mjs --package dist/已验普通包 --manifest doc/验收/已验包清单.json --output dist/Blocky-Studio-0.8.0-beta.1-setup.exe --display-name 'Blocky Studio（测试版）0.8.0-beta.1' --release-version 0.8.0-beta.1
node --test scripts/installer/build-installer.test.mjs
node --test scripts/installer/installer-io.test.mjs
```

输入清单须包含相对于仓库的 `directory` 和 `files` 数组，每条文件记录为 `path`（包内正斜线相对路径）、`bytes`、`sha256`。脚本逐文件检查编译前后的 SHA256、实际文件集合、符号链接/硬链接和 Windows 路径规则；已有输出文件不会覆盖。可用 `--makensis` 指定编译器，否则复用本机 Tauri 缓存或已安装的 NSIS，不下载工具。

`--release-version` 只设置安装器显示版本、卸载项及内置清单，须与根产品版本的数字部分一致，缺省使用产品版本；不会改 package.json 或锁文件。Windows 数字文件版本仍是 `0.8.0.0`，字符串显示可以是 `0.8.0-beta.1`。

安装默认位于当前用户的 `%LOCALAPPDATA%\Programs\Blocky Studio Beta`，桌面和开始菜单使用独立的“Blocky Studio（测试版）”名称，HKCU 卸载键为 `BlockyStudioBeta`。已有测试版须先卸载，安装目标必须为空目录。缺少 WebView2 或包实际 PE 导入所需的 VC x64 运行库时，安装前提示官方手动安装地址；不静默安装依赖。

卸载文件名单编译在安装器内，只删除包清单中的文件及安装器自己的清单、卸载程序和测试版快捷方式；仅移除空目录，不递归删除未知文件，不访问作品或用户配置目录。用户新增的文件会留下其所在目录。

每个文件提取、目录、卸载程序、快捷方式和注册项写入都立即检查错误。失败退出码为 9，清理本轮已开始写入的清单文件、自身文件、测试版快捷方式和 Beta 注册项；不能删除的文件会保留并明确提示安装未完成，不能显示成功。已有测试版快捷方式不会覆盖。非空目标在任何安装写入前以退出码 7 拒绝。

`installer-io.test.mjs` 在 Windows 上使用已有 NSIS 编译真实微型安装器，只向 `try/installer-2026-10-09/io-boundary-*` 写文件，不包含注册表或快捷方式命令。测试临时施加目标目录写拒绝 ACL，并在 `finally` 中恢复，验证提取错误退出和未到达注册阶段；另有非空目标零修改和可写目标正控制。证据及编译日志保留在该测试目录。

默认 Windows 路径（真正安装时才写入）：`%LOCALAPPDATA%\Programs\Blocky Studio Beta`、当前用户桌面的测试版快捷方式、`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Blocky Studio（测试版）`。Windows 通常把这些目录放在 C 盘，NSIS 运行时临时目录通常来自 `%TEMP%`。构建脚本及微型测试把子进程 `TEMP/TMP` 指向 D 盘仓库 `try/`；本轮没有写入用户安装目录、桌面、开始菜单或注册表。既有编译器从 `%LOCALAPPDATA%\tauri\NSIS` 读取，运行库检查只读取 `%WINDIR%\Sysnative` 及注册信息。

构建回执写入输出旁的 `.build.json`，临时编译输入和日志位于 `try/installer-2026-10-09/build-*`。编译成功和脚本测试不代表真实安装、启动或卸载验收；发布前应另外验证正常安装/启动、缺依赖提示、已有版本隔离、未知文件保留、作品/配置保留及卸载后的快捷方式和 HKCU 注册项。
