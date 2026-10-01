import {resolve} from 'node:path';
import {mediaRequestSchema,decisionRequestSchema,evaluationAssetRequestSchema} from '@blocky/runtime-core';
import {allow,required,type Args} from './arguments';
import {nativeUserOperation} from './native-store';
import {readJsonArtifact} from './artifacts';
import {CliError,envelope} from './protocol';
export const nativeCapabilitiesHelp=[
 'media import-preflight --path <file.png|jpg|wav> --project <id> --session <id> --request-id <id> --json',
 'media import --path <file.png|jpg|wav> --project <id> --session <id> --request-id <id> --approve <sha256> --json',
 ...['media','decision','evaluation'].flatMap(kind=>[`${kind} preflight --request <request.json> --json`,`${kind} execute --request <request.json> --approve <sha256> --json`]),
];
export async function nativeCapabilitiesCommand(args:Args,signal:AbortSignal){
 const [kind,action]=args.words;if(!['media','decision','evaluation'].includes(kind))return;
 if(kind==='evaluation'&&!['preflight','execute'].includes(action))return;
 const importing=kind==='media'&&['import','import-preflight'].includes(action),execute=action==='execute'||action==='import';
 if(!importing&&!['preflight','execute'].includes(action))throw new CliError(2,'BLK-CLI-002','本机能力命令不存在。');
 allow(args,[...(importing?['path','project','session','request-id']:['request']),'json',...(execute?['approve']:[])],2);
 let request:unknown;
 if(importing)request={path:resolve(required(args,'path')),projectId:required(args,'project'),sessionId:required(args,'session'),requestId:required(args,'request-id')};
 else {const schema=kind==='media'?mediaRequestSchema:kind==='decision'?decisionRequestSchema:evaluationAssetRequestSchema;const parsed=schema.safeParse(await readJsonArtifact(required(args,'request'),kind==='evaluation'?9*1024*1024:65536));if(!parsed.success)throw new CliError(3,'BLK-CLI-003','请求不符合能力 Schema。');request=parsed.data;}
 const fields:Record<string,unknown>={request};if(execute){const d=required(args,'approve');if(!/^[a-f0-9]{64}$/.test(d))throw new CliError(2,'BLK-CLI-002','审批摘要无效。');fields.approval={approved:true,requestDigest:d};}
 const operation=`agent-${kind}${importing?'-import':''}${execute?'':'-preflight'}`;
 return {code:0,result:envelope(`${kind}.${action}`,await nativeUserOperation(operation,fields,signal))};
}
