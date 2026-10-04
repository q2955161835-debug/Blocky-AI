export function mountContentMotion(){
  if(!('IntersectionObserver' in window))return;
  const elements=document.querySelectorAll('.feature-copy,.feature-visual,.section-heading,.steps>article,.world-entry-copy,.access-details>article');
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-revealed');observer.unobserve(entry.target);}},{threshold:.12});
  elements.forEach((element,i)=>{element.classList.add('content-reveal');element.style.setProperty('--reveal-delay',`${(i%2)*70}ms`);observer.observe(element);});
  return ()=>observer.disconnect();
}
