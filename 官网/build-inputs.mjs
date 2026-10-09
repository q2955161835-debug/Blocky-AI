import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Version 22 was accepted against these shared editor inputs. Keep its static
// build reproducible while the desktop changes remain on their own branch.
export async function quizBuildInputs() {
  const directory=fileURLToPath(new URL('./build-inputs/quiz-v22/',import.meta.url));
  const root=path.resolve(directory,'../../..');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  const inputs=new Map();
  for(const item of manifest.files) {
    if(!/^packages\/(ui-editor\/src\/(blocks\.ts|canvas\/(Canvas\.tsx|canvas\.css))|block-catalog\/src\/agent-primitives\.json)$/.test(item.modulePath)||path.basename(item.snapshot)!==item.snapshot)throw Error('Invalid website build input');
    const contents=await fs.readFile(path.join(directory,item.snapshot));
    if(createHash('sha256').update(contents).digest('hex')!==item.sha256)throw Error(`Website build input changed: ${item.modulePath}`);
    const absolute=path.resolve(root,item.modulePath);
    inputs.set(absolute,{contents:contents.toString('utf8'),loader:path.extname(absolute).slice(1),resolveDir:path.dirname(absolute)});
  }
  return {name:'quiz-v22-shared-inputs',setup(build){build.onLoad({filter:/\.(ts|tsx|json|css)$/},args=>inputs.get(path.resolve(args.path)));}};
}
