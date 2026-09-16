import { migrateProject } from "@blocky/project-migration";
import { allow, required, type Args } from "./arguments";
import { envelope } from "./protocol";
import { createProject, readMigration } from "./native-store";
export async function migrationCommand(args: Args) {
  if (args.words.slice(0, 2).join(".") !== "project.migrate") return;
  allow(args, ["output", "json"], 3);
  const output = required(args, "output");
  const migrated = await migrateProject(await readMigration(args.words[2]));
  if (migrated.project) await createProject(output, migrated.project);
  const result = envelope("project.migrate", {
    schemaVersion: migrated.schemaVersion,
    sourceVersion: migrated.sourceVersion,
    targetVersion: migrated.targetVersion,
    sourceDigest: migrated.sourceDigest,
    diagnostics: migrated.diagnostics,
    migrated: !!migrated.project,
  });
  result.ok = !!migrated.project;
  return { code: migrated.project ? 0 : 3, result };
}
