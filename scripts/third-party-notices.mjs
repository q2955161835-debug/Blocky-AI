import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
const json = async (path) =>
  JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
const js = Object.values(await json("try/production-js-licenses.json")).flat();
const rust = (await json("try/production-rust-metadata.json")).packages.filter(
  (p) => p.name !== "blocky-studio",
);
const entries = [
  ...js.flatMap((p) =>
    p.paths.map((path, i) => ({
      name: p.name,
      version: p.versions[i] ?? p.versions[0],
      license: p.license,
      path,
    })),
  ),
  ...rust.map((p) => ({
    name: p.name,
    version: p.version,
    license: p.license,
    path: dirname(p.manifest_path),
    file: p.license_file,
  })),
];
const seen = new Set(),
  missing = [],
  sections = [];
for (const p of entries.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
)) {
  const id = `${p.name}@${p.version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const files = (await readdir(p.path, { withFileTypes: true }))
    .filter(
      (f) =>
        f.isFile() &&
        /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(f.name),
    )
    .map((f) => join(p.path, f.name));
  if (p.file && !files.includes(resolve(p.path, p.file)))
    files.push(resolve(p.path, p.file));
  if (!files.length) {
    missing.push({ name: p.name, version: p.version, license: p.license });
    continue;
  }
  const texts = [];
  for (const file of files) texts.push(await readFile(file, "utf8"));
  sections.push(
    `\n${"=".repeat(72)}\n${id}\nDeclared license: ${p.license ?? "see text"}\n${"=".repeat(72)}\n${texts.join("\n\n")}`,
  );
}
await mkdir("try/stage1-release", { recursive: true });
await writeFile(
  "try/stage1-release/license-coverage.json",
  JSON.stringify(
    { packages: seen.size, included: sections.length, missing },
    null,
    2,
  ),
);
if (missing.length) {
  console.log(JSON.stringify({ missing }));
  process.exitCode = 1;
} else {
  await writeFile(
    "try/stage1-release/THIRD_PARTY_NOTICES.txt",
    `Blocky Studio - Third-party notices\nThis file preserves notices for the locked JavaScript and Rust dependencies.\n${sections.join("\n")}\n\nHaystack source fixture\n${await readFile("packages/conversion-core/fixtures/LICENSE.haystack", "utf8")}`,
  );
  console.log(JSON.stringify({ packages: seen.size, missing: 0 }));
}
