import {THREE,box} from './kit.js';
import {beam,tree,plant,finish} from './world-core.js';
import {mascot} from './characters.js';
import {library,classroom,schoolCenter,greenhouse} from './campus-buildings.js';

export function educationWorld(root){
  finish(box(root,'#ead5b2',[7.4,.76,11.5],[-2.8,-.38,0],.32));
  finish(box(root,'#ead5b2',[5,.76,11.5],[4.6,-.38,0],.32));
  finish(box(root,'#d5ba92',[13.8,.13,11.55],[.3,-.825,0],.10));
  // One continuous terrace replaces varying cell heights beneath buildings.
  const libraryBase=new THREE.Group();libraryBase.userData.worldFocus=1;root.add(libraryBase);
  finish(box(libraryBase,'#e3c39a',[6.05,.75,4.8],[-3.15,.375,-3],.13));
  for(let i=0;i<5;i++)finish(box(libraryBase,'#d0ae7c',[1.60,.15*(i+1),.32],[-3.15,.075*(i+1),.84-i*.32],.025));
  finish(box(libraryBase,'#eddec1',[5.32,.16,.32],[-3.1,.83,-1.59],.025));
  box(root,'#739d91',[1.20,.34,11.3],[1.5,-.59,0],.025);
  box(root,'#91cabe',[1.20,.155,11.3],[1.5,-.3425,0],.02);
  const ripples=[];
  for(let i=0;i<14;i++)ripples.push(box(root,'#c3e3d4',[.35,.01,.033],[1.5,-.260,-5.25+i*.80],.005));
  for(let i=0;i<13;i++)finish(box(root,'#b69369',[.245,.09,1.15],[-.125+(i+.5)*.25,.20,2.4],.018),'wood');
  for(const z of [1.96,2.84]){
    beam(root,[-.125,.12,z],[3.125,.12,z],.07,'#ad895e');
    for(const x of [.55,2.45])beam(root,[x,0,z],[x,.085,z],.12,'#ad895e');
    beam(root,[0,.75,z],[3,.75,z],.038,'#ba996d');
    for(let i=0;i<6;i++)beam(root,[i*.6,.245,z],[i*.6,.75,z],.04,'#ba996d');
  }
  const buildings=[library(root),classroom(root),schoolCenter(root),greenhouse(root)];
  for(const [x,z,s] of [[-5.7,4.4,.88],[-5.65,-5,.78],[6.1,4.5,.9],[6.1,-4.9,.8],[-.8,4.9,.65],[3,-5,.67]])tree(root,x,x<-.125&&z<-.6?.75:0,z,s);
  for(let i=0;i<6;i++)plant(root,3.3+(i%2)*.85,.1,4.75+Math.floor(i/2)*.3);
  for(let i=0;i<6;i++)finish(box(root,'#e6d8bd',[.72,.025,.56],[-1.35,.0125,.9+i*.55],.035));
  const character=mascot(root,{grounded:true,expression:'curious'}),scale=.34;
  character.root.scale.setScalar(scale);character.root.position.set(-1.56,.16+.87*scale,4.0);
  character.root.userData.worldFocus=2;
  return {focus:[root,...buildings],anchors:[new THREE.Vector3(0,1,0),new THREE.Vector3(-3.1,2.5,-3.1),new THREE.Vector3(-3.25,1.35,2.65),new THREE.Vector3(4.5,1.7,3.05),new THREE.Vector3(4.2,1.6,-2.3)],animate(time,pointer,reduced,context){
    character.look(pointer,reduced,context);ripples.forEach((m,i)=>{m.position.x=1.5+(reduced?0:Math.sin(time*.6+i)*.19);});
  }};
}
