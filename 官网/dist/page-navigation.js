// Remember only public homepage layout, never Studio content or user input.
const key='blocky.site.home-position.v1';
export function mountPageNavigation(){
  let page='',position=0,savedHash='',homeHash=location.hash,intent='',frame=0,restoring=false;
  try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');position=Math.max(0,Number(saved?.y??saved)||0);savedHash=saved?.hash||'';}catch{}
  history.scrollRestoration='manual';
  const back=document.createElement('a');back.href='#';back.className='subpage-return';back.hidden=true;
  back.setAttribute('aria-label','返回官网');back.innerHTML='<span aria-hidden="true">←</span><span>返回</span>';document.body.append(back);
  function remember(){if(page!=='home'||restoring)return;position=scrollY;savedHash=homeHash;try{sessionStorage.setItem(key,JSON.stringify({y:position,hash:savedHash}));}catch{}}
  window.addEventListener('scroll',remember,{passive:true});window.addEventListener('pagehide',remember);
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(!link)return;
    const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!==location.pathname)return;
    if(page==='home')remember();
    intent=url.hash&&!url.hash.startsWith('#/')?'anchor':'restore';
  },true);
  return {
    leave(next){if(page==='home'&&next!=='home')remember();cancelAnimationFrame(frame);restoring=true;page=next;if(next==='home')homeHash=location.hash;back.hidden=next==='home'||next==='studio';document.body.dataset.page=next;},
    settle(previous){
      const hash=location.hash,anchor=hash&&!hash.startsWith('#/')?document.getElementById(hash.slice(1)):null;
      const returnHome=page==='home'&&previous&&previous!=='home'&&intent!=='anchor';
      const initialHome=page==='home'&&!previous&&(!anchor||hash===savedHash);
      const goAnchor=page==='home'&&anchor&&!returnHome&&!initialHome;
      const top=returnHome||initialHome?position:0;intent='';
      if(page===previous&&!goAnchor){restoring=false;return;}
      frame=requestAnimationFrame(()=>{
        if(goAnchor)anchor.scrollIntoView({behavior:'instant',block:'start'});
        else window.scrollTo({top,behavior:'instant'});
        // Layout and translation complete before scrolling can update the saved position.
        frame=requestAnimationFrame(()=>{restoring=false;remember();});
      });
    }
  };
}
