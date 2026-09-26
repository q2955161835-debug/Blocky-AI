import {readFile,mkdir,copyFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,join,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export async function installBrowser(target) {
  const directory=resolve(target);
  if(!directory.startsWith(root+sep))throw Error("Browser runtime must stay inside project");
  const locked=await readFile(join(root,"packages/rpa-core/runtime-lock.json"),"utf8");
  const manifest=JSON.parse(locked);
  if(await readFile(join(root,"try/stage7/browser-runtime/manifest.json"),"utf8")!==locked)throw Error("Browser runtime manifest mismatch");
  const out=join(directory,"browser");
  for(const file of manifest.files) {
    if(!file.name.split("/").every(part=>part!=="."&&part!==".."&&/^[\w.-]+$/.test(part)))throw Error("Browser runtime path invalid");
    const source=join(root,"try/stage7/browser-runtime",file.name),destination=join(out,file.name);
    const bytes=await readFile(source);
    if(bytes.length!==file.bytes||createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw Error("Browser runtime source mismatch");
    await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);
    if(createHash("sha256").update(await readFile(destination)).digest("hex")!==file.sha256)throw Error("Browser runtime installation mismatch");
  }
  await copyFile(join(root,"try/stage7/browser-runtime/manifest.json"),join(out,"manifest.json"));
}
