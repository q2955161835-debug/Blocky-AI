for (const method of ["log", "warn", "error", "info", "debug"])
  console[method] = () => {};
let result;
try {
  const { createParser } = await import("./index.mjs");
  if (process.argv.length !== 4)
    result = { schemaVersion: "blocky.document-error/v1", code: "BLK-DOCUMENT-ARGUMENT" };
  else
    result = await createParser().parseFile(process.argv[2], process.argv[3]);
} catch (error) {
  result = {
    schemaVersion: "blocky.document-error/v1",
    code: /^BLK-DOCUMENT-[A-Z]+$/.test(error?.code)
      ? error.code
      : "BLK-DOCUMENT-INVALID",
  };
}
process.stdout.write(JSON.stringify(result) + "\n");
