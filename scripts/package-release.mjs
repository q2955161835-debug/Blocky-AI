import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, join, sep } from "node:path";
const root = process.cwd(),
  base = resolve("dist"),
  out = resolve(process.argv[2] ?? "dist/Blocky-Studio-0.2.0");
if (!out.startsWith(base + sep))
  throw Error("Release directory must be inside project dist");
const scan = JSON.parse(
  await readFile("try/stage2-release/artifacts.json", "utf8"),
);
const coverage = JSON.parse(
  await readFile("try/stage2-release/license-coverage.json", "utf8"),
);
if (!scan.passed || coverage.missing.length)
  throw Error("Release checks are incomplete");
for (const file of scan.artifacts) {
  const bytes = await readFile(file.path);
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw Error("Artifact changed after scan");
}
await mkdir(base, { recursive: true });
await mkdir(out); // Existing releases are never overwritten.
await mkdir(join(out, "cli/bin"), { recursive: true });
await mkdir(join(out, "licenses/sources"), { recursive: true });
const copies = [
  ["try/release-native-target/release/blocky-studio.exe", "Blocky Studio.exe"],
  ["tools/blocky-cli/dist/main.mjs", "cli/main.mjs"],
  ["tools/blocky-cli/dist/blocky.cmd", "cli/blocky.cmd"],
  [
    "tools/blocky-cli/dist/bin/blocky-project-io.exe",
    "cli/bin/blocky-project-io.exe",
  ],
  [
    "try/stage2-release/THIRD_PARTY_NOTICES.txt",
    "licenses/THIRD_PARTY_NOTICES.txt",
  ],
  [
    "packages/conversion-core/fixtures/LICENSE.haystack",
    "licenses/LICENSE.haystack",
  ],
  [
    "vendor/licenses/sources/selectors-0.36.1.crate",
    "licenses/sources/selectors-0.36.1.crate",
  ],
];
for (const [source, target] of copies)
  await copyFile(source, join(out, target));
await writeFile(
  join(out, "使用说明.txt"),
  `Blocky Studio 0.2.0\n\n运行环境：Windows x64，Microsoft Edge WebView2 Runtime。\n双击 Blocky Studio.exe，选择资料问答伙伴开始创作。\n项目使用 .blocky 文件保存，可在程序中重新打开。\n\nCLI 需要 Node.js 22（最低 22.12）。命令入口为 cli\\blocky.cmd；运行 --help 查看命令。\nCLI 输出 JSON/JSONL，创建新文件时拒绝覆盖已有目标。\n\n本版本支持多画布、资料问答、个人蓝图、锁定仓库候选审阅、应用问答页面、真实多会话终端、类型化项目任务、设置与资源管理、恢复副本和诊断摘要导出。\n问答使用内置本地适配器，未真实调用外部大模型 API。在线 Provider、真实资料摄取/索引、任意仓库扫描、RPA和发布服务不在本版本能力范围内。\n\n第三方许可证见 licenses。selectors 的对应原始源码随附于 licenses\\sources。\n`,
);
const files = [];
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const bytes = await readFile(path);
      for (const prefix of [
        root,
        root.replaceAll("\\", "/"),
        process.env.USERPROFILE,
      ])
        if (
          prefix &&
          (bytes.includes(Buffer.from(prefix)) ||
            bytes.includes(Buffer.from(prefix, "utf16le")))
        )
          throw Error("Local path in release content");
      files.push({
        path: relative(out, path).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk(out);
await writeFile(
  "try/stage2-release/package.json",
  JSON.stringify(
    {
      directory: relative(root, out).replaceAll("\\", "/"),
      createdAt: new Date().toISOString(),
      sourceCommit: scan.commit,
      files,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    directory: relative(root, out),
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  }),
);
