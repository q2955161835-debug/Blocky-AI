import {ArtEngine} from './engine.js';
import {heroSculpture,assemblySculpture} from './sculptures.js';
import {worldScene} from './worlds.js';
import {THREE} from './kit.js';

export function startArt({subscribePreferences}){
  let engine;try{engine=new ArtEngine();}catch{document.body.classList.add('art-unavailable');window.dispatchEvent(new Event('blocky-art-unavailable'));return null;}
  document.querySelectorAll('[data-art]').forEach(element=>{
    const kind=element.dataset.art;
    if(kind==='hero')engine.add(element,heroSculpture,{distance:12.5});
    else if(kind==='assembly')engine.add(element,assemblySculpture,{distance:10});
    else engine.add(element,scene=>worldScene(scene,kind),{world:true,onFrame:view=>{view.camera.position.set(13,13,16);view.camera.lookAt(0,.5,0);}});
  });
  const unsubscribe=subscribePreferences(()=>engine.invalidate());
  let active;
  return {
    refresh(){engine.invalidate();},
    enter(element,type,onProjection){
      if(active)engine.remove(active);
      active=engine.add(element,scene=>worldScene(scene,type),{world:true,onFrame:(view,reduced)=>{
        const tour=element.parentElement,amount=reduced?0:Number(tour.dataset.progress||0),index=Math.min(4,Math.round(amount));
        const a=view.model.anchors[index];view.model.marker.position.copy(a).add(new THREE.Vector3(0,.35,0));
        const frames=[{pos:[13,13,16],look:[0,.8,0]},...view.model.anchors.slice(1).map(p=>({pos:[p.x+6,p.y+5,p.z+8],look:[p.x,p.y*.55,p.z]}))];
        const lo=Math.floor(amount),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(amount-lo,0,1);
        const from=frames[lo],to=frames[hi],pos=new THREE.Vector3(...from.pos).lerp(new THREE.Vector3(...to.pos),mix),look=new THREE.Vector3(...from.look).lerp(new THREE.Vector3(...to.look),mix);
        if(innerWidth<700){pos.multiplyScalar(index===0?1.9:1.35);look.y-=index===0?6:3;}
        view.camera.position.copy(pos);view.camera.lookAt(look);view.camera.updateMatrixWorld();
        const point=a.clone().project(view.camera),rect=element.getBoundingClientRect();
        onProjection?.({x:rect.left+(point.x*.5+.5)*rect.width,y:rect.top+(-.5*point.y+.5)*rect.height,index});
      }});
    },
    leave(){if(active){engine.remove(active);active=null;}engine.invalidate();},
    dispose(){unsubscribe();engine.dispose();}
  };
}
