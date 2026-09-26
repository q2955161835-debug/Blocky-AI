import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
it.each(["approve", "reject"])(
  "persists a workflow across CLI processes and follows %s without replaying the first step",
  async (decision) => {
    const directory = await mkdtemp(resolve("try/stage7-workflow-run-"));
    const profile = join(directory, "profile");
    const call = (args: string[]) => {
      const child = spawnSync(
        process.execPath,
        [resolve("tools/blocky-cli/dist/main.mjs"), ...args],
        {
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
          env: { ...process.env, BLOCKY_PROFILE_DIR: profile },
        },
      );
      const rows = child.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { code: child.status, rows, result: rows.at(-1) };
    };
    try {
      const file = join(directory, "workflow.blocky");
      const listed = call(["template", "list", "--json"]);
      expect(listed.code).toBe(0);
      expect(listed.result.data.templates).toContainEqual(
        expect.objectContaining({
          templateId: "durable-workflow",
          kind: "project",
        }),
      );
      const shown = call(["template", "show", "durable-workflow", "--json"]);
      expect(shown.code).toBe(0);
      expect(shown.result.data.sampleInput).toBeTruthy();
      const created = call([
        "project",
        "create",
        "--template",
        "durable-workflow",
        "--output",
        file,
        "--json",
      ]);
      expect(created.code, JSON.stringify(created.result)).toBe(0);
      const start = call([
        "run",
        "start",
        file,
        "--simulate",
        "--input",
        "original-private-input",
        "--jsonl",
      ]);
      expect(start.result.data.status, JSON.stringify(start.result)).toBe(
        "waiting",
      );
      expect(start.code).toBe(4);
      const summary = start.result.data.workflow;
      expect(summary.status).toBe("awaiting-approval");
      const args = [
        "workflow",
        "decide",
        summary.taskId,
        "--project-id",
        summary.projectId,
        "--revision",
        String(summary.revision),
        "--step",
        summary.stepId,
        "--decision",
        decision,
        "--json",
      ];
      const preview = call(args);
      expect(preview.code, JSON.stringify(preview.result)).toBe(0);
      expect(preview.result.data.applied).toBe(false);
      const applied = call([
        ...args,
        "--approve",
        preview.result.data.requestDigest,
      ]);
      expect(applied.code, JSON.stringify(applied.result)).toBe(0);
      expect(applied.result.data.applied).toBe(true);
      const stale = call([
        ...args,
        "--approve",
        preview.result.data.requestDigest,
      ]);
      expect(stale.result.error.code).toBe("BLK-WORKFLOW-CONFLICT");
      const resumed = call([
        "run",
        "start",
        file,
        "--simulate",
        "--input",
        "different-input",
        "--workflow-task",
        summary.taskId,
        "--jsonl",
      ]);
      expect(resumed.code, JSON.stringify(resumed.result)).toBe(0);
      expect(resumed.result.data.workflow.status).toBe(
        decision === "approve" ? "completed" : "compensated",
      );
      expect(resumed.result.data.structured).toBe(
        decision === "approve" ? "original-private-input" : "compensated",
      );
      expect(resumed.result.data.modelApiCalled).toBe(false);
      expect(resumed.rows.some((row) => row.blockId === "remember")).toBe(
        false,
      );
      expect(
        JSON.stringify(
          resumed.rows.filter((row) => row.type === "checkpoint.created"),
        ),
      ).not.toContain("original-private-input");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
