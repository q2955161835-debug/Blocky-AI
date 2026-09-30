import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
  appendFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, join, sep, dirname } from "node:path";
import { registry } from "./prepare-knowledge-model.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const root = process.cwd(),
  base = resolve("dist"),
  out = resolve(process.argv[2] ?? `dist/Blocky-Studio-${version}`);
if (!out.startsWith(base + sep))
  throw Error("Release directory must be inside project dist");
const scan = JSON.parse(
  await readFile("try/stage3-release/artifacts.json", "utf8"),
);
const coverage = JSON.parse(
  await readFile("try/stage3-release/license-coverage.json", "utf8"),
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
  ["try/release-native-target/release/DirectML.dll", "DirectML.dll"],
  ["tools/blocky-cli/dist/main.mjs", "cli/main.mjs"],
  ["tools/blocky-cli/dist/runtime-worker.mjs", "cli/runtime-worker.mjs"],
  ["tools/blocky-cli/dist/blocky.cmd", "cli/blocky.cmd"],
  [
    "tools/blocky-cli/dist/bin/blocky-project-io.exe",
    "cli/bin/blocky-project-io.exe",
  ],
  ["tools/blocky-cli/dist/bin/DirectML.dll", "cli/bin/DirectML.dll"],
  [
    "try/stage3-release/THIRD_PARTY_NOTICES.txt",
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
for (const name of ["builder.mjs", "node.exe", "manifest.json"])
  copies.push([`try/stage5/builder-runtime/${name}`, `builder/${name}`]);
copies.push(["vendor/node/LICENSE", "licenses/LICENSE.node"]);
const browserLock=JSON.parse(await readFile("packages/rpa-core/runtime-lock.json","utf8"));
for(const item of browserLock.files)copies.push([`try/stage7/browser-runtime/${item.name}`,`browser/${item.name}`]);
copies.push(["try/stage7/browser-runtime/manifest.json","browser/manifest.json"]);
for (const asset of registry.model.files)
  copies.push([
    `try/stage3/models/${registry.model.directory}/${asset.name}`,
    `models/${registry.model.directory}/${asset.name}`,
  ]);
for (const license of registry.licenses)
  copies.push([
    `vendor/models/${license.file}`,
    `licenses/${license.file.split("/").at(-1)}`,
  ]);
for (const [source, target] of copies) {
  await mkdir(dirname(join(out, target)), { recursive: true });
  await copyFile(source, join(out, target));
}
await writeFile(
  join(out, "使用说明.txt"),
  `Blocky Studio ${version}\n\n运行环境：Windows x64，Microsoft Edge WebView2 Runtime，以及 Microsoft Visual C++ 2015–2022 x64 Runtime（14.44 或更新版本）。\nVC 运行库未随包分发；官方安装入口：${registry.vcRuntime.download}\n双击 Blocky Studio.exe 开始创作。项目使用 .blocky 文件保存，可在程序中重新打开。\n\nCLI 使用随包运行库。命令入口为 cli\\blocky.cmd；运行 --help 查看命令。\nCLI 输出 JSON/JSONL，创建新文件时拒绝覆盖已有目标。\n\n本地知识检索使用随包的 multilingual-e5-small 模型；请保留 models 目录。桌面与 CLI 共用这份模型。默认使用本地处理。需要在线生成时，在模型资源中配置 DeepSeek 或息壤并选择该模型；请求会在批准后发送，模型密钥不进入项目。内置文本分析 Agent 支持本机统计和结果导出。\n\n第三方许可证见 licenses。selectors 的对应原始源码随附于 licenses\\sources。\n`,
);
await appendFile(join(out,"使用说明.txt"),"\n左右栏与底部面板可拖动边界调整大小，右上角图标控制显隐，底栏默认收起。构建助手可在右侧标签页打开。应用设置中的默认模型保存在本机，供新建项目与构建助手使用；已有项目保留原模型。CLI 的 builder --live 未指定 --model 时使用本机默认模型，实际请求仍需批准。\n\n有人值守浏览器自动化需已安装完整 Microsoft Edge 浏览器；WebView2 Runtime 不能替代。每次运行新建隔离会话，不沿用个人登录；只允许初始来源，暂不支持跨来源资源和 HTTP 重定向。驱动与许可证位于 browser 目录，请完整保留。\n");
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
  "try/stage3-release/package.json",
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
