const codes = new Set(
  [
    "INVALID",
    "LIMIT",
    "STORE",
    "OWNER",
    "BINDING",
    "CONFLICT",
    "UNCERTAIN",
    "STATE",
    "NOT-FOUND",
    "CHANNEL",
    "CANCELLED",
    "RUNTIME",
  ].map((code) => `BLK-WORKFLOW-${code}`),
);
export const workflowErrorCode = (value: unknown): string =>
  typeof value === "string" && codes.has(value)
    ? value
    : "BLK-WORKFLOW-CHANNEL";
