import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { documentRuntimeFiles, documentRuntimePackages } from "./install-document-parser.mjs";
import { extraKnowledgeModels } from "./prepare-extra-knowledge-models.mjs";
import { loadDocumentLicenses } from "./document-runtime-licenses.mjs";
import {audioLock,audioRuntimeSource,verifyAudioRuntime} from "./prepare-audio-runtime.mjs";
const json = async (path) =>
  JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
const js = Object.values(await json("try/production-js-licenses.json")).flat();
const rust = (await json("try/production-rust-metadata.json")).packages.filter(
  (p) => p.name !== "blocky-studio",
);
const registry = await json("vendor/licenses/registry.json").catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const modelRegistry = await json("vendor/models/registry.json");
const entries = [
  {
    name: "node",
    version: "22.23.1",
    license: "MIT and bundled third-party licenses",
    path: resolve("vendor/node"),
  },
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
const documentSource = resolve("try/agent-capability-upgrade/document-runtime");
const documentFiles = await documentRuntimeFiles();
entries.push(...await documentRuntimePackages());
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
  if (p.file && !files.includes(resolve(p.path, p.file))) {
    const candidate = resolve(p.path, p.file);
    if (!candidate.startsWith(resolve(p.path) + sep))
      throw Error(`License path outside package: ${id}`);
    files.push(candidate);
  }
  if (!files.length) {
    const registered = registry.find(
      (r) => r.name === p.name && r.version === p.version,
    );
    if (registered)
      for (let i = 0; i < registered.files.length; i++) {
        const candidate = resolve("vendor/licenses", registered.files[i]);
        if (!candidate.startsWith(resolve("vendor/licenses") + sep))
          throw Error("Invalid license registry path");
        const bytes = await readFile(candidate);
        if (
          createHash("sha256").update(bytes).digest("hex") !==
          registered.sha256[i].toLowerCase()
        )
          throw Error(`License registry checksum mismatch: ${id}`);
        files.push(candidate);
      }
  }
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
for (const entry of modelRegistry.licenses) {
  const bytes = await readFile(resolve("vendor/models", entry.file));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw Error("Model/runtime license checksum mismatch");
  seen.add(entry.name);
  sections.push(
    `\n${"=".repeat(72)}\n${entry.name}\nDeclared license: ${entry.license}\nSource: ${entry.source}\n${"=".repeat(72)}\n${bytes.toString("utf8")}`,
  );
}
for (const entry of await loadDocumentLicenses()) {
  seen.add(`document-runtime/${entry.name}/${entry.file}`);
  sections.push(`\n${"=".repeat(72)}\n${entry.name}\nDeclared license: ${entry.license}\nSource: ${entry.source}\n${"=".repeat(72)}\n${entry.text}`);
}
// PDF.js bundles codecs with their own notices below its package root.
for (const name of documentFiles.filter(name => /^node_modules\/pdfjs-dist\/(wasm|standard_fonts)\/LICENSE/.test(name) || /^runtime\/langs\/[^/]*LICENSE/i.test(name))) {
  seen.add(`document-runtime/${name}`);
  sections.push(`\n${"=".repeat(72)}\nDocument codec/font/OCR data: ${name.split("/").at(-1)}\n${"=".repeat(72)}\n${await readFile(join(documentSource, name), "utf8")}`);
}
for (const entry of extraKnowledgeModels.licenses) {
  const bytes = await readFile(resolve("vendor/models", entry.file));
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw Error("Additional model license checksum mismatch");
  seen.add(`additional-models/${entry.file}`);
  sections.push(`\n${"=".repeat(72)}\nMiniLM embeddings and MS MARCO cross-encoder\nDeclared license: Apache-2.0\n${"=".repeat(72)}\n${bytes.toString("utf8")}`);
}
await verifyAudioRuntime(audioRuntimeSource);
for(const file of audioLock.files.filter(file=>file.name.startsWith("licenses/"))) {
  seen.add(`audio-runtime/${file.name}`);
  sections.push(`\n${"=".repeat(72)}\nAudio runtime: ${file.name}\n${"=".repeat(72)}\n${await readFile(resolve(audioRuntimeSource,file.name),"utf8")}`);
}
await mkdir("try/stage3-release", { recursive: true });
await writeFile(
  "try/stage3-release/license-coverage.json",
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
    "try/stage3-release/THIRD_PARTY_NOTICES.txt",
    `Blocky Studio - Third-party notices\nThis file preserves notices for the locked JavaScript and Rust dependencies.\n${sections.join("\n")}\n\nHaystack source fixture\n${await readFile("packages/conversion-core/fixtures/LICENSE.haystack", "utf8")}`,
  );
  console.log(JSON.stringify({ packages: seen.size, missing: 0 }));
}
