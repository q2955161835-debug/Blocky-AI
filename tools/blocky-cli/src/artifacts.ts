import { open, readFile, link, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { CliError } from "./protocol";
export async function readJsonArtifact(path: string): Promise<unknown> {
  try {
    const file = await open(path, "r");
    try {
      if ((await file.stat()).size > 2 * 1024 * 1024) throw Error();
      const bytes = await file.readFile();
      if (bytes.length > 2 * 1024 * 1024) throw Error();
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/^\uFEFF/, ""),
      );
    } finally {
      await file.close();
    }
  } catch {
    throw new CliError(
      3,
      "BLK-CLI-003",
      "无法读取有效 JSON 工件或文件超出大小限制。",
    );
  }
}
export async function writeJsonArtifact(path: string, value: unknown) {
  const temporary = join(dirname(path), `.blocky-${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temporary, "wx");
    created = true;
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    // Same-directory hard link publishes the complete file without replacing a target.
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CliError(5, "BLK-CLI-005", "目标已存在，未覆盖。");
    throw new CliError(3, "BLK-CLI-003", "工件无法写入，原目标保持不变。");
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
  return artifactInfo(path);
}
export async function artifactInfo(path: string) {
  const bytes = await readFile(path);
  return {
    path: basename(path),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
