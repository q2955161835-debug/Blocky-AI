/** Exit errors contain only a known stage and a bounded product error code. */
export class ExitStageError extends Error {}
export async function exitStage(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (cause) {
    if (cause instanceof ExitStageError) throw cause;
    const value = cause instanceof Error ? cause.message : cause;
    const code =
      typeof value === "string" && /^BLK-[A-Z0-9-]{1,64}$/.test(value)
        ? `（${value}）`
        : "";
    throw new ExitStageError(`${label}未完成${code}。`);
  }
}
