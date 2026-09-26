import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { registry, verifyAsset } from "./prepare-knowledge-model.mjs";
import { checkSystemRuntime } from "./prepare-native-runtime.mjs";
const root = process.cwd();
const files = [
  "try/release-native-target/release/blocky-studio.exe",
  "tools/blocky-cli/dist/bin/blocky-project-io.exe",
  "tools/blocky-cli/dist/main.mjs",
  "tools/blocky-cli/dist/blocky.cmd",
  "try/release-native-target/release/DirectML.dll",
  "tools/blocky-cli/dist/bin/DirectML.dll",
];
const vendorFiles = [
  {
    path: "try/stage5/builder-runtime/node.exe",
    asset: {
      sha256:
        "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed",
      bytes: 86989128,
    },
  },
  {
    path: "vendor/node/LICENSE",
    asset: {
      sha256:
        "c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4",
    },
  },
  ...registry.model.files.map((asset) => ({
    path: `try/stage3/models/${registry.model.directory}/${asset.name}`,
    asset,
  })),
  ...registry.licenses.map((license) => ({
    path: `vendor/models/${license.file}`,
    asset: license,
  })),
];
const builderLock = JSON.parse(
  await readFile("packages/builder-engine/runtime-lock.json", "utf8"),
);
for (const item of builderLock.files) {
  const path = `try/stage5/builder-runtime/${item.name}`,
    bytes = await readFile(path);
  if (
    bytes.length !== item.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== item.sha256
  )
    throw Error("Builder runtime mismatch");
  if (item.name !== "node.exe") files.push(path);
}
files.push("try/stage5/builder-runtime/manifest.json");
const browserLock=JSON.parse(await readFile("packages/rpa-core/runtime-lock.json","utf8"));
if(JSON.stringify(JSON.parse(await readFile("try/stage7/browser-runtime/manifest.json","utf8")))!==JSON.stringify(browserLock))throw Error("Browser manifest mismatch");
for(const item of browserLock.files){
  const path=`try/stage7/browser-runtime/${item.name}`;
  if(item.name==="browser.mjs"){
    const bytes=await readFile(path);
    if(bytes.length!==item.bytes||createHash("sha256").update(bytes).digest("hex")!==item.sha256)throw Error("Browser worker mismatch");
    files.push(path);
  } else vendorFiles.push({path,asset:item});
}
files.push("try/stage7/browser-runtime/manifest.json");
for (const { path, asset } of vendorFiles) {
  const bytes = await readFile(path);
  if (
    (asset.bytes !== undefined && bytes.length !== asset.bytes) ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw Error("Vendor artifact lock mismatch");
  files.push(path);
}
for (const path of files.filter((path) => path.endsWith("DirectML.dll")))
  await verifyAsset(path, registry.directml);
const vcRuntime = await checkSystemRuntime();
for (const name of await readdir("apps/studio-desktop/dist/assets"))
  files.push(`apps/studio-desktop/dist/assets/${name}`);
files.push("apps/studio-desktop/dist/index.html");
const privatePrefixes = [root, process.env.USERPROFILE]
  .filter(Boolean)
  .flatMap((p) => [p, p.replaceAll("\\", "/")]);
const testMarkers = [
  "__BLOCKY_ACCEPTANCE__",
  "acceptance_round_trip",
  "tauri-plugin-wdio",
  "__wdio",
  "webdriver",
];
const includes = (buffer, value) =>
  buffer.includes(Buffer.from(value)) ||
  buffer.includes(Buffer.from(value, "utf16le"));
const artifacts = [];
for (const path of files) {
  const bytes = await readFile(path),
    text = bytes.toString("utf8");
  const failures = [];
  if (privatePrefixes.some((p) => includes(bytes, p)))
    failures.push("local-build-path");
  // Tokenizer vocabulary and the upstream Playwright driver legitimately contain
  // webdriver. Vendor files are pinned above; our worker retains all marker checks.
  if (
    !vendorFiles.some((v) => v.path === path) &&
    testMarkers.some((p) => includes(bytes, p))
  )
    failures.push("test-channel");
  if (path.endsWith(".map")) failures.push("source-map");
  if (/\bsk-[A-Za-z0-9_-]{24,}/.test(text))
    failures.push("provider-key-shaped-value");
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}/.test(
      text,
    )
  )
    failures.push("private-key-shaped-value");
  artifacts.push({
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    failures,
  });
}
const testBinary = await readFile(
  "try/native-e2e-target/release/blocky-studio.exe",
);
const testAssets = await readdir("try/native-test-web/assets");
let testHookFound = false;
for (const name of testAssets)
  if (
    name.endsWith(".js") &&
    (await readFile(join("try/native-test-web/assets", name), "utf8")).includes(
      "__BLOCKY_ACCEPTANCE__",
    )
  )
    testHookFound = true;
const positiveControl =
  testHookFound &&
  includes(testBinary, "acceptance_round_trip") &&
  includes(testBinary, "wdio");
const report = {
  schemaVersion: "blocky.release-scan/v1",
  checkedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  positiveControl,
  modelId: registry.model.id,
  vcRuntime,
  scope:
    "ordinary binaries, CLI bundle and production browser assets; pattern checks are not a general secret detector",
  artifacts,
  passed: positiveControl && artifacts.every((a) => !a.failures.length),
};
await mkdir("try/stage3-release", { recursive: true });
await writeFile(
  "try/stage3-release/artifacts.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    passed: report.passed,
    positiveControl,
    files: artifacts.length,
    failures: artifacts
      .filter((a) => a.failures.length)
      .map((a) => ({ path: a.path, failures: a.failures })),
  }),
);
if (!report.passed) process.exitCode = 1;
