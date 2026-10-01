import {
  createSettings,
  parseSettings,
  updateSetting,
  resetSetting,
  settingDefinitions,
  resolveSetting,
} from "@blocky/settings-core";
import {
  emptyRegistry,
  parseRegistry,
  upsertUserResource,
  configuredOnlineModel,
} from "@blocky/resource-registry";
import {
  emptyBindings,
  parseBindings,
  changeBinding,
  commands,
} from "@blocky/command-system";
import { nativeUserOperation } from "./native-store";
import { allow, required, type Args } from "./arguments";
import { envelope, CliError } from "./protocol";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { resolve } from "node:path";
import type { Resource } from "@blocky/language-schema";
export const userConfigHelp = [
  "settings list --json",
  "settings set --id <setting> --value <JSON> --json",
  "settings reset --id <setting> --json",
  "shortcuts list --json",
  "shortcuts set --id <command> --keys <JSON-array> --json",
  "shortcuts reset --id <command> --json",
  "shortcuts export --output <keys.json> --json",
  "shortcuts import --input <keys.json> --json",
  "resource list --json",
  "resource set --definition <resource.json> --json",
  "resource delete --id <id> --json",
  "secret import --id <secret-ref> --env-file <local-file> --variable <name> --json",
  "secret import-key --id <secret-ref> --file <local-key-file> --json",
  "secret status --id <secret-ref> --json",
  "secret remove --id <secret-ref> --json",
];
export async function readUserRegistry() {
  const value = await nativeUserOperation("user-read", {
    stateKind: "resources",
    stateId: "app",
  });
  return value === null ? emptyRegistry() : parseRegistry(value);
}
export async function userRegistryMap() {
  return new Map(
    (await readUserRegistry()).resources.map((r) => [r.resourceId, r]),
  );
}
export async function readDefaultModelId(): Promise<string> {
  const raw = await nativeUserOperation("user-read", { stateKind: "settings", stateId: "app" });
  const settings = raw === null ? createSettings("app") : parseSettings(raw);
  if (settings.scope !== "app") throw new CliError(3, "BLK-CONFIG-001", "本机应用配置无效。");
  return resolveSetting("models.defaultResourceId", { app: settings }).value;
}
export function defaultModelError(): CliError {
  return new CliError(3, "BLK-MODEL-DEFAULT-001", "本机模型未配置或不可用。", "运行 resource list 选择已配置的模型；在设置中更换默认模型，或用 settings reset --id models.defaultResourceId 恢复本地默认。");
}
export function requireOnlineModel(id: string, registry: ReadonlyMap<string, Resource>): string {
  try { configuredOnlineModel(id, registry); return id; }
  catch { throw defaultModelError(); }
}
export async function userConfigCommand(args: Args) {
  const [kind, action] = args.words;
  if (!["settings", "shortcuts", "resource", "secret"].includes(kind)) return;
  const key = `${kind}.${action}`;
  const specs: Record<string, string[]> = {
    "settings.list": [],
    "settings.set": ["id", "value"],
    "settings.reset": ["id"],
    "shortcuts.list": [],
    "shortcuts.set": ["id", "keys"],
    "shortcuts.reset": ["id"],
    "shortcuts.export": ["output"],
    "shortcuts.import": ["input"],
    "resource.list": [],
    "resource.set": ["definition"],
    "resource.delete": ["id"],
    "secret.import": ["id", "env-file", "variable"],
    "secret.import-key": ["id", "file"],
    "secret.status": ["id"],
    "secret.remove": ["id"],
  };
  if (!specs[key]) throw new CliError(2, "BLK-CLI-002", "命令不存在。");
  allow(args, ["json", ...specs[key]], 2);
  for (const field of specs[key]) required(args, field);
  if (kind === "secret") {
    const value = await nativeUserOperation(`secret-${action}`, {
      stateId: required(args, "id"),
      ...(action === "import"
        ? {
            path: resolve(required(args, "env-file")),
            variable: required(args, "variable"),
          }
        : action === "import-key" ? {path:resolve(required(args,"file"))}: {}),
    });
    return {
      code: 0,
      result: envelope(key, {
        secretRef: required(args, "id"),
        ...(action !== "remove"
          ? { configured: value === true }
          : { removed: true }),
      }),
    };
  }
  const stateKind = kind === "resource" ? "resources" : kind;
  const raw = await nativeUserOperation("user-read", {
    stateKind,
    stateId: "app",
  });
  try {
    let value: unknown;
    if (kind === "settings") {
      const doc = raw === null ? createSettings("app") : parseSettings(raw);
      if (doc.scope !== "app") throw Error();
      if (action === "list")
        return {
          code: 0,
          result: envelope(key, {
            definitions: settingDefinitions,
            settings: doc,
          }),
        };
      value =
        action === "reset"
          ? resetSetting(doc, required(args, "id"))
          : updateSetting(
              doc,
              required(args, "id"),
              JSON.parse(required(args, "value")),
            );
      if (action === "set" && required(args, "id") === "models.defaultResourceId") {
        const id = resolveSetting("models.defaultResourceId", { app: parseSettings(value) }).value;
        if (id) requireOnlineModel(id, await userRegistryMap());
      }
    } else if (kind === "shortcuts") {
      const doc = raw === null ? emptyBindings() : parseBindings(raw);
      if (action === "list")
        return { code: 0, result: envelope(key, { commands, bindings: doc }) };
      if (action === "export") {
        const result = envelope(key, {});
        result.artifacts = [
          await writeJsonArtifact(required(args, "output"), doc),
        ];
        return { code: 0, result };
      }
      if (action === "import") {
        const imported = parseBindings(
          await readJsonArtifact(required(args, "input")),
        );
        if (
          Object.keys(imported.overrides).some(
            (id) =>
              Object.hasOwn(doc.overrides, id) &&
              JSON.stringify(imported.overrides[id]) !==
                JSON.stringify(doc.overrides[id]),
          )
        )
          throw Error();
        value = parseBindings({
          ...doc,
          overrides: { ...doc.overrides, ...imported.overrides },
        });
      } else
        value = changeBinding(
          doc,
          required(args, "id"),
          action === "reset" ? undefined : JSON.parse(required(args, "keys")),
        );
    } else {
      const doc = raw === null ? emptyRegistry() : parseRegistry(raw);
      if (action === "list") return { code: 0, result: envelope(key, doc) };
      if (action === "set")
        value = upsertUserResource(
          doc,
          await readJsonArtifact(required(args, "definition")),
        );
      else {
        const id = required(args, "id");
        if (!doc.resources.some((r) => r.resourceId === id)) throw Error();
        value = parseRegistry({
          ...doc,
          resources: doc.resources.filter((r) => r.resourceId !== id),
        });
      }
    }
    await nativeUserOperation("user-write", {
      stateKind,
      stateId: "app",
      stateValue: value,
    });
    return { code: 0, result: envelope(key, { saved: true }) };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      3,
      "BLK-CONFIG-001",
      "配置无效或与已有快捷键冲突；未覆盖本机配置。",
    );
  }
}
