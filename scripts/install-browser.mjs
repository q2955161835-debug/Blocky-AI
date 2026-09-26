import {installBrowser} from "./browser-runtime.mjs";
await installBrowser(process.argv[2]??"apps/studio-host/target/release");
