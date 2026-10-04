import { duration,stageLabels } from './scenario';
export function GuidedControls({elapsed,status,pause,resume,replay,close,continueEditing}:{elapsed:number;status:'playing'|'paused'|'complete';pause():void;resume():void;replay():void;close():void;continueEditing():void}) {
  const stage=elapsed<36?0:elapsed<58?1:2;
  const seconds=Math.floor(elapsed);
  return <section className="guided-controls" aria-label="工作助手演示控制" data-playback={status}>
    <div className="guided-progress" style={{width:`${elapsed/duration*100}%`}}/>
    <div className="guided-step"><span className="guided-play-icon" aria-hidden="true">{status==='complete'?'✓':'▶'}</span><strong>{stageLabels[stage]}</strong><span className="guided-preset">预设模拟</span></div>
    <span className="guided-time" data-no-translate="">{`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} / 01:00`}</span>
    <div className="guided-buttons">
      {status!=='complete'?<button aria-label={status==='paused'?'继续演示':'暂停演示'} onClick={status==='paused'?resume:pause}>{status==='paused'?'继续':'暂停'}</button>:<button onClick={continueEditing}>继续编辑</button>}
      <button aria-label="重新播放完整演示" onClick={replay}>重播</button><button aria-label="退出完整演示" onClick={close}>×</button>
    </div>
  </section>;
}
