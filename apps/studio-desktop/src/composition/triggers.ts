import {invoke} from '@tauri-apps/api/core';
import {createTriggerClient,createTriggerReceiverClient,type TriggerRequest} from '@blocky/runtime-core';

/** Native consent and receiver lifetime stay outside the work's Runtime. */
export function studioTriggers(projectId:string) {
 const sessionId=`trigger-ui-${crypto.randomUUID()}`;
 let token:string|undefined,pending:Promise<string>|undefined,closed=false;
 async function authorization(signal?:AbortSignal){
  signal?.throwIfAborted();if(closed)throw Error('BLK-TRIGGER-CLOSED');
  if(token)return token;
  pending??=invoke<{token:string}>('agent_memory_authorize',{projectId,sessionId}).then(async value=>{
   if(closed){await invoke('agent_memory_cancel',{token:value.token});throw Error('BLK-TRIGGER-CLOSED');}
   token=value.token;return token;
  }).finally(()=>{pending=undefined;});
  const result=await pending;signal?.throwIfAborted();return result;
 }
 async function send(request:TriggerRequest,signal?:AbortSignal){const token=await authorization(signal);signal?.throwIfAborted();return invoke('agent_trigger',{token,request});}
 return {
  client:createTriggerClient({projectId,sessionId,send}),
  receivers:createTriggerReceiverClient({projectId,sessionId,send:async(request,signal)=>{const token=await authorization(signal);signal?.throwIfAborted();return invoke('agent_trigger_receiver',{token,request});}}),
  async receiver(fields:Record<string,unknown>,signal?:AbortSignal){const token=await authorization(signal);signal?.throwIfAborted();return invoke('agent_trigger_receiver',{token,request:{schemaVersion:'blocky.trigger-receiver-request/v1',requestId:`trigger-${crypto.randomUUID()}`,projectId,sessionId,...fields}});},
  async close(){closed=true;await pending?.catch(()=>{});if(token){const owned=token;token=undefined;await invoke('agent_memory_cancel',{token:owned});}},
 };
}
