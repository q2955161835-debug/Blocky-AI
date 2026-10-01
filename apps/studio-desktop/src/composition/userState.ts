import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseRegistry } from "@blocky/resource-registry";
export async function readUserState(
  kind: string,
  id: string,
): Promise<unknown> {
  if (isTauri()) return invoke("read_user_state", { kind, id });
  const value = localStorage.getItem(`blocky.${kind}.${id}`);
  return value === null ? null : JSON.parse(value);
}
export async function writeUserState(
  kind: string,
  id: string,
  value: unknown,
): Promise<void> {
  if (isTauri()) await invoke("write_user_state", { kind, id, value });
  else {
    const key=`blocky.${kind}.${id}`;
    if(kind==="resources" && id==="app") {
      const next=parseRegistry(value), raw=localStorage.getItem(key), old=raw===null?null:JSON.parse(raw);
      const revision=old?.schemaVersion==="blocky.resource-registry/v2"?parseRegistry(old).revision:0;
      if(next.revision!==revision+1) throw Error("BLK-RESOURCE-CONFLICT");
      const backup=`${key}.v1-backup`;
      if(old?.schemaVersion==="blocky.resource-registry/v1"&&localStorage.getItem(backup)===null) localStorage.setItem(backup,raw!);
    }
    localStorage.setItem(key, JSON.stringify(value));
  }
}
export async function clearUserState(kind: string, id: string): Promise<void> {
  if (isTauri()) await invoke("clear_user_state", { kind, id });
  else localStorage.removeItem(`blocky.${kind}.${id}`);
}
