import { duration,stageLabels } from './scenario';
import { quizChapters } from '../quiz-demo/content';
export function GuidedControls({elapsed,status,pause,resume,replay,close,continueEditing,quiz=false}:{elapsed:number;status:'playing'|'paused'|'complete';pause():void;resume():void;replay():void;close():void;continueEditing():void;quiz?:boolean}) {
  const stage=elapsed<36?0:elapsed<58?1:2;
  const seconds=Math.floor(elapsed);
  const chapter=quizChapters.filter(item=>item.at<=elapsed).at(-1)!;
  return <section className={`guided-controls${quiz?' quiz-controls':''}`} aria-label={quiz?'出题助手演示控制':'工作助手演示控制'} data-playback={status}>
    <div className="guided-progress" style={{width:`${elapsed/(quiz?180:duration)*100}%`}}/>
    <div className="guided-step"><span className="guided-play-icon" aria-hidden="true">{status==='complete'?'✓':'▶'}</span><strong>{quiz?chapter.label:stageLabels[stage]}</strong><span className="guided-preset">预设模拟</span>{quiz&&<small className="quiz-chapter-detail">{chapter.detail}</small>}</div>
    <span className="guided-time" data-no-translate="">{`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} / ${quiz?'03':'01'}:00`}</span>
    <div className="guided-buttons">
      {status!=='complete'?<button aria-label={status==='paused'?'继续演示':'暂停演示'} onClick={status==='paused'?resume:pause}>{status==='paused'?'继续':'暂停'}</button>:<button onClick={continueEditing}>{quiz?'自由体验':'继续编辑'}</button>}
      <button aria-label="重新播放完整演示" onClick={replay}>重播</button><button aria-label="退出完整演示" onClick={close}>×</button>
    </div>
  </section>;
}
