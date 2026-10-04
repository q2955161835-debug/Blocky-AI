import {THREE,box,cylinder,sphere,material} from './kit.js';

export function mascot(parent,{color='#12aee2',kind='brand'}={}){
  const root=new THREE.Group(),head=new THREE.Group();parent.add(root);root.add(head);
  box(head,color,[1.7,1.45,1.25],[0,0,0],.25);
  for(const x of [-.43,.43])cylinder(head,color,.25,.22,[x,.79,0]);
  const pupils=[];
  for(const x of [-.37,.37]){
    const eye=sphere(head,'#f6f9f5',.2,[x,.09,.631]);eye.scale.set(1,1.2,.36);
    const pupil=sphere(head,'#13232b',.125,[x,.09,.71]);pupil.scale.set(.87,1.18,.43);
    const gleam=sphere(pupil,'#ffffff',.028,[-.027,.04,.08]);pupils.push({pupil,x});
    const brow=box(head,'#153744',[.26,.045,.05],[x,.44,.64],.02);brow.rotation.z=x>0?-.12:.12;
  }
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.17,.026,8,24,Math.PI),material('#19333c'));
  smile.position.set(0,-.31,.65);smile.rotation.z=Math.PI;head.add(smile);
  if(kind==='knowledge'){
    const book=new THREE.Group();book.position.set(0,-.78,.68);root.add(book);
    for(const side of [-1,1]){const cover=box(book,'#215e50',[.76,.08,.65],[side*.4,0,0],.04);cover.rotation.z=side*.15;box(book,'#efeeda',[.65,.09,.55],[side*.4,.085,0],.025).rotation.z=side*.15;}
    box(head,'#286654',[1.4,.12,.07],[0,.32,.69],.035);
  }else if(kind==='work'){
    box(head,'#654b25',[1.78,.14,1.3],[0,.6,0],.06);
    const hat=box(head,'#eec773',[1.23,.27,1.05],[0,.87,0],.1);
    box(root,'#775529',[.62,.42,.23],[.94,-.47,.15],.06);box(root,'#d5b976',[.25,.12,.25],[.94,-.2,.15],.04);
  }else if(kind==='coding'){
    for(const x of [-.92,.92])box(head,'#283c68',[.22,.69,.59],[x,.03,0],.1);
    const band=new THREE.Mesh(new THREE.TorusGeometry(.91,.055,8,32,Math.PI),material('#45669e'));band.position.set(0,.05,0);head.add(band);
    box(root,'#283c68',[1.3,.08,.65],[0,-.85,.66],.035);box(root,'#94cee3',[1.3,.66,.055],[0,-.49,1],.04).rotation.x=-.14;
  }else if(kind==='pi'){
    const orbit=new THREE.Mesh(new THREE.TorusGeometry(1.24,.035,8,48),material('#b29bd7',.6));orbit.rotation.set(.6,.25,.5);head.add(orbit);
    sphere(head,'#e5f680',.12,[1.05,.5,.4]);box(head,'#6e538d',[.08,.37,.08],[0,1.12,0],.025);sphere(head,'#e3d5fb',.1,[0,1.35,0]);
  }
  return {root,head,pupils,look(pointer,reduced=false){
    const x=reduced?0:THREE.MathUtils.clamp(pointer.x,-1,1),y=reduced?0:THREE.MathUtils.clamp(pointer.y,-1,1);
    head.rotation.y=THREE.MathUtils.lerp(head.rotation.y,x*.23,.1);head.rotation.x=THREE.MathUtils.lerp(head.rotation.x,-y*.12,.1);
    for(const {pupil,x:base} of pupils){pupil.position.x=base+x*.065;pupil.position.y=.09+y*.055;}
  }};
}

export function characterScene(scene,kind='brand'){
  const color={brand:'#13aee2',knowledge:'#8cc9af',work:'#e4bd60',coding:'#82b0e5',pi:'#bb9ddd'}[kind];
  const character=mascot(scene,{color,kind});let clicked=-100,hover=false;
  character.root.rotation.y=-.15;
  return {...character,interact(ray,type){hover=!!ray?.intersectObject(character.head,true).length;if(hover&&type==='click')clicked=performance.now()/1000;return hover;},update(time,progress,pointer,reduced){
    character.look(pointer,reduced);const age=time-clicked;
    character.root.position.y=reduced?0:Math.sin(time*.65)*.035+(age<.7?Math.sin(age/.7*Math.PI)*.2:0);
    character.root.rotation.z=reduced?0:(hover?-.055:Math.sin(time*.4)*.018);
  }};
}
