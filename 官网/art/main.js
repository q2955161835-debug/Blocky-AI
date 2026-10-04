import {ArtEngine} from './engine.js';
import {heroSculpture,assemblySculpture} from './sculptures.js';
import {worldScene} from './worlds.js';
import {THREE} from './kit.js';
import {characterScene} from './characters.js';
import {worldCamera} from './world-camera.js';

export function startArt({subscribePreferences}){
  let engine;try{engine=new ArtEngine();}catch{document.body.classList.add('art-unavailable');window.dispatchEvent(new Event('blocky-art-unavailable'));return null;}
  document.querySelectorAll('[data-art]').forEach(element=>{
    const kind=element.dataset.art;
    if(kind==='hero')engine.add(element,heroSculpture,{distance:13,onFrame:view=>{view.camera.position.set(0,0,13);view.camera.lookAt(0,0,0);}});
    else if(kind==='assembly')engine.add(element,assemblySculpture,{distance:10});
    else if(kind==='brand'||kind.startsWith('character-'))engine.add(element,scene=>characterScene(scene,kind.replace('character-','')),{distance:kind==='brand'?3.7:4.9,onFrame:view=>{view.camera.position.set(0,.6,kind==='brand'?3.7:4.9);view.camera.lookAt(0,kind==='brand'?.1:-.15,0);}});
    else engine.add(element,scene=>worldScene(scene,kind),{world:true,onFrame:view=>{const angle=kind==='education'?.63:-.53;view.camera.position.set(Math.sin(angle)*21,15,Math.cos(angle)*21);view.camera.lookAt(0,1,0);}});
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
        view.pose??=worldCamera(type,view.model);view.pose(view,amount);
        const rect=element.getBoundingClientRect();
        const point=a.clone().project(view.camera);
        onProjection?.({x:rect.left+(point.x*.5+.5)*rect.width,y:rect.top+(-.5*point.y+.5)*rect.height,index});
      }});
    },
    leave(){if(active){engine.remove(active);active=null;}engine.invalidate();},
    dispose(){unsubscribe();engine.dispose();}
  };
}
