/** Output tokens are separate from input usage. Explicit project budgets may raise defaults. */
export const agentBudgetDefaults = {
  steps: 10000,
  calls: 256,
  outputTokens: 1048576,
  durationMs: 1800000,
  turns: 32,
  outputTokensPerTurn: 32768,
} as const;

/** Validation boundaries, not silently substituted model settings. */
export const agentBudgetLimits = {
  steps: 1000000,
  calls: 65536,
  outputTokens: 1000000000,
  durationMs: 86400000,
  turns: 4096,
  outputTokensPerTurn: 10000000,
} as const;

/** Byte and collection limits protect IPC and local state independently of Token budgets. */
export const agentMessageLimits = {
  outputBytes: 2 * 1024 * 1024,
  historyBytes: 4 * 1024 * 1024,
  historyMessages: 8192,
  sessionBytes: 8 * 1024 * 1024,
  serviceCalls: 1000000,
  frames: 3000000,
} as const;
