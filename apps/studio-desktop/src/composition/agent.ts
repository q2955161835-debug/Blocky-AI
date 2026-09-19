import { invoke } from "@tauri-apps/api/core";
import {
  nativeAgentServices,
  type NativeAgentCall,
} from "@blocky/runtime-core";
const agentNative: NativeAgentCall = async (operation, fields, signal) => {
  signal?.throwIfAborted();
  try {
    return await invoke(operation.replaceAll("-", "_"), fields);
  } catch (error) {
    throw Error(
      typeof error === "string" && /^BLK-[A-Z0-9-]{3,64}$/.test(error)
        ? error
        : "BLK-HOST-001",
    );
  }
};
export const studioAgentServices = () =>
  nativeAgentServices(agentNative, { mode: "desktop" });
