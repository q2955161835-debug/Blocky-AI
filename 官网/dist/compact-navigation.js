export function mountCompactNavigation(){
  const panel=document.createElement('nav');panel.id='compact-page-menu';panel.className='compact-page-menu';panel.hidden=true;panel.setAttribute('aria-label','主导航');
  panel.innerHTML='<a href="#possibilities">产品能力</a><a href="#blueprints">起始蓝图</a><a href="#education">教育场景</a><a href="#professional">专业场景</a><a href="#access">定价咨询</a><a href="#faq">常见问题</a><a href="#/studio">在线体验</a>';document.body.append(panel);
  let opener;
  function close(focus=false){panel.hidden=true;opener?.setAttribute('aria-expanded','false');if(focus)opener?.focus({preventScroll:true});}
  function refresh(){
    close();document.querySelectorAll('.site-header .header-actions').forEach(actions=>{
      if(actions.querySelector('.compact-menu-button'))return;
      const button=document.createElement('button');button.type='button';button.className='compact-menu-button';button.setAttribute('aria-label','打开导航');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
      button.innerHTML='<span aria-hidden="true">☰</span>';actions.prepend(button);
      button.addEventListener('click',()=>{const opening=panel.hidden;close();opener=button;panel.hidden=!opening;button.setAttribute('aria-expanded',String(opening));});
    });
  }
  panel.addEventListener('click',event=>{if(event.target.closest('a'))close();});
  document.addEventListener('pointerdown',event=>{if(!panel.contains(event.target)&&!event.target.closest('.compact-menu-button'))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close(true);});window.addEventListener('resize',()=>{if(innerWidth>1100)close();});
  refresh();return {refresh};
}
