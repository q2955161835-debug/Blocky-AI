import { getBlock } from "@blocky/block-catalog";
import { projectDigest } from "@blocky/project-model";
import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { readProject } from "./native-store";
import { allow, required, integer, type Args } from "./arguments";
import { envelope, CliError } from "./protocol";
export const blockQueryHelp = [
  "project block list <file.blocky> [--module <id>] [--type <type>] [--query <text>] [--limit 100] [--cursor 0] --json",
  "project block show <file.blocky> --module <id> --block <id> --json",
];
export function blockRows(project: Project) {
  const rows: {
    moduleId: string;
    blockId: string;
    type: string;
    parentId: string | null;
    connection: string;
    fields: WorkspaceBlock["fields"];
    disabled: boolean;
    position: { x?: number; y?: number };
  }[] = [];
  function visit(
    moduleId: string,
    block: WorkspaceBlock,
    parentId: string | null,
    connection: string,
  ) {
    rows.push({
      moduleId,
      blockId: block.id,
      type: block.type,
      parentId,
      connection,
      fields: block.fields ?? {},
      disabled: block.disabled === true,
      position: { x: block.x, y: block.y },
    });
    for (const [name, input] of Object.entries(block.inputs ?? {})) {
      if (input.block) visit(moduleId, input.block, block.id, `input:${name}`);
      if (input.shadow)
        visit(moduleId, input.shadow, block.id, `shadow:${name}`);
    }
    if (block.next) visit(moduleId, block.next.block, block.id, "next");
  }
  for (const [moduleId, workspace] of Object.entries(project.workspaces))
    for (const block of workspace.blocks.blocks)
      visit(moduleId, block, null, "root");
  return rows;
}
export function pageBounds(args: Args, total: number) {
  const raw = args.options.get("cursor") ?? "0";
  if (
    typeof raw !== "string" ||
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) > total
  )
    throw new CliError(2, "BLK-CLI-002", "分页游标无效。");
  const start = Number(raw),
    limit = integer(args, "limit", 100, 500);
  return {
    start,
    limit,
    nextCursor: start + limit < total ? String(start + limit) : null,
  };
}
export async function blockQueryCommand(args: Args) {
  const command = args.words.slice(0, 3).join(".");
  if (!["project.block.list", "project.block.show"].includes(command)) return;
  const show = command.endsWith("show");
  allow(
    args,
    show
      ? ["json", "module", "block"]
      : ["json", "module", "type", "query", "limit", "cursor"],
    4,
  );
  const project = await readProject(args.words[3]);
  const moduleId = args.options.has("module")
    ? required(args, "module")
    : undefined;
  if (moduleId && !project.workspaces[moduleId])
    throw new CliError(3, "BLK-REF-001", "目标模块不存在。");
  const rows = blockRows(project).filter(
    (r) => !moduleId || r.moduleId === moduleId,
  );
  const digest = await projectDigest(project);
  if (show) {
    required(args, "module");
    const row = rows.find((r) => r.blockId === required(args, "block"));
    if (!row)
      throw new CliError(
        3,
        "BLK-REF-001",
        "目标积木不存在。",
        "运行 project block list 获取稳定 ID。",
      );
    return {
      code: 0,
      result: envelope(command, {
        digest,
        block: row,
        definition: getBlock(row.type),
        children: rows.filter((r) => r.parentId === row.blockId),
      }),
    };
  }
  const query = String(args.options.get("query") ?? "").toLowerCase(),
    type = args.options.get("type");
  const matched = rows.filter(
    (r) =>
      (!type || r.type === type) &&
      JSON.stringify(r).toLowerCase().includes(query),
  );
  const page = pageBounds(args, matched.length);
  const result = envelope(command, {
    digest,
    total: matched.length,
    blocks: matched.slice(page.start, page.start + page.limit),
  });
  result.nextCursor = page.nextCursor;
  return { code: 0, result };
}
