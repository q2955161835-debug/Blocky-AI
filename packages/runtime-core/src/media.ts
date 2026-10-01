import { z } from 'zod';
import { stableId,type Json } from '@blocky/language-schema';
const id=z.string().max(128).regex(stableId),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const mediaMetadataSchema=z.object({mediaId:id,version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sha256:hash,mimeType:z.enum(['image/png','image/jpeg','audio/wav']),byteLength:z.number().int().positive().max(8*1024*1024),width:z.number().int().positive().max(8192).optional(),height:z.number().int().positive().max(8192).optional(),durationMs:z.number().int().positive().max(120000).optional()}).strict();
export type MediaMetadata=z.infer<typeof mediaMetadataSchema>;
export const mediaRequestSchema=z.object({schemaVersion:z.literal('blocky.media-request/v1'),requestId:id,projectId:id,sessionId:id,action:z.enum(['list','summary','delete','transcribe','image-reference']),mediaId:id.optional(),expectedSha256:hash.optional(),expectedVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict().superRefine((r,c)=>{const exists=r.action!=='list';if(exists!==Boolean(r.mediaId)||exists!==Boolean(r.expectedSha256)||exists!==(r.expectedVersion!==undefined))c.addIssue({code:'custom',message:'BLK-MEDIA-INVALID'});});
export type MediaRequest=z.infer<typeof mediaRequestSchema>;
export type MediaPort=(request:MediaRequest,signal:AbortSignal)=>Promise<Json>;
export const mediaResultSchema=z.union([z.object({media:z.array(mediaMetadataSchema).max(128)}).strict(),z.object({metadata:mediaMetadataSchema}).strict(),z.object({deleted:z.literal(true),mediaId:id,version:z.number().int().positive()}).strict(),z.object({metadata:mediaMetadataSchema,transcript:z.object({language:z.string().max(64),segments:z.array(z.object({text:z.string().max(32768),fromMs:z.number().int().nonnegative(),toMs:z.number().int().nonnegative()}).strict()).max(4096)}).strict()}).strict()]);
export type MediaResult=z.infer<typeof mediaResultSchema>;
export class NativeMedia {
 constructor(private port:MediaPort,private projectId:string,private sessionId:string){}
 async request(input:Omit<MediaRequest,'schemaVersion'|'requestId'|'projectId'|'sessionId'>,signal:AbortSignal):Promise<MediaResult>{signal.throwIfAborted();const r=mediaRequestSchema.parse({...input,schemaVersion:'blocky.media-request/v1',requestId:`media-${crypto.randomUUID()}`,projectId:this.projectId,sessionId:this.sessionId});const result=mediaResultSchema.parse(await this.port(r,signal));signal.throwIfAborted();if('metadata'in result&&r.mediaId&&(result.metadata.mediaId!==r.mediaId||result.metadata.sha256!==r.expectedSha256||result.metadata.version!==r.expectedVersion))throw Error('BLK-MEDIA-INTEGRITY');return result;}
}
