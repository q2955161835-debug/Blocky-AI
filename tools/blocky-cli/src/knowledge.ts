import { resolve } from "node:path";
import { open } from "node:fs/promises";
import {
  knowledgePort,
  knowledgeResource,
  synchronize,
  readKnowledgeState,
  KnowledgeSearch,
  retrievalOptions,
  LOCAL_EMBEDDING_MODEL,
} from "@blocky/knowledge-core";
import { upsertProjectResource } from "@blocky/resource-registry";
import {
  nativeUserOperation,
  readProject,
  createProject,
} from "./native-store";
import { type Args, allow, required, integer } from "./arguments";
import { CliError, envelope } from "./protocol";
export const knowledgeHelp = [
  "knowledge add <file.blocky> --collection <id> --kind <file|directory|repository|url> [--path <source>] [--url <url>] [--ref <commit>] --json",
  "knowledge sources <file.blocky> --collection <id> --json",
  "knowledge sync <file.blocky> --collection <id> [--size 768] [--overlap 64] --json",
  "knowledge status <file.blocky> --collection <id> --json",
  "knowledge remove <file.blocky> --collection <id> --source <id> --json",
  "knowledge access <file.blocky> --collection <id> --source <id> --access <local|deny> --json",
  "knowledge bind <file.blocky> --collection <resource-id> --output <new.blocky> --json",
  "knowledge model-status|model-install|embed <file.blocky> --collection <id> --json",
  "knowledge query <file.blocky> --collection <id> --query <question> [--options <JSON>] --json",
  "knowledge query <file.blocky> --collection <id> --queries <questions.json> [--options <JSON>] --json",
];
export async function knowledgeCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "knowledge") return;
  const action = args.words[1],
    command = `knowledge.${action}`;
  const flags: Record<string, string[]> = {
    add: ["kind", "path", "url", "ref"],
    sources: [],
    sync: ["size", "overlap"],
    status: [],
    remove: ["source"],
    access: ["source", "access"],
    bind: ["output"],
    "model-status": [],
    "model-install": [],
    embed: [],
    query: ["query", "queries", "options"],
  };
  if (!Object.hasOwn(flags, action))
    throw new CliError(2, "BLK-CLI-002", "未知资料操作。");
  allow(args, ["collection", "json", ...flags[action]], 3);
  signal.throwIfAborted();
  const project = await readProject(args.words[2]),
    collectionId = required(args, "collection"),
    projectId = project.manifest.projectId;
  const fields = { projectId, collectionId },
    port = knowledgePort(nativeUserOperation, projectId, collectionId);
  const cancel = () => {
    void nativeUserOperation("knowledge-cancel", fields).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let data: unknown;
    if (action === "add") {
      const kind = required(args, "kind");
      if (!["file", "directory", "repository", "url"].includes(kind))
        throw new CliError(2, "BLK-CLI-002", "来源类型无效。");
      if (kind === "url" ? args.options.has("path") : args.options.has("url"))
        throw new CliError(2, "BLK-CLI-002", "来源路径和 URL 不能混用。");
      data = await nativeUserOperation("knowledge-source-add", {
        ...fields,
        kind,
        ...(kind === "url"
          ? { url: required(args, "url") }
          : { path: resolve(required(args, "path")) }),
        ...(args.options.has("ref") ? { ref: required(args, "ref") } : {}),
      });
    } else if (action === "model-status" || action === "model-install")
      data = await nativeUserOperation(`knowledge-${action}`, {
        ...fields,
        modelId: LOCAL_EMBEDDING_MODEL,
      });
    else if (action === "embed")
      data = await new KnowledgeSearch(
        nativeUserOperation,
        projectId,
        collectionId,
      ).embed();
    else if (action === "query") {
      const search = new KnowledgeSearch(
        nativeUserOperation,
        projectId,
        collectionId,
      );
      const options = retrievalOptions(
        args.options.has("options")
          ? JSON.parse(required(args, "options"))
          : {},
      );
      if (args.options.has("query") === args.options.has("queries"))
        throw new CliError(
          2,
          "BLK-CLI-002",
          "提供 --query 或 --queries 中的一项。",
        );
      if (args.options.has("query"))
        data = await search.query(required(args, "query"), options, signal);
      else {
        const file = await open(resolve(required(args, "queries")), "r");
        const bytes = await (async () => {
          try {
            const buffer = Buffer.alloc(1024 * 1024 + 1);
            let size = 0;
            while (size < buffer.length) {
              const read = await file.read(
                buffer,
                size,
                buffer.length - size,
                size,
              );
              if (!read.bytesRead) break;
              size += read.bytesRead;
            }
            return buffer.subarray(0, size);
          } finally {
            await file.close();
          }
        })();
        if (bytes.length > 1024 * 1024)
          throw new CliError(2, "BLK-CLI-002", "查询集超过 1 MiB。");
        const queries: unknown = JSON.parse(bytes.toString("utf8"));
        if (
          !Array.isArray(queries) ||
          queries.length > 1000 ||
          queries.some((q) => typeof q !== "string" || q.length > 8000)
        )
          throw new CliError(
            2,
            "BLK-CLI-002",
            "查询集须为不超过 1000 项的文本数组。",
          );
        const results = [];
        for (const query of queries)
          results.push(await search.query(query, options, signal));
        data = { results, externalModelApi: false };
      }
    } else if (action === "sources") data = await port.sources();
    else if (action === "sync") {
      const rawOverlap = args.options.get("overlap");
      if (
        rawOverlap !== undefined &&
        (typeof rawOverlap !== "string" || !/^\d+$/.test(rawOverlap))
      )
        throw new CliError(2, "BLK-CLI-002", "分段重叠值无效。");
      const result = await synchronize(port, {
        signal,
        size: integer(args, "size", 768, 16000),
        overlap: rawOverlap === undefined ? 64 : Number(rawOverlap),
      });
      if (result.status === "failed") {
        const reply = envelope(command, result);
        reply.ok = false;
        reply.error = {
          code: "BLK-KNOWLEDGE-SYNC",
          message: "部分来源失败，未发布新索引。",
          path: "",
          hint: "运行 knowledge status 查看失败来源，修复后重新同步。",
        };
        return { code: 3, result: reply };
      }
      data = result;
    } else if (action === "status") {
      const stored = await port.load(),
        state = readKnowledgeState(stored.value);
      data = {
        revision: stored.revision,
        generation: stored.generation,
        documents: state.index?.documents.length ?? 0,
        chunks: state.index?.chunks.length ?? 0,
        pending: state.pending
          ? {
              completedSources: state.pending.completedSources,
              failures: state.pending.failures,
              counts: state.pending.counts,
            }
          : null,
      };
    } else if (action === "remove")
      data = await nativeUserOperation("knowledge-source-remove", {
        ...fields,
        sourceId: required(args, "source"),
      });
    else if (action === "access") {
      const access = required(args, "access");
      if (!["local", "deny"].includes(access))
        throw new CliError(2, "BLK-CLI-002", "权限值无效。");
      data = await nativeUserOperation("knowledge-source-acl", {
        ...fields,
        sourceId: required(args, "source"),
        allowedPrincipals: access === "local" ? ["local-user"] : [],
      });
    } else {
      const next = upsertProjectResource(
        project,
        knowledgeResource(collectionId),
      );
      await createProject(required(args, "output"), next);
      data = { resourceId: collectionId, projectId, modelApiCalled: false };
    }
    return { code: 0, result: envelope(command, data) };
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (signal.aborted)
      throw new CliError(7, "BLK-RUN-005", "资料操作已取消。");
    const code =
      error instanceof Error &&
      /^BLK-(?:KNOWLEDGE|EMBED)-[A-Z-]+$/.test(error.message)
        ? error.message
        : "BLK-KNOWLEDGE-SOURCE";
    throw new CliError(
      code.endsWith("CONFLICT") ? 5 : 3,
      code,
      "资料操作未完成，原项目未更改。",
      "检查来源权限与同步状态后重试。",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
