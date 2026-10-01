import { z } from "zod";
import { stableId, type Json } from "@blocky/language-schema";
export const decisionModelId = "ms-marco-minilm-l6-v2-int8-v1" as const;
const id=z.string().max(128).regex(stableId);
const english=(limit:number)=>z.string().min(1).max(limit).refine(v=>v.trim().length>0 && /^[\x20-\x7e\n\r\t]+$/.test(v) && /[a-zA-Z]/.test(v));
const score=z.number().finite().min(-100).max(100);
export const decisionRequestSchema=z.object({schemaVersion:z.literal("blocky.decision-request/v1"),requestId:id,projectId:id,sessionId:id,
  language:z.literal("en"),text:english(4096),labels:z.array(z.object({id,description:english(1024).refine(v=>v.trim().split(/\s+/).length>=2)}).strict()).min(1).max(8),
  rules:z.array(z.object({contains:english(256),label:id}).strict()).max(32).default([]),threshold:score,fallbackLabel:id,modelId:z.literal(decisionModelId),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.labels.map(l=>l.id)).size!==v.labels.length || v.rules.some(r=>!v.labels.some(l=>l.id===r.label)))ctx.addIssue({code:"custom",message:"BLK-DECISION-INVALID"});
});
export type DecisionRequest=z.infer<typeof decisionRequestSchema>;
export const decisionRecordSchema=z.object({schemaVersion:z.literal("blocky.decision-record/v1"),requestId:id,projectId:id,sessionId:id,modelId:z.literal(decisionModelId),
  modelVersion:z.string().regex(/^[a-f0-9]{40}$/),modelSha256:z.string().regex(/^[a-f0-9]{64}$/),label:id,mode:z.enum(["rule","model","fallback"]),
  scoreKind:z.enum(["none","logit"]),score:score.nullable(),candidateScores:z.array(z.object({label:id,score}).strict()).max(8),threshold:score,
  inferenceMs:z.number().int().min(0).max(86400000),backendInvoked:z.boolean(),experimental:z.literal(true),scoreMeaning:z.literal("relevance-logit-not-probability"),
  inputPolicy:z.literal("english-pair-truncate512-logit-v1"),ruleIndex:z.number().int().min(0).max(31).nullable(),errorCode:z.string().regex(/^BLK-[A-Z0-9-]+$/).max(128).nullable(),
}).strict().superRefine((v,ctx)=>{
  if((v.scoreKind==="none")!==(v.score===null) || (v.mode==="rule" && (v.backendInvoked||v.scoreKind!=="none"||v.ruleIndex===null||v.errorCode!==null))
    || (v.mode!=="rule" && (!v.backendInvoked||v.ruleIndex!==null)) || (v.mode==="model" && (v.scoreKind!=="logit"||v.errorCode!==null||(v.score!==null&&v.score<v.threshold)))
    || (v.mode==="fallback" && v.errorCode===null)
    || (v.scoreKind==="none"&&v.candidateScores.length!==0) || (v.scoreKind==="logit"&&v.candidateScores.length===0)
    || new Set(v.candidateScores.map(c=>c.label)).size!==v.candidateScores.length
    || (v.mode==="fallback"&&v.scoreKind==="logit"&&(v.errorCode!=="BLK-DECISION-BELOW-THRESHOLD"||(v.score!==null&&v.score>=v.threshold)))) ctx.addIssue({code:"custom",message:"BLK-DECISION-INVALID"});
});
export type DecisionRecord=z.infer<typeof decisionRecordSchema>;
export type DecisionInput=Omit<DecisionRequest,"schemaVersion"|"requestId"|"projectId"|"sessionId"|"rules"> & {rules?: DecisionRequest["rules"]};
export type DecisionPort=(request:DecisionRequest,signal:AbortSignal)=>Promise<Json>;
/** Explicitly experimental relevance routing; label descriptions and logit threshold are user supplied. */
export class NativeDecision {
  constructor(private port:DecisionPort,readonly projectId:string,readonly sessionId:string){}
  async infer(input:DecisionInput,signal:AbortSignal):Promise<DecisionRecord>{
    signal.throwIfAborted();const request=decisionRequestSchema.parse({...input,schemaVersion:"blocky.decision-request/v1",requestId:`decision-${crypto.randomUUID()}`,projectId:this.projectId,sessionId:this.sessionId});
    const record=decisionRecordSchema.parse(await this.port(request,signal));signal.throwIfAborted();
    const best=record.candidateScores.reduce<DecisionRecord["candidateScores"][number]|undefined>((best,c)=>!best||c.score>best.score?c:best,undefined);
    if(record.requestId!==request.requestId||record.projectId!==request.projectId||record.sessionId!==request.sessionId||record.threshold!==request.threshold
      || ![request.fallbackLabel,...request.labels.map(l=>l.id)].includes(record.label)
      || (record.mode==="fallback"&&record.label!==request.fallbackLabel)
      || record.candidateScores.some((candidate,index)=>candidate.label!==request.labels[index]?.id)
      || (record.scoreKind==="logit"&&record.candidateScores.length!==request.labels.length)
      || (record.mode==="rule"&&request.rules[record.ruleIndex!]?.label!==record.label)
      || (record.scoreKind==="logit"&&record.score!==best?.score) || (record.mode==="model"&&record.label!==best?.label))throw new Error("BLK-DECISION-INVALID");
    return record;
  }
}
