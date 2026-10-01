// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MediaPanel} from '../../apps/studio-desktop/src/app/MediaPanel';
const mocks=vi.hoisted(()=>({media:vi.fn(),close:vi.fn(async()=>{}),invoke:vi.fn()}));
vi.mock('../../apps/studio-desktop/src/composition/agent',()=>({studioAgentServices:()=>({media:mocks.media,close:mocks.close})}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
afterEach(()=>{cleanup();vi.resetAllMocks();mocks.close.mockResolvedValue(undefined);});
const metadata={mediaId:'audio-one',sha256:'a'.repeat(64),version:1,mimeType:'audio/wav',byteLength:44,durationMs:10};
it('waits for a cancelled transcription to settle, revokes its session, and hides the late result',async()=>{
 let finish!:(result:unknown)=>void;mocks.media.mockImplementation((request)=>request.action==='list'?Promise.resolve({media:[metadata]}):new Promise(resolve=>{finish=resolve;}));
 render(<MediaPanel projectId="project-one" call={mocks.invoke}/>);fireEvent.click(screen.getByText('刷新媒体'));await screen.findByText('audio-one');await waitFor(()=>expect(mocks.close).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByText('转写音频'));await screen.findByText('停止');fireEvent.click(screen.getByText('停止'));expect(mocks.close).toHaveBeenCalledTimes(1);
 finish({metadata,transcript:{language:'en',segments:[{text:'private late result',fromMs:0,toMs:10}]}});await waitFor(()=>expect(mocks.close).toHaveBeenCalledTimes(2));expect(screen.queryByLabelText('音频转写结果')).toBeNull();expect((screen.getByText('刷新媒体') as HTMLButtonElement).disabled).toBe(false);
});
it('does not offer an ineffective stop button during the native picker and restores controls on rejection',async()=>{
 let reject!:(error:unknown)=>void;mocks.invoke.mockImplementation(()=>new Promise((_resolve,rejected)=>{reject=rejected;}));render(<MediaPanel projectId="project-one" call={mocks.invoke}/>);fireEvent.click(screen.getByText('导入图片或音频'));expect(screen.queryByText('停止')).toBeNull();expect((screen.getByText('刷新媒体') as HTMLButtonElement).disabled).toBe(true);
 reject('BLK-PERM-001');await screen.findByText('BLK-PERM-001');expect((screen.getByText('刷新媒体') as HTMLButtonElement).disabled).toBe(false);
});
it('releases a preview grant obtained after its panel was closed and never paints the image',async()=>{
 const image={...metadata,mediaId:'image-one',mimeType:'image/png',width:1,height:1};delete (image as Partial<typeof metadata>).durationMs;
 mocks.media.mockResolvedValue({media:[image]});let finish!:(result:unknown)=>void;mocks.invoke.mockImplementation(operation=>operation==='agent_memory_authorize'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(undefined));
 const view=render(<MediaPanel projectId="project-one" call={mocks.invoke}/>);fireEvent.click(screen.getByText('刷新媒体'));await screen.findByText('image-one');await waitFor(()=>expect(mocks.close).toHaveBeenCalled());fireEvent.click(screen.getByText('预览图片'));view.unmount();finish({token:'synthetic-grant'});
 await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('agent_memory_cancel',{token:'synthetic-grant'}));expect(mocks.invoke.mock.calls.some(call=>call[0]==='agent_media_preview')).toBe(false);
});
