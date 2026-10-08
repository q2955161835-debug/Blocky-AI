// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {useStudio} from "../../apps/studio-desktop/src/composition/useStudio";
import {Runtime} from "../../packages/runtime-core/src";
import {createStarter} from "../../packages/test-fixtures/src";
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
it("takes the current saved Agent reasoning choice when a user starts execution",async()=>{
 const run=vi.spyOn(Runtime.prototype,"run").mockResolvedValue({status:"completed",answer:"answer",citations:[],events:[],modelApiCalled:false});
 const hook=renderHook(()=>useStudio(createStarter()));
 await waitFor(()=>expect(hook.result.current.canRun && hook.result.current.settings.ui.ready).toBe(true));
 await act(()=>hook.result.current.settings.ui.change("agentReasoningEffort","high"));
 await act(()=>hook.result.current.run());
 expect(run.mock.calls[0][3]?.reasoningEffort).toBe("high");
 await act(()=>hook.result.current.settings.ui.change("agentReasoningEffort","none"));
 await act(()=>hook.result.current.run());expect(run.mock.calls[1][3]?.reasoningEffort).toBe("none");
});
