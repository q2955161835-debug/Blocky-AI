import { writeFile, open, link, unlink } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
/** Publish one complete inode without replacing an existing destination. */
export async function atomicOutput(
  path: string,
  content: string,
  signal: AbortSignal,
) {
  const destination = resolve(path),
    temporary = join(
      dirname(destination),
      `.blocky-output-${crypto.randomUUID()}.tmp`,
    );
  signal.throwIfAborted();
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      signal,
    });
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal.throwIfAborted();
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
