// Synthetic data only; verifies process transfer, not native custody or GUI integration.
import { Runtime } from "../src";
let text = "";
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
const runtime = new Runtime({ sessionState: request.state });
const result = await runtime.run(request.project, "on-event", request.input);
process.stdout.write(
  JSON.stringify({ result, state: runtime.captureSession() }),
);
