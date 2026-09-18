import { invoke } from "@tauri-apps/api/core";
import type { KnowledgeCall } from "@blocky/knowledge-core";
export const knowledgeNative: KnowledgeCall = (operation, fields) =>
  invoke(operation.replaceAll("-", "_"), fields);
