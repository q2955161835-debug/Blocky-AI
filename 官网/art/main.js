import {ArtEngine} from './engine.js';
import {heroSculpture,assemblySculpture} from './sculptures.js';
import {worldScene} from './worlds.js';
import {THREE} from './kit.js';
import {characterScene} from './characters.js';

export function startArt({subscribePreferences}){
  let engine;try{engine=new ArtEngine();}catch{document.body.classList.add('art-unavailable');window.dispatchEvent(new Event('blocky-art-unavailable'));return null;}
  document.querySelectorAll('[data-art]').forEach(element=>{
    const kind=element.dataset.art;
    if(kind==='hero')engine.add(element,heroSculpture,{distance:13,onFrame:view=>{view.camera.position.set(0,0,13);view.camera.lookAt(0,0,0);}});
    else if(kind==='assembly')engine.add(element,assemblySculpture,{distance:10});
    else if(kind==='brand'||kind.startsWith('character-'))engine.add(element,scene=>characterScene(scene,kind.replace('character-','')),{distance:kind==='brand'?3.7:4.6,onFrame:view=>{view.camera.position.set(0,.7,kind==='brand'?3.7:4.6);view.camera.lookAt(0,.1,0);}});
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
        const frames=type==='education'?
          [{pos:[15,13,19],look:[0,1,0]},{pos:[-9,6,4],look:[-3.15,2.5,-3]},{pos:[-4,4,9],look:[-3,1,2.7]},{pos:[3,6,-10],look:[-.6,1.5,-4.4]},{pos:[9,5,3],look:[4.4,1.5,-2.2]}]:
          [{pos:[-16,12,18],look:[0,1,0]},{pos:[8,8,5],look:[1,3,-3.1]},{pos:[-7,4,6],look:[-3.3,1.7,1.4]},{pos:[9,4,2],look:[3.7,1.5,2]},{pos:[3,3.5,11],look:[-.2,1,4.25]}];
        const lo=Math.floor(amount),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(amount-lo,0,1);
        const from=frames[lo],to=frames[hi],pos=new THREE.Vector3(...from.pos).lerp(new THREE.Vector3(...to.pos),mix),look=new THREE.Vector3(...from.look).lerp(new THREE.Vector3(...to.look),mix);
        const mobile=innerWidth<700,reading=tour.classList.contains('reading'),rect=element.getBoundingClientRect();
        const distanceScale=mobile?(lo===0?THREE.MathUtils.lerp(1.75,1.7,mix):1.7):(lo===0?THREE.MathUtils.lerp(1,1.25,mix):1.25);
        const copyTop=Number(tour.dataset.copyTop||innerHeight*.5),space=Math.max(80,copyTop-88),targetZoom=mobile&&!reading?Math.max(1,350/Math.max(160,space)):1;
        view.mobileZoom=THREE.MathUtils.lerp(view.mobileZoom||targetZoom,targetZoom,reduced?1:.12);
        pos.sub(look).multiplyScalar(distanceScale*view.mobileZoom).add(look);
        const offsetY=mobile&&!reading?rect.height*.5-(88+space*.5):0;
        view.camera.setViewOffset(rect.width,rect.height,mobile||reading?0:rect.width*.17,offsetY,rect.width,rect.height);
        view.camera.position.copy(pos);view.camera.lookAt(look);view.camera.updateMatrixWorld();
        const point=a.clone().project(view.camera);
        onProjection?.({x:rect.left+(point.x*.5+.5)*rect.width,y:rect.top+(-.5*point.y+.5)*rect.height,index});
      }});
    },
    leave(){if(active){engine.remove(active);active=null;}engine.invalidate();},
    dispose(){unsubscribe();engine.dispose();}
  };
}
