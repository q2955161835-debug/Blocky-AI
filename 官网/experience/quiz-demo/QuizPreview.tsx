import { useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../DemoChatPanel';
import { UiIcon } from '../../../apps/studio-desktop/src/app/UiIcon';
import { translate } from '../../dist/preferences.js';
import { questions, explanationPrompt, followupPrompt } from './content';
import { useDemoFollow } from './useDemoFollow';

export function QuizPreview({ count, answers, messages, playing, generating, selectedIndex, onAnswer, onGenerate, onSend }: {
  count:number; answers:Record<number,number>; messages:Message[]; playing:boolean; generating:boolean; selectedIndex:number;
  onAnswer(index:number,answer:number):void; onGenerate():void; onSend(text:string):void;
}) {
  const [draft,setDraft]=useState('');
  const thread=useRef<HTMLDivElement>(null),list=useRef<HTMLDivElement>(null);
  const changeToken=messages.map(item=>item.text).join('|');
  useDemoFollow(thread,true,changeToken);
  useLayoutEffect(()=>{
    const container=list.current;
    const index=selectedIndex>=0?selectedIndex:count-1;
    const card=container?.querySelector<HTMLElement>(`[data-question="${index}"]`);
    if(container&&card)container.scrollTop+=card.getBoundingClientRect().top-container.getBoundingClientRect().top-14;
  },[count,selectedIndex]);
  const submit=(text=draft)=>{if(playing||!text.trim())return;onSend(text.trim());setDraft('');};
  return <section className="quiz-preview" aria-label="今日练习页面">
    <header className="quiz-hero"><div><span className="quiz-eyebrow">四年级数学 · 分数</span><h1>今日练习<span aria-hidden="true">✦</span></h1><p>把每一个小问题，变成一次新发现。</p></div><span className="quiz-source">参考资料：分数入门</span></header>
    <div className="quiz-preview-layout">
      <section className="quiz-exercises" aria-label="练习题">
        <div className="quiz-actionbar"><button className="quiz-primary" disabled={playing} onClick={onGenerate} data-active={generating}><span aria-hidden="true">{generating?'◌':'✦'}</span>生成今日小测</button><button disabled={playing} onClick={onGenerate}>同类练习</button><span className="quiz-count" data-no-translate="">{count} / 5</span></div>
        <div className="quiz-progress-track" aria-label="出题进度"><span style={{width:`${count*20}%`}}/></div>
        <div className="quiz-question-list" ref={list}>
          {!count&&<div className="quiz-empty"><div className="quiz-empty-art" aria-hidden="true"><i/><i/><i/><i/><i/></div><h2>{generating?'正在准备第一道题':'准备好，来一次小练习'}</h2><p>五道小题，从理解分数到解决问题。</p><div className="quiz-topics">{questions.map(item=><span key={item.topic}>{item.topic}</span>)}</div></div>}
          {questions.slice(0,count).map((item,index)=>{
            const selected=answers[index];
            return <article className="quiz-card" key={index} data-question={index} data-selected={selectedIndex===index}>
              <div className="quiz-card-heading"><span className="quiz-number" data-no-translate="">{String(index+1).padStart(2,'0')}</span><span>{item.topic}</span>{selected!==undefined&&<small>{selected===item.answer?'回答正确':'再想一想'}</small>}</div>
              <h3>{item.question}</h3>
              <div className="quiz-options">{item.options.map((option,answer)=><button key={answer} aria-pressed={selected===answer} className={selected!==undefined&&answer===item.answer?'correct':selected===answer?'wrong':''} onClick={()=>onAnswer(index,answer)}><b data-no-translate="">{'ABCD'[answer]}</b><span>{option}</span></button>)}</div>
              {selected!==undefined&&<div className="quiz-explanation"><strong>一起看解析</strong><p>{item.explanation}</p><div className="quiz-fraction" aria-label={translate('分数图示')}><div className="quiz-fraction-bar" style={{gridTemplateColumns:`repeat(${item.denominator},1fr)`}}>{Array.from({length:item.denominator},(_,i)=><i key={i} className={i<item.numerator?'filled':''}/>)}</div><span data-no-translate="">{item.numerator}/{item.denominator}</span></div></div>}
            </article>;
          })}
          {generating&&count>0&&count<5&&<div className="quiz-next"><span/>正在准备下一道题</div>}
        </div>
        <footer className="quiz-exercise-footer"><span>{count===5?'五个知识点，逐个掌握。':'从资料出发，循序渐进。'}</span><span>点选选项，查看解析</span></footer>
      </section>
      <aside className="quiz-page-chat" aria-label="作品页面聊天">
        <header><span className="quiz-avatar" aria-hidden="true">B</span><div><h2>和出题助手交流</h2><span><i/>围绕当前练习继续提问</span></div></header>
        <div className="quiz-chat-scroll" ref={thread} role="log" aria-live="polite"><div className="quiz-chat-inner"><div className="quiz-chat-welcome"><strong>你好，今天一起学分数。</strong><p>有不理解的地方，可以随时追问。</p></div>{messages.map((message,index)=><div key={index} className={`quiz-chat-bubble ${message.role}`}><small>{message.role==='user'?'你':'出题助手'}</small><p data-no-translate="">{message.text}</p></div>)}</div></div>
        <div className="quiz-chat-bottom"><div className="quiz-chat-suggestions"><button disabled={playing} onClick={()=>submit(explanationPrompt)}>解释第 2 题</button><button disabled={playing} onClick={()=>submit(followupPrompt)}>用图讲解</button></div><form onSubmit={event=>{event.preventDefault();submit();}}><textarea aria-label="练习页面提问" placeholder={translate('继续提问或调整难度…')} value={draft} disabled={playing} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();submit();}}}/><button type="submit" aria-label="发送提问" disabled={playing||!draft.trim()}><UiIcon name="send"/></button></form><small>和 Studio 共享同一段对话</small></div>
      </aside>
    </div>
  </section>;
}
