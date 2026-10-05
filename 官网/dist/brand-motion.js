export function mountBrandMotion(){
  const badge=document.createElement('a');badge.href='#';badge.className='brand-orbit';badge.setAttribute('aria-label','Blocky 首页');
  badge.innerHTML=`<span class="brand-avatar" aria-hidden="true"><img class="brand-flat" src="./assets/blocky.png" alt=""><span class="brand-model art-stage" data-art="brand"><img class="brand-fallback" src="./assets/blocky.png" alt=""></span></span><span class="brand-word" data-no-translate>Blocky.</span><svg class="brand-ring" viewBox="0 0 100 100" aria-hidden="true"><path d="M 30 90 A 43 43 0 1 1 70 90"/><text x="50" y="95" text-anchor="middle" data-no-translate>Blocky.</text></svg>`;
  document.body.append(badge);let frame=0;
  function update(){frame=0;const world=!!document.body.dataset.world,compact=world||document.body.classList.contains('pricing-mode')||scrollY>innerHeight*.35;
    document.body.classList.toggle('nav-compact',compact);
    const header=document.querySelector(world?'.world-header':'#website .site-header'),r=header?.getBoundingClientRect();
    const mobile=innerWidth<760,left=compact?Math.max(16,(innerWidth-1460)/2):Math.max(16,(r?.left||180)-(mobile?0:155));
    badge.style.setProperty('--brand-left',`${left}px`);badge.hidden=document.body.classList.contains('experiencing');
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);update();
  return ()=>{cancelAnimationFrame(frame);badge.remove();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('hashchange',schedule);};
}
