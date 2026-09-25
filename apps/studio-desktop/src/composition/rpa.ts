import { invoke } from "@tauri-apps/api/core";
import type { RpaGrant, RpaPlan, RpaReceipt } from "@blocky/rpa-core";
export type RpaTarget = { identity: string; title: string; className: string; processId: number };
export type RpaStatus = { status: string; nextStep: string | null; active: boolean; receipts: RpaReceipt[]; expiresAt: number };
export const rpaNative = {
  targets: () => invoke<RpaTarget[]>("rpa_targets"),
  authorize: (plan: RpaPlan, requestId: string) => invoke<RpaGrant>("rpa_authorize", { plan, requestId }),
  cancelAuthorization: (requestId: string) => invoke<void>("rpa_cancel_authorization", { requestId }),
  step: (token: string, stepId: string, manualInput?: string) => invoke<Record<string, unknown>>("rpa_step", { token, stepId, manualInput: manualInput ?? null }),
  status: (token: string) => invoke<RpaStatus>("rpa_status", { token }),
  pause: (token: string) => invoke<void>("rpa_pause", { token }),
  resume: (token: string) => invoke<void>("rpa_resume", { token }),
  stop: (token: string) => invoke<void>("rpa_stop", { token }),
};
