import { mkdir, copyFile, readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { installDirectML } from "./prepare-native-runtime.mjs";

const target = process.argv[2];
if (!target || process.argv.length !== 3)
  throw Error("Usage: install-coding-cli.mjs <native binary directory>");
const lock = JSON.parse(
  await readFile("tools/blocky-cli/cli-runtime-lock.json", "utf8"),
);
const source = "tools/blocky-cli/dist/main.mjs";
const stat = await lstat(source),
  bytes = await readFile(source);
if (
  !stat.isFile() ||
  stat.isSymbolicLink() ||
  lock.schemaVersion !== "blocky.cli-runtime/v1" ||
  bytes.length !== lock.bytes ||
  createHash("sha256").update(bytes).digest("hex") !== lock.sha256
)
  throw Error("BLK-CODING-CLI-INTEGRITY");
const directory = resolve(target);
await mkdir(resolve(directory, "cli/bin"), { recursive: true });
await copyFile(source, resolve(directory, "cli/main.mjs"));
await copyFile(
  resolve(directory, "blocky-project-io.exe"),
  resolve(directory, "cli/bin/blocky-project-io.exe"),
);
await copyFile(
  "tools/blocky-cli/dist/runtime-worker.mjs",
  resolve(directory, "cli/runtime-worker.mjs"),
);

await installDirectML(resolve(directory, "cli/bin"));
