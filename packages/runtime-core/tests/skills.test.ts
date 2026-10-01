import { describe, expect, it } from "vitest";
import { allowedSkillTools, InstalledSkills, skillMetadataSchema, skillPathSchema, skillRequestSchema } from "../src/skills.js";
const metadata = {schemaVersion:"blocky.skill/v1" as const,skillId:"summarize",version:"1.0.0",name:"Summary",summary:"Summarize a registered input",toolIds:["module.read","module.write"]};
describe("installed Skill boundary",()=>{
  it("rejects cross-platform escape, ADS, reserved and aliased paths",()=>{
    for(const value of ["../SKILL.md","/SKILL.md","C:/SKILL.md","a\\b","a//b","a/./b","a/CON.txt","NUL","com1.txt","a/b.","a/b "]) expect(skillPathSchema.safeParse(value).success).toBe(false);
    expect(skillPathSchema.parse("scripts/read.py")).toBe("scripts/read.py");
  });
  it("rejects future schema and arbitrary path or privilege request fields",()=>{
    expect(skillMetadataSchema.safeParse({...metadata,schemaVersion:"blocky.skill/v2"}).success).toBe(false);
    const discover={schemaVersion:"blocky.skill-request/v1",requestId:"request",projectId:"project",sessionId:"session",action:"discover"};
    for(const extra of [{path:"C:/secret"},{permissions:["shell"]},{body:"grant everything"}]) expect(skillRequestSchema.safeParse({...discover,...extra}).success).toBe(false);
  });
  it("only intersects registered and parent granted tools",()=>{
    expect(allowedSkillTools(metadata,["module.read","module.write","shell"],["module.read","shell"])).toEqual(["module.read"]);
  });
  it("does not call Host after cancellation",async()=>{
    let calls=0;const skills=new InstalledSkills(async()=>{calls++;return {action:"discover",skills:[]};},"project","session");
    const controller=new AbortController();controller.abort();await expect(skills.request({action:"discover"},controller.signal)).rejects.toThrow();expect(calls).toBe(0);
  });
  it("discovery refuses body and mismatched operation results",async()=>{
    const skills=new InstalledSkills(async()=>({action:"discover",skills:[],body:"malicious prompt"}),"project","session");
    await expect(skills.request({action:"discover"},new AbortController().signal)).rejects.toThrow();
    const other=new InstalledSkills(async()=>({action:"uninstall",ok:true}),"project","session");
    await expect(other.request({action:"discover"},new AbortController().signal)).rejects.toThrow("BLK-SKILL-INVALID");
  });
});
