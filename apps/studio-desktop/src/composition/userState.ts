import { invoke, isTauri } from "@tauri-apps/api/core";
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
  else localStorage.setItem(`blocky.${kind}.${id}`, JSON.stringify(value));
}
export async function clearUserState(kind: string, id: string): Promise<void> {
  if (isTauri()) await invoke("clear_user_state", { kind, id });
  else localStorage.removeItem(`blocky.${kind}.${id}`);
}
