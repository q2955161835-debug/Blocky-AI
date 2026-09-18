import { invoke } from "@tauri-apps/api/core";
import type { KnowledgeCall } from "@blocky/knowledge-core";
export const knowledgeNative: KnowledgeCall = (operation, fields) =>
  invoke(operation.replaceAll("-", "_"), fields).catch((error: unknown) => {
    throw Error(
      typeof error === "string" && /^BLK-[A-Z-]+$/.test(error)
        ? error
        : "BLK-KNOWLEDGE-SOURCE",
    );
  });
