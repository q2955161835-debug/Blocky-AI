import { expect,it } from "vitest";
import { NativeDecision,decisionModelId,decisionRecordSchema,decisionRequestSchema } from "../src/decision.js";
const input={language:"en" as const,text:"Where is Paris located?",labels:[{id:"geography",description:"Paris is a city in France."},{id:"sports",description:"Soccer is a team sport."}],rules:[],threshold:-5.25,fallbackLabel:"unknown",modelId:decisionModelId};
const request={...input,schemaVersion:"blocky.decision-request/v1",requestId:"request",projectId:"project",sessionId:"session"};
it("requires task descriptions, threshold, language and pinned model",()=>{
  expect(decisionRequestSchema.parse(request).threshold).toBe(-5.25);
  for(const fields of [{threshold:undefined},{threshold:Infinity},{threshold:101},{labels:[{id:"sports",description:"sports"}]},{language:"zh"},{text:"这是文本"},{modelId:"text-generator"},{labels:[input.labels[0],input.labels[0]]},{rules:[{contains:"Paris",label:"missing"}]}])expect(decisionRequestSchema.safeParse({...request,...fields}).success).toBe(false);
});
const record={schemaVersion:"blocky.decision-record/v1",requestId:"request",projectId:"project",sessionId:"session",modelId:decisionModelId,modelVersion:"a".repeat(40),modelSha256:"b".repeat(64),label:"unknown",mode:"fallback",scoreKind:"none",score:null,candidateScores:[],threshold:-5.25,inferenceMs:12,backendInvoked:true,experimental:true,scoreMeaning:"relevance-logit-not-probability",inputPolicy:"english-pair-truncate512-logit-v1",ruleIndex:null,errorCode:"BLK-EMBED-MISSING"};
it("records missing backend as controlled fallback and rejects probability claims",()=>{
  expect(decisionRecordSchema.parse(record).errorCode).toBe("BLK-EMBED-MISSING");
  for(const fields of [{scoreKind:"probability"},{experimental:false},{mode:"model",errorCode:null},{score:Infinity},{mode:"rule",backendInvoked:false,ruleIndex:0}])expect(decisionRecordSchema.safeParse({...record,...fields}).success).toBe(false);
});
it("cancellation prevents port execution",async()=>{
  let called=false;const service=new NativeDecision(async()=>{called=true;throw new Error("unexpected");},"project","session");const cancel=new AbortController();cancel.abort();
  await expect(service.infer(input,cancel.signal)).rejects.toThrow();expect(called).toBe(false);
});
it("binds results to current request and preserves noninteger thresholds",async()=>{
  const service=new NativeDecision(async r=>({...record,requestId:r.requestId,threshold:r.threshold}),"project","session");expect((await service.infer({...input,threshold:-0.1},new AbortController().signal)).threshold).toBe(-0.1);
  const wrong=new NativeDecision(async()=>record,"project","session");await expect(wrong.infer(input,new AbortController().signal)).rejects.toThrow("BLK-DECISION-INVALID");
});
