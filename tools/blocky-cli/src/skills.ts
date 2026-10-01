import {skillRequestSchema} from '@blocky/runtime-core';
import {allow,required,type Args} from './arguments';
import {readJsonArtifact} from './artifacts';
import {nativeUserOperation} from './native-store';
import {CliError,envelope} from './protocol';
import {resolve} from 'node:path';
export const skillHelp=['skill prepare --directory <package-dir> --project <id> --session <id> --json','skill preflight --request <skill-request.json> --json','skill execute --request <skill-request.json> --approve <sha256> --json'];
export async function skillCommand(args:Args,signal:AbortSignal) {
 if(args.words[0]!=='skill')return;const action=args.words[1];
 if(action==='prepare') {allow(args,['directory','project','session','json'],2);const request={directory:resolve(required(args,'directory')),projectId:required(args,'project'),sessionId:required(args,'session')};return {code:0,result:envelope('skill.prepare',await nativeUserOperation('agent-skill-prepare',{request},signal))};}
 if(!['preflight','execute'].includes(action))throw new CliError(2,'BLK-CLI-002','Skill 命令不存在。','运行 command list --query skill。');
 allow(args,['request','json',...(action==='execute'?['approve']:[])],2);
 const parsed=skillRequestSchema.safeParse(await readJsonArtifact(required(args,'request'),12*1024*1024));if(!parsed.success)throw new CliError(3,'BLK-SKILL-INVALID','Skill 请求无效。','运行 schema show blocky.skill-request/v1；先发现当前摘要再加载或卸载。');
 const fields:Record<string,unknown>={request:parsed.data};if(action==='execute'){const requestDigest=required(args,'approve');if(!/^[a-f0-9]{64}$/.test(requestDigest))throw new CliError(2,'BLK-CLI-002','审批摘要无效。');fields.approval={approved:true,requestDigest};}
 return {code:0,result:envelope(`skill.${action}`,await nativeUserOperation(action==='execute'?'agent-skill':'agent-skill-preflight',fields,signal))};
}
