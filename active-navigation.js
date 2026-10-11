// Home sections and their related pages share navigation state.
export function mountActiveNavigation(){
  const ids=['possibilities','blueprints','education','professional','access'];let frame=0;
  function update(){
    frame=0;let current=document.body.classList.contains('pricing-mode')?'access':document.body.dataset.world||'';
    if(!current&&!document.body.classList.contains('experiencing')){
      const line=Math.min(innerHeight*.38,320),blueprints=document.getElementById('blueprints');
      for(const id of ids){const element=document.getElementById(id);if(!element||!element.getClientRects().length)continue;const r=element.getBoundingClientRect(),bottom=id==='possibilities'?blueprints.getBoundingClientRect().top:r.bottom;if(r.top<=line&&bottom>line)current=id;}
    }
    for(const link of document.querySelectorAll('.site-header nav a,.pricing-mobile-entry')){
      const id=link.getAttribute('href').replace(/^#\/?/,'');const active=id===current;
      link.classList.toggle('is-active',active);
      if(active)link.setAttribute('aria-current',document.body.dataset.world||document.body.classList.contains('pricing-mode')?'page':'location');else link.removeAttribute('aria-current');
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);update();
  return ()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('hashchange',schedule);};
}
