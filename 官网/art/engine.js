import {THREE,lighting,disposeKit,disposeScene} from './kit.js';

export class ArtEngine {
  constructor(){
    this.views=new Set();this.pointer={x:0,y:0,active:false};this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.dirty=true;this.frame=0;
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setClearColor(0x000000,0);this.renderer.autoClear=false;this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.domElement.id='art-layer';this.renderer.domElement.setAttribute('aria-hidden','true');document.body.append(this.renderer.domElement);
    this.resize=()=>{this.renderer.setSize(document.documentElement.clientWidth,innerHeight,false);this.invalidate();};
    this.move=e=>{this.pointer.active=true;this.pointer.x=e.clientX/innerWidth*2-1;this.pointer.y=1-e.clientY/innerHeight*2;this.interact(e,'hover');this.invalidate();};
    this.exit=e=>{if(!e.relatedTarget){this.pointer.active=false;this.interact(e,'hover');this.invalidate();}};
    this.click=e=>{if(!e.target.closest('a,button,input,summary'))this.interact(e,'click');};
    this.scroll=()=>this.invalidate();this.visibility=()=>{if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0;}else this.invalidate();};
    this.loss=e=>{e.preventDefault();this.fail();};
    window.addEventListener('resize',this.resize);window.addEventListener('pointermove',this.move,{passive:true});window.addEventListener('scroll',this.scroll,{passive:true});
    window.addEventListener('click',this.click);
    window.addEventListener('pointerout',this.exit);
    document.addEventListener('visibilitychange',this.visibility);this.reduced.addEventListener('change',this.scroll);this.renderer.domElement.addEventListener('webglcontextlost',this.loss);
    this.resize();
  }
  interact(event,type){
    let over=false;
    for(const view of this.views){
      if(!view.model.interact)continue;
      const r=view.element.getBoundingClientRect();
      const inside=!this.reduced.matches&&view.element.getClientRects().length&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;
      const ray=new THREE.Raycaster();if(inside)ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),view.camera);
      over=view.model.interact(inside?ray:null,type)||over;
    }
    document.body.classList.toggle('art-hover',over);this.invalidate();
  }
  add(element,create,{distance=11,world=false,onFrame}={}){
    const scene=new THREE.Scene();lighting(scene,world);const camera=new THREE.PerspectiveCamera(world?38:36,1,.1,100);camera.position.set(world?12:0,world?12:1.4,world?15:distance);camera.lookAt(0,0,0);
    const model=create(scene),view={element,scene,camera,model,world,onFrame,progress:0};this.views.add(view);element.classList.add('art-ready');this.invalidate();return view;
  }
  remove(view){this.views.delete(view);disposeScene(view.scene);this.invalidate();}
  invalidate(){this.dirty=true;if(!this.frame&&!document.hidden)this.frame=requestAnimationFrame(t=>this.draw(t));}
  draw(timestamp){
    this.frame=0;if(document.hidden)return;
    const time=timestamp/1000;let moving=false;
    this.renderer.setScissorTest(false);this.renderer.clear();this.renderer.setScissorTest(true);
    for(const view of [...this.views].sort((a,b)=>Number(a.element.dataset.art==='brand')-Number(b.element.dataset.art==='brand'))){
      if(!view.element.isConnected||!view.element.getClientRects().length)continue;
      if(view.model.fade){const style=getComputedStyle(view.element);if(style.visibility==='hidden'||Number(style.opacity)<.001)continue;view.model.fade(Number(style.opacity));}
      const r=view.element.getBoundingClientRect();if(r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth||r.width<1||r.height<1)continue;
      const progress=THREE.MathUtils.clamp((innerHeight-r.top)/(innerHeight+r.height),0,1);
      view.camera.aspect=r.width/r.height;view.camera.updateProjectionMatrix();
      view.onFrame?.(view,this.reduced.matches);
      view.camera.updateMatrixWorld();view.model.update?.(time,progress,this.pointer,this.reduced.matches,view.camera.aspect,{camera:view.camera,rect:r,width:innerWidth,height:innerHeight});
      this.renderer.setViewport(r.left,innerHeight-r.bottom,r.width,r.height);
      this.renderer.setScissor(Math.max(0,r.left),Math.max(0,innerHeight-r.bottom),Math.min(innerWidth,r.right)-Math.max(0,r.left),Math.min(innerHeight,r.bottom)-Math.max(0,r.top));
      this.renderer.clearDepth();this.renderer.render(view.scene,view.camera);moving=true;
    }
    this.dirty=false;
    if(moving&&!this.reduced.matches)this.frame=requestAnimationFrame(t=>this.draw(t));
  }
  fail(){document.body.classList.add('art-unavailable');this.dispose();window.dispatchEvent(new Event('blocky-art-unavailable'));}
  dispose(){cancelAnimationFrame(this.frame);this.frame=0;window.removeEventListener('resize',this.resize);window.removeEventListener('pointermove',this.move);window.removeEventListener('pointerout',this.exit);window.removeEventListener('click',this.click);window.removeEventListener('scroll',this.scroll);document.removeEventListener('visibilitychange',this.visibility);this.reduced.removeEventListener('change',this.scroll);this.renderer.domElement.removeEventListener('webglcontextlost',this.loss);for(const view of this.views)disposeScene(view.scene);this.views.clear();this.renderer.dispose();this.renderer.domElement.remove();disposeKit();}
}
