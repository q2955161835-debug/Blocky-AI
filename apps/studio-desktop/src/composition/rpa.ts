import { invoke } from "@tauri-apps/api/core";
import type { RpaGrant, RpaPlan, RpaReceipt, RpaRecovery } from "@blocky/rpa-core";
export type RpaTarget = { identity: string; title: string; className: string; processId: number };
export type RpaStatus = { status: string; nextStep: string | null; active: boolean; receipts: RpaReceipt[]; expiresAt: number; checkpointId?: string | null };
export type RpaCheckpoint = { checkpointId: string; revision: number; planId: string; planDigest: string; targetIdentity: string; status: string; completedSteps: number; totalSteps: number; receipts: RpaReceipt[]; updatedAtMs: number; resumable: boolean };
export type RpaRecoveryPreview = { checkpoint: RpaCheckpoint; plan: RpaPlan };
export type RpaRecoveryRun = { plan: RpaPlan; recovery: RpaRecovery; inputs: Record<string, string> };
export const rpaNative = {
  recoveryPreview: (checkpointId: string) => invoke<RpaRecoveryPreview>("rpa_recovery_preview", { checkpointId }),
  recover: (plan: RpaPlan, recovery: RpaRecovery, requestId: string) => invoke<RpaGrant>("rpa_recover", { plan, recovery, requestId }),
  checkpoints: () => invoke<RpaCheckpoint[]>("rpa_checkpoints"),
  checkpoint: (checkpointId: string, plan?: RpaPlan) => invoke<RpaCheckpoint>("rpa_checkpoint", { checkpointId, plan: plan ?? null }),
  targets: () => invoke<RpaTarget[]>("rpa_targets"),
  authorize: (plan: RpaPlan, requestId: string) => invoke<RpaGrant>("rpa_authorize", { plan, requestId }),
  cancelAuthorization: (requestId: string) => invoke<void>("rpa_cancel_authorization", { requestId }),
  step: (token: string, stepId: string, manualInput?: string) => invoke<Record<string, unknown>>("rpa_step", { token, stepId, manualInput: manualInput ?? null }),
  status: (token: string) => invoke<RpaStatus>("rpa_status", { token }),
  pause: (token: string) => invoke<void>("rpa_pause", { token }),
  resume: (token: string) => invoke<void>("rpa_resume", { token }),
  stop: (token: string) => invoke<void>("rpa_stop", { token }),
};
