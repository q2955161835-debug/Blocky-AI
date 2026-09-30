import { cooperativeNativeRequest } from "./cooperative-transport";
export function installModel(
  executable: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  return cooperativeNativeRequest(executable, input, "model-install", signal);
}
