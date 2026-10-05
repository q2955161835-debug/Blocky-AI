import {THREE,box,cylinder} from './kit.js';
import {addExpression,roleExpressions} from './expressions.js';
import {addAccessories} from './character-accessories.js';
import {facePointer} from './gaze.js';

export function mascot(parent,{color='#12aee2',kind='brand',expression=roleExpressions[kind],grounded=false}={}){
  const root=new THREE.Group(),head=new THREE.Group();parent.add(root);root.add(head);
  box(head,color,[1.7,1.45,1.25],[0,0,0],.25);
  for(const x of [-.43,.43])cylinder(head,color,.25,.22,[x,.79,0]);
  const pupils=addExpression(head,expression);
  addAccessories(root,head,color,kind);
  if(grounded)for(const x of [-.33,.33])box(root,color,[.38,.145,.50],[x,-.7975,.08],.055);
  return {root,head,pupils,look(pointer,reduced=false,context){
    const {x,y}=reduced?{x:0,y:0}:facePointer(head,pointer,context);
    head.rotation.y=reduced?0:THREE.MathUtils.lerp(head.rotation.y,x*.23,.1);head.rotation.x=reduced?0:THREE.MathUtils.lerp(head.rotation.x,-y*(grounded?.035:.12),.1);
    for(const {pupil,x:base,y:baseY} of pupils){pupil.position.x=THREE.MathUtils.lerp(pupil.position.x,base+x*.065,reduced?1:.14);pupil.position.y=THREE.MathUtils.lerp(pupil.position.y,baseY+y*.04,reduced?1:.14);}
  }};
}

export function characterScene(scene,kind='brand'){
  const color={brand:'#13aee2',knowledge:'#8cc9af',work:'#e4bd60',coding:'#82b0e5',pi:'#bb9ddd'}[kind];
  const character=mascot(scene,{color,kind});let clicked=-100,hover=false;
  const fades=[];
  if(kind==='brand'){
    const copies=new Map();character.root.traverse(mesh=>{if(!mesh.isMesh)return;if(!copies.has(mesh.material)){const copy=mesh.material.clone();copy.transparent=true;copies.set(mesh.material,copy);fades.push(copy);}mesh.material=copies.get(mesh.material);});
  }
  return {...character,fade(opacity){fades.forEach(m=>{m.opacity=opacity;});},interact(ray,type){hover=!!ray?.intersectObject(character.head,true).length;if(hover&&type==='click')clicked=performance.now()/1000;return hover;},update(time,progress,pointer,reduced,aspect,context){
    const age=time-clicked;
    character.root.position.y=reduced?0:Math.sin(time*.65)*.035+(age<.7?Math.sin(age/.7*Math.PI)*.2:0);
    character.root.rotation.z=reduced?0:(hover?-.055:Math.sin(time*.4)*.018);
    character.look(pointer,reduced,context);
  }};
}
