import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
await build({entryPoints:[root+'art/main.js'],outfile:root+'dist/art3d.js',bundle:true,format:'esm',target:'es2022',minify:true,legalComments:'eof',sourcemap:false});
await mkdir(root+'dist/art',{recursive:true});
await copyFile(root+'art/node_modules/three/LICENSE',root+'dist/art/THREE-LICENSE.txt');
console.log('Blocky art built: local geometry, one renderer, no remote assets.');
