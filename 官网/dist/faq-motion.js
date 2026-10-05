export function mountFaqMotion(){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const states=[];
  document.querySelectorAll('#faq .faq-list details').forEach(details=>{
    const summary=details.querySelector('summary');let motion,target=details.open;
    function finish(){motion?.cancel();motion=null;details.open=target;details.style.height='';details.style.overflow='';}
    function toggle(event){
      event.preventDefault();target=!target;
      if(reduced.matches||!details.animate){finish();return;}
      const start=details.getBoundingClientRect().height;motion?.cancel();details.style.height='';details.open=true;
      const end=target?details.getBoundingClientRect().height:summary.getBoundingClientRect().height+1;
      details.style.overflow='hidden';
      motion=details.animate([{height:`${start}px`},{height:`${end}px`}],{duration:target?420:320,easing:'cubic-bezier(.22,.75,.25,1)',fill:'both'});
      if(target)for(const child of details.children)if(child!==summary)child.animate([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'ease-out'});
      motion.onfinish=finish;
    }
    summary.addEventListener('click',toggle);states.push(finish);
  });
  reduced.addEventListener('change',()=>states.forEach(finish=>finish()));window.addEventListener('resize',()=>states.forEach(finish=>finish()));
}
