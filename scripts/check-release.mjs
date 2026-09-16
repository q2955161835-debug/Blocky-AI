import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
const root = process.cwd();
const files = [
  "try/release-native-target/release/blocky-studio.exe",
  "tools/blocky-cli/dist/bin/blocky-project-io.exe",
  "tools/blocky-cli/dist/main.mjs",
  "tools/blocky-cli/dist/blocky.cmd",
];
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
  if (testMarkers.some((p) => includes(bytes, p)))
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
const testAssets=await readdir("try/native-test-web/assets");
let testHookFound=false;
for(const name of testAssets)if(name.endsWith(".js")&&(await readFile(join("try/native-test-web/assets",name),"utf8")).includes("__BLOCKY_ACCEPTANCE__"))testHookFound=true;
const positiveControl = testHookFound && includes(testBinary, "acceptance_round_trip") && includes(testBinary,"wdio");
const report = {
  schemaVersion: "blocky.release-scan/v1",
  checkedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  positiveControl,
  scope:
    "ordinary binaries, CLI bundle and production browser assets; pattern checks are not a general secret detector",
  artifacts,
  passed: positiveControl && artifacts.every((a) => !a.failures.length),
};
await mkdir("try/stage1-release", { recursive: true });
await writeFile(
  "try/stage1-release/artifacts.json",
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
