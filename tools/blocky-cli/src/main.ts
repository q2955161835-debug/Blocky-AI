import { parse } from "./arguments";
import { dispatch } from "./commands";
import { failure } from "./protocol";
import { output } from "./output";
import { closeNativeKnowledge } from "./native-store";
const abort = new AbortController();
process.on("SIGINT", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
const write = (value: unknown) => process.stdout.write(output(value));
try {
  const args = parse(process.argv.slice(2));
  const result = await dispatch(args, write, abort.signal);
  write(result.result);
  process.exitCode = result.code;
} catch (error) {
  const result = failure("cli", error);
  write(result.result);
  process.stderr.write(
    `${result.result.error!.code}: ${result.result.error!.message}\n`,
  );
  process.exitCode = result.exitCode;
} finally {
  await closeNativeKnowledge();
}
