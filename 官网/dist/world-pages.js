import {fullSceneSections} from './scenes.js';
import {mountPreferenceControls,translate,subscribePreferences} from './preferences.js';

const stops={education:['校园全景','学习空间','课堂工坊','学校中心','植物项目'],professional:['园区全景','组合实验室','调试观察站','交付中心','研究工作台']};

export function mountWorldPage(container,type){
  const education=type==='education',name=education?'积木校园':'创作园区';
  const source=document.createElement('template');source.innerHTML=fullSceneSections();
  const section=source.content.querySelector(`#${type}`),hero=section.querySelector('.scene-hero'),features=[...section.querySelectorAll('.scene-features>article')],example=section.querySelector('.scene-example');
  const overview=document.createElement('div');overview.innerHTML=hero.innerHTML;
  const h2=overview.querySelector('h2'),h1=document.createElement('h1');h1.innerHTML=h2.innerHTML;h2.replaceWith(h1);
  const content=[overview.innerHTML,...features.map(a=>a.innerHTML),example.innerHTML];
  if(!education){const extra=[...section.querySelectorAll('.professional-extensions article')];content[3]+=extra[0].innerHTML;content[4]+=extra[1].innerHTML;}
  content[4]+=`<div class="story-tags">${section.querySelector('.scene-bottom').innerHTML}</div><div class="story-ending"><a href="#/${education?'professional':'education'}">${education?'探索专业场景':'探索教育场景'}</a><a href="#access">了解开放进度</a></div>`;
  container.innerHTML=`<header class="site-header world-header"><a class="world-back" href="#${type}">返回官网</a><nav aria-label="主导航"><a href="#possibilities">产品能力</a><a href="#blueprints">起始蓝图</a><a href="#/education">教育场景</a><a href="#/professional">专业场景</a></nav><div class="header-actions"><button type="button" class="reading-toggle" aria-pressed="false">阅读全部</button><div id="world-preferences"></div></div></header>
    <main class="world-tour" data-progress="0"><div class="story-stage" aria-hidden="true"></div><div class="story-connector" aria-hidden="true"></div><div class="story-scroll-cue">向下滚动，沿着作品探索<span aria-hidden="true">↓</span></div>${content.map((html,i)=>`<section class="story-chapter" id="${type}-chapter-${i}"><article class="story-card" data-chapter="${i}"><div class="story-location"><span>${String(i+1).padStart(2,'0')} / 05</span><span>${stops[type][i]}</span></div>${html}</article></section>`).join('')}</main>
    <nav class="story-nav" aria-label="场景章节">${stops[type].map((label,i)=>`<button type="button" data-stop="${i}" aria-current="${i===0?'step':'false'}"><span>${String(i+1).padStart(2,'0')}</span><span>${label}</span></button>`).join('')}</nav>`;
  for(const node of container.querySelectorAll('.story-card [id]'))node.removeAttribute('id');
  const unmountPreferences=mountPreferenceControls(container.querySelector('#world-preferences'));
  const tour=container.querySelector('.world-tour'),stage=container.querySelector('.story-stage'),cards=[...container.querySelectorAll('.story-card')],buttons=[...container.querySelectorAll('[data-stop]')],toggle=container.querySelector('.reading-toggle'),connector=container.querySelector('.story-connector'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let art,reading=false,requestedReading=false,index=0,raf=0;
  function update(){
    raf=0;
    const span=Math.max(1,tour.scrollHeight-innerHeight);
    const progress=reading?0:Math.max(0,Math.min(4,scrollY/span*4));tour.dataset.progress=String(progress);
    index=reading?Math.max(0,cards.findIndex(card=>{const r=card.getBoundingClientRect();return r.top<=innerHeight*.4&&r.bottom>=innerHeight*.4;})):Math.round(progress);
    cards.forEach((card,i)=>{card.classList.toggle('is-active',reading||i===index);card.setAttribute('aria-hidden',String(!reading&&i!==index));});
    buttons.forEach((button,i)=>button.setAttribute('aria-current',i===index?'step':'false'));art?.refresh();
  }
  function scroll(){if(!raf)raf=requestAnimationFrame(update);}
  function setReading(){
    reading=requestedReading||reduced.matches||document.body.classList.contains('art-unavailable');
    tour.classList.toggle('reading',reading);container.classList.toggle('is-reading',reading);toggle.setAttribute('aria-pressed',String(reading));toggle.disabled=reduced.matches||document.body.classList.contains('art-unavailable');update();
  }
  function go(event){const button=event.target.closest('[data-stop]');if(!button)return;const stop=Number(button.dataset.stop);if(reading)cards[stop].scrollIntoView({behavior:'auto',block:'start'});else window.scrollTo({top:(tour.scrollHeight-innerHeight)*stop/4,behavior:reduced.matches?'auto':'smooth'});}
  function read(){requestedReading=!requestedReading;setReading();window.scrollTo({top:0,behavior:'instant'});}
  function projection(point){
    if(reading)return;
    const card=cards[index],w=card.offsetWidth,h=card.offsetHeight;
    const x=innerWidth<700?16:innerWidth-w-Math.max(36,innerWidth*.04);
    const y=innerWidth<700?Math.max(140,innerHeight-h-105):Math.max(150,Math.min(innerHeight-h-115,innerHeight*.26));
    card.style.left=`${x}px`;card.style.top=`${y}px`;
    tour.dataset.copyTop=String(y);tour.style.setProperty('--copy-y',`${y}px`);
    stage.style.height=innerWidth<700?`${Math.max(64,y-112)}px`:'';
    const endX=innerWidth<700?Math.max(x+25,Math.min(x+w-25,point.x)):x+15,endY=y+22,dx=endX-point.x,dy=endY-point.y;
    connector.style.left=`${point.x}px`;connector.style.top=`${point.y}px`;connector.style.width=`${Math.hypot(dx,dy)}px`;connector.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;
  }
  function attachArt(value){art=value;art?.enter(stage,type,projection);update();}
  container.querySelector('.story-nav').addEventListener('click',go);toggle.addEventListener('click',read);
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',scroll);window.addEventListener('blocky-art-unavailable',setReading);reduced.addEventListener('change',setReading);
  const unsubscribe=subscribePreferences(()=>{update();});setReading();
  return {name,stage,attachArt,dispose(){cancelAnimationFrame(raf);art?.leave();unsubscribe();unmountPreferences();window.removeEventListener('scroll',scroll);window.removeEventListener('resize',scroll);window.removeEventListener('blocky-art-unavailable',setReading);reduced.removeEventListener('change',setReading);container.replaceChildren();}};
}
