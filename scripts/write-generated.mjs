import { readFile, writeFile } from "node:fs/promises";

/** Keep unchanged generated text stable while compilers or watchers read it. */
export async function writeGenerated(path, content) {
  const previous = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (previous?.replaceAll("\r\n", "\n") === content.replaceAll("\r\n", "\n"))
    return;
  await writeFile(path, content);
}
