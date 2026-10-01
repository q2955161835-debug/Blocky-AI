import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {NativeMedia,mediaMetadataSchema,mediaResultSchema,type MediaMetadata,type MediaResult} from '@blocky/runtime-core';
import {studioAgentServices} from '../composition/agent';
export function MediaPanel({projectId,call=invoke}:{projectId:string;call?:typeof invoke}) {
 const [media,setMedia]=useState<MediaMetadata[]>([]),[message,setMessage]=useState(''),[text,setText]=useState(''),[image,setImage]=useState(''),[busy,setBusy]=useState(false),[picker,setPicker]=useState(false);
 const active=useRef<AbortController|null>(null),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort();};},[]);
 async function operate(action:'list'|'transcribe'|'delete',item?:MediaMetadata){if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');const services=studioAgentServices();
  try{const result=await new NativeMedia(services.media!,projectId,`media-panel-${crypto.randomUUID()}`).request({action,...(item?{mediaId:item.mediaId,expectedSha256:item.sha256,expectedVersion:item.version}:{})},controller.signal);if(alive.current&&!controller.signal.aborted)consume(result);}
  catch(e){if(alive.current)setMessage(e instanceof Error&&/^BLK-/.test(e.message)?e.message:'媒体操作未完成。');}
  finally{try{await services.close?.(controller.signal);}finally{active.current=null;if(alive.current)setBusy(false);}}
 }
 function consume(r:MediaResult){if('media'in r)setMedia(r.media);if('deleted'in r){setMedia(old=>old.filter(x=>x.mediaId!==r.mediaId));setImage('');setText('');}if('transcript'in r)setText(r.transcript.segments.map(s=>`[${s.fromMs}–${s.toMs} ms] ${s.text}`).join('\n'));}
 async function importFile(){if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setPicker(true);
  try{const r=mediaResultSchema.parse(await call('agent_media_import',{projectId,sessionId:`media-panel-${crypto.randomUUID()}`}));if(alive.current&&!controller.signal.aborted&&'metadata'in r)setMedia(old=>[...old.filter(x=>x.mediaId!==r.metadata.mediaId),r.metadata]);}
  catch(e){if(alive.current)setMessage(typeof e==='string'&&/^BLK-/.test(e)?e:'媒体未导入。');}finally{active.current=null;if(alive.current){setBusy(false);setPicker(false);}}
 }
 async function preview(item:MediaMetadata){if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);let token:string|undefined;
  try{const sessionId=`media-preview-${crypto.randomUUID()}`;token=(await call<{token:string}>('agent_memory_authorize',{projectId,sessionId})).token;controller.signal.throwIfAborted();const r=await call<{metadata:unknown;dataUrl:unknown}>('agent_media_preview',{token,request:{schemaVersion:'blocky.media-request/v1',requestId:`media-${crypto.randomUUID()}`,projectId,sessionId,action:'image-reference',mediaId:item.mediaId,expectedSha256:item.sha256,expectedVersion:item.version}});mediaMetadataSchema.parse(r.metadata);if(typeof r.dataUrl!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(r.dataUrl))throw Error('BLK-MEDIA-INVALID');if(alive.current&&!controller.signal.aborted)setImage(r.dataUrl);}
  catch(e){if(alive.current)setMessage(e instanceof Error&&/^BLK-/.test(e.message)?e.message:'图片预览未完成。');}finally{try{if(token)await call('agent_memory_cancel',{token});}finally{active.current=null;if(alive.current)setBusy(false);}}
 }
 return <section aria-label="项目媒体"><h3>项目媒体</h3><button disabled={busy} onClick={()=>void importFile()}>导入图片或音频</button><button disabled={busy} onClick={()=>void operate('list')}>刷新媒体</button><p>PNG/JPEG 最大8MiB；音频使用单声道16kHz PCM WAV，最长120秒。每项目最多64MiB；媒体保留在本机，需主动删除。</p><ul>{media.map(item=><li key={item.mediaId}><strong>{item.mediaId}</strong> · {item.mimeType} · {item.byteLength} bytes<p>SHA256：{item.sha256} · 版本{item.version}</p>{item.mimeType.startsWith('image/')?<button disabled={busy} onClick={()=>void preview(item)}>预览图片</button>:<button disabled={busy} onClick={()=>void operate('transcribe',item)}>转写音频</button>}<button disabled={busy} onClick={()=>void operate('delete',item)}>删除</button></li>)}</ul>{image&&<img src={image} alt="项目媒体预览" style={{maxWidth:'100%',maxHeight:320}}/>}{text&&<textarea aria-label="音频转写结果" readOnly value={text}/>} {busy&&!picker&&<button onClick={()=>active.current?.abort()}>停止</button>}{message&&<p role="status">{message}</p>}</section>;
}
