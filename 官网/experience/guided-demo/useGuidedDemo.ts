import { useEffect,useRef,useState } from 'react';
import { duration,timeline,type DemoAction } from './scenario';

type Playback={status:'idle'|'playing'|'paused'|'complete';elapsed:number};
export function useGuidedDemo(onAction:(action:DemoAction)=>void) {
  const [playback,setPlayback]=useState<Playback>({status:'idle',elapsed:0});
  const actionRef=useRef(onAction);actionRef.current=onAction;
  const clock=useRef({elapsed:0,last:0,index:0,status:'idle' as Playback['status']});
  const timer=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const clear=()=>{clearInterval(timer.current);timer.current=undefined;};
  function advance() {
    const value=clock.current;
    if(value.status!=='playing')return;
    const now=performance.now();value.elapsed=Math.min(duration,value.elapsed+(now-value.last)/1000);value.last=now;
    while(value.index<timeline.length&&timeline[value.index].at<=value.elapsed){actionRef.current(timeline[value.index++].action);}
    if(value.elapsed>=duration){value.status='complete';clear();}
    setPlayback({status:value.status,elapsed:value.elapsed});
  }
  function start(){clear();clock.current={elapsed:0,last:performance.now(),index:0,status:'playing'};setPlayback({status:'playing',elapsed:0});timer.current=setInterval(advance,250);}
  function pause(){advance();clear();if(clock.current.status==='complete')return;clock.current.status='paused';setPlayback({status:'paused',elapsed:clock.current.elapsed});}
  function resume(){if(clock.current.status!=='paused')return;clock.current.status='playing';clock.current.last=performance.now();setPlayback({status:'playing',elapsed:clock.current.elapsed});timer.current=setInterval(advance,250);}
  function stop(){clear();clock.current.status='idle';setPlayback({status:'idle',elapsed:0});}
  useEffect(()=>()=>clearInterval(timer.current),[]);
  return {...playback,active:playback.status!=='idle',start,pause,resume,stop};
}
