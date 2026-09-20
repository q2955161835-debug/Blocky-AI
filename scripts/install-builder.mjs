import { mkdir, copyFile, readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd(),
  target = resolve(process.argv[2] ?? "apps/studio-host/target/release");
if (!target.startsWith(root + sep))
  throw Error("Builder runtime must stay in project");
const out = join(target, "builder");
await mkdir(out, { recursive: true });
const manifest = JSON.parse(
  await readFile("packages/builder-engine/runtime-lock.json", "utf8"),
);
for (const name of ["builder.mjs", "node.exe", "manifest.json"])
  await copyFile(`try/stage5/builder-runtime/${name}`, join(out, name));
for (const item of manifest.files) {
  const bytes = await readFile(join(out, item.name));
  if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw Error("Runtime copy failed verification");
}
