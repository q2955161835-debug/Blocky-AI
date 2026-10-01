// @vitest-environment jsdom
import { expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { createStarter } from "../../packages/test-fixtures/src";
import { createSettings, resolveSetting } from "../../packages/settings-core/src";
import { useSettings } from "../../apps/studio-desktop/src/composition/useSettings";
const state=vi.hoisted(()=>({writes:[] as any[],release:undefined as undefined|(()=>void)}));
vi.mock("../../apps/studio-desktop/src/composition/userState",()=>({
  readUserState:vi.fn(async()=>createSettings("app")),
  writeUserState:vi.fn(async(_kind:string,_id:string,value:any)=>{state.writes.push(value);if(state.writes.length===1)await new Promise<void>(r=>{state.release=r;});}),
}));
afterEach(cleanup);
it("preserves both default and preference changes while the first save is pending",async()=>{
  const hook=renderHook(()=>useSettings(createStarter(),{} as any,()=>{}));
  await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  act(()=>hook.result.current.change("app","models.defaultResourceId","chosen-model"));
  await waitFor(()=>expect(state.release).toBeTypeOf("function"));
  act(()=>hook.result.current.change("app","ui.reduceMotion",true));
  await act(async()=>{state.release!();await hook.result.current.flush();});
  expect(state.writes.at(-1).values["models.defaultResourceId"]).toBe("chosen-model");
  expect(resolveSetting("models.defaultResourceId",hook.result.current.layers).value).toBe("chosen-model");
  expect(resolveSetting("ui.reduceMotion",hook.result.current.layers).value).toBe(true);
});
