import { invoke } from "@tauri-apps/api/core";
import type { RpaGrant, RpaPlan, RpaReceipt, RpaRecovery, RpaBrowserStart, RpaCheckpointDelete } from "@blocky/rpa-core";
import type { RpaRecordingStart, RpaRecordingStop } from "@blocky/rpa-core/recording";
export type RpaRecordingStatus = {sessionId:string;state:"awaiting-approval"|"recording"|"stopping"|"stopped";count:number;omitted?:number;reason?:string};
export type RpaTarget = { identity: string; title: string; className: string; processId: number };
export type RpaStatus = { status: string; nextStep: string | null; active: boolean; receipts: RpaReceipt[]; expiresAt: number; checkpointId?: string | null };
export type RpaCheckpoint = { checkpointId: string; revision: number; planId: string; planDigest: string; targetIdentity: string; status: string; completedSteps: number; totalSteps: number; receipts: RpaReceipt[]; updatedAtMs: number; resumable: boolean; settled?: boolean; deletable?: boolean; deleteBlockedCode?: string | null };
export type RpaRecoveryPreview = { checkpoint: RpaCheckpoint; plan: RpaPlan };
export type RpaRecoveryRun = { plan: RpaPlan; recovery: RpaRecovery; inputs: Record<string, string> };
export const rpaNative = {
  recordStart: (request:RpaRecordingStart)=>invoke<RpaRecordingStatus>("rpa_record_start",{request}),
  recordStatus: (projectId:string,sessionId:string)=>invoke<RpaRecordingStatus>("rpa_record_status",{projectId,sessionId}),
  recordStop: (projectId:string,sessionId:string)=>invoke<RpaRecordingStop>("rpa_record_stop",{projectId,sessionId}),
  deleteCheckpoint: (deletion: RpaCheckpointDelete) => invoke<{checkpointId: string; revision: number; deleted: true}>("rpa_checkpoint_delete", { deletion }),
  recoveryPreview: (checkpointId: string) => invoke<RpaRecoveryPreview>("rpa_recovery_preview", { checkpointId }),
  recover: (plan: RpaPlan, recovery: RpaRecovery, requestId: string) => invoke<RpaGrant>("rpa_recover", { plan, recovery, requestId }),
  checkpoints: () => invoke<RpaCheckpoint[]>("rpa_checkpoints"),
  checkpoint: (checkpointId: string, plan?: RpaPlan) => invoke<RpaCheckpoint>("rpa_checkpoint", { checkpointId, plan: plan ?? null }),
  targets: () => invoke<RpaTarget[]>("rpa_targets"),
  authorize: (plan: RpaPlan, requestId: string, browser?: RpaBrowserStart) => invoke<RpaGrant>("rpa_authorize", { plan, requestId, browser: browser ?? null }),
  cancelAuthorization: (requestId: string) => invoke<void>("rpa_cancel_authorization", { requestId }),
  step: (token: string, stepId: string, manualInput?: string) => invoke<Record<string, unknown>>("rpa_step", { token, stepId, manualInput: manualInput ?? null }),
  status: (token: string) => invoke<RpaStatus>("rpa_status", { token }),
  pause: (token: string) => invoke<void>("rpa_pause", { token }),
  resume: (token: string) => invoke<void>("rpa_resume", { token }),
  stop: (token: string) => invoke<void>("rpa_stop", { token }),
};
