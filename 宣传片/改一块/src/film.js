import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {makeWorld} from './world.js';
import {animateWorld,phase,clamp} from './timeline.js';

const scene=new THREE.Scene();scene.background=new THREE.Color('#0b0f11');
const camera=new THREE.PerspectiveCamera(35,16/9,.1,200);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;document.body.prepend(renderer.domElement);
const env=new THREE.PMREMGenerator(renderer);scene.environment=env.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.4;
scene.add(new THREE.HemisphereLight('#edf5ff','#394b37',1.15));
const key=new THREE.DirectionalLight('#fff6db',3.5);key.position.set(-9,15,12);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-15,right:18,top:15,bottom:-8,near:.5,far:60});key.shadow.normalBias=.035;key.shadow.bias=-.00015;scene.add(key);
const rim=new THREE.DirectionalLight('#90cfff',2.5);rim.position.set(10,7,-7);scene.add(rim);
const fill=new THREE.PointLight('#e4f5a0',30,30,2);fill.position.set(5,4,7);scene.add(fill);
const world=makeWorld(scene);const caption=document.querySelector('#caption'),brand=document.querySelector('#brand'),ui=document.querySelector('#ui'),img=document.querySelector('#ui-img'),cursor=document.querySelector('#cursor');
window.renderFrame=async(t)=>{
 animateWorld(world,t,camera,scene);renderer.render(scene,camera);
 caption.textContent=t>=21&&t<25?'如果，规则也能改？':t>=32.2&&t<35?'改一块。':t>=40&&t<43?'世界就变。':'';
 caption.style.opacity=t>=21&&t<25?Math.min(phase(t,21,21.6),1-phase(t,24.4,25)):1;
 brand.style.opacity=phase(t,55,55.7);document.querySelector('#flash').style.opacity=String((t>=33.5&&t<34?Math.sin((t-33.5)/.5*Math.PI)*.45:0));
 const showUI=t>=49&&t<55&&window.hasUICapture;ui.style.display=showUI?'block':'none';document.querySelector('#ui-label').style.display=showUI?'block':'none';cursor.style.display=showUI?'block':'none';
 if(showUI){const n=t<50.3?'ui-before.png':t<52.3?'ui-edit.png':'ui-after.png';const src='/media/'+n;if(!img.src.endsWith(n)){img.src=src;await img.decode();}ui.style.opacity=Math.min(phase(t,49,49.35),1-phase(t,54.7,55));const b=window.uiPoint||{x:380,y:785,width:70,height:18};const x=6+88*(b.x+b.width/2)/1920,y=10+80*(b.y+b.height/2)/1080,p=phase(t,49.6,50.2);cursor.style.left=(x+8*(1-p))+'%';cursor.style.top=(y-8*(1-p))+'%';img.style.transformOrigin=(100*(b.x+b.width/2)/1920)+'% '+(100*(b.y+b.height/2)/1080)+'%';img.style.transform='scale('+(1+.80*phase(t,49.4,50.2))+')';}
};
window.hasUICapture=new URLSearchParams(location.search).has('ui');if(window.hasUICapture)window.uiPoint=(await (await fetch('/media/ui-capture.json')).json()).bounds;window.filmReady=true;await window.renderFrame(0);
if(!new URLSearchParams(location.search).has('offline')){const start=performance.now();function loop(){window.renderFrame(((performance.now()-start)/1000)%60).then(()=>requestAnimationFrame(loop));}requestAnimationFrame(loop);}
