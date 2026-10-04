import {THREE,box,cylinder,block,sphere,material} from './kit.js';
import {beam,ring,pane,panel} from './world-core.js';
import {mascot} from './characters.js';

function platform(root,x,z,w,d,y){
  box(root,'#384b60',[w,.75,d],[x,y,z],.24);box(root,'#768c9b',[w-.1,.12,d-.1],[x,y+.44,z],.16);
  panel(root,'#3fc7df',[w*.65,.055,.06],[x,y-.08,z+d/2+.03]);
}
export function professionalWorld(root){
  const core=cylinder(root,'#293c51',5.1,.9,[0,-.48,0],6);core.rotation.y=Math.PI/6;
  platform(root,-3.3,1.4,4.2,4.8,.15);platform(root,1,-3.1,4.5,4.1,1.2);platform(root,3.7,2,3.6,3.7,.45);platform(root,-.2,4.25,4.3,2.6,-.25);
  for(let i=0;i<8;i++)box(root,'#6b7c8b',[1.2,.15,.32],[.4,.15+i*.125,1.3-i*.45],.04);
  const tower=new THREE.Group();tower.position.set(1,1.72,-3.1);root.add(tower);
  // Structural block columns leave a genuine open fabrication bay.
  for(let i=0;i<4;i++){
    for(const side of [-1,1]){const b=block(tower,i%2?'#455987':'#3666b2',.7,.8,1.75);b.position.set(side*1.1,.6+i*.95,0);panel(tower,'#43c8ed',[.4,.04,.05],[side*1.1,.75+i*.95,.92]);}
    box(tower,'#91a6ba',[2.95,.12,1.9],[0,1.15+i*.95,0],.065);
  }
  box(tower,'#2c4d89',[2.5,.73,1.6],[0,4.44,0],.19);
  for(const x of [-.65,.65])cylinder(tower,'#6281b3',.32,.22,[x,4.94,0]);
  const cargo=block(tower,'#8dc6e0',.76,.6,.76);cargo.position.set(0,2.1,0);pane(tower,[1.42,2.45,.045],[0,2.3,1]);
  cylinder(tower,'#9eabb9',.09,1,[0,3.28,0]);
  const orbitGroup=new THREE.Group();orbitGroup.position.set(-3.3,1.9,1.4);orbitGroup.rotation.z=.28;root.add(orbitGroup);
  ring(orbitGroup,1.6,.16,'#a6b7c6',[0,0,0],[.4,.5,0]);ring(orbitGroup,1.15,.08,'#4b88c9',[0,0,0],[-.5,1,.35]);ring(orbitGroup,.79,.055,'#75d8e6',[0,0,0],[.75,0,0]);sphere(orbitGroup,'#69bada',.52,[0,0,0]);
  cylinder(root,'#657c91',1.5,.2,[-3.3,.73,1.4]);beam(root,[-3.6,.8,1.5],[-3.3,2.05,1.4],.18,'#7891a5');
  // Transparent research lab, isolated from the tall fabrication tower.
  const lab=new THREE.Group();lab.position.set(-.2,.5,4.25);root.add(lab);
  box(lab,'#87b7d3',[3.5,.17,2.1],[0,1.8,0],.1);
  for(const x of [-1.6,1.6])for(const z of [-.9,.9])cylinder(lab,'#84adbf',.065,1.8,[x,.9,z]);
  pane(lab,[3.4,1.55,.04],[0,.94,1]);pane(lab,[.04,1.55,2],[1.7,.94,0]);
  for(let i=0;i<3;i++){box(lab,'#5b7f98',[.72,.18,.8],[-1+i,.65,0],.055);box(lab,'#24405e',[.5,.4,.07],[-1+i,1.03,-.3],.04);panel(lab,'#61cae1',[.35,.22,.04],[-1+i,1.03,-.25]);}
  const terminal=new THREE.Group();terminal.position.set(3.7,1,2);root.add(terminal);
  for(const x of [-1.2,1.2])box(terminal,'#615880',[.42,1.6,2.3],[x,.8,0],.12);
  box(terminal,'#9f96c3',[2.85,.35,2.3],[0,1.75,0],.12);panel(terminal,'#b8a2ef',[1.8,.08,.05],[0,1.77,1.18]);
  const packages=[];for(let i=0;i<3;i++){const m=block(terminal,['#958cc3','#8097c0','#afa4d1'][i],.5,.45,.5);m.position.set((i-1)*.67,.32,.18);packages.push(m);}
  for(const x of [-4.9,5.2]){
    cylinder(root,'#9bacb9',.2,4,[x,2.55,-3.8]);cylinder(root,'#416a98',.34,.25,[x,4.53,-3.8]);beam(root,[x,4.4,-3.8],[1,4.4,-3.8],.14,'#899daf');
    const hanger=block(root,'#75a5cc',.56,.5,.56);hanger.position.set(x*.67,3.7,-3.8);beam(root,[x*.67,3.95,-3.8],[x*.67,4.4,-3.8],.04,'#a6c2d2');
  }
  const characters=[[-3.1,1.1,3],[2.4,2.05,-1.1],[1.2,.7,4.6]].map((p,i)=>{const m=mascot(root,{expression:['focused','curious','gentle'][i]});m.root.position.set(...p);m.root.scale.setScalar(.35);return m;});
  return {anchors:[new THREE.Vector3(0,2,0),new THREE.Vector3(1,4,-3.1),new THREE.Vector3(-3.3,2,1.4),new THREE.Vector3(3.7,2,2),new THREE.Vector3(-.2,1.8,4.25)],animate(time,pointer,reduced){
    characters.forEach(c=>c.look(pointer,reduced));if(reduced)return;
    orbitGroup.rotation.y=Math.sin(time*.35)*.3;cargo.position.y=2.1+Math.sin(time*.6)*.3;packages.forEach((m,i)=>m.position.z=.18+Math.sin(time*.6+i)*.22);
  }};
}
