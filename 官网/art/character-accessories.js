import {THREE,box,sphere,material} from './kit.js';
import {beam} from './world-core.js';

function hands(root,color,points){
  for(const [x,y,z] of points){beam(root,[Math.sign(x)*.74,-.48,.36],[x,y,z],.12,color);sphere(root,color,.11,[x,y,z]);}
}

export function addAccessories(root,head,color,kind){
  if(kind==='knowledge'){
    const book=new THREE.Group();root.add(book);book.position.set(0,-.94,.78);book.rotation.x=.52;
    // Each leaf pivots at the same spine, instead of two detached slabs.
    for(const side of [-1,1]){
      const leaf=new THREE.Group();book.add(leaf);leaf.rotation.z=-side*.13;
      box(leaf,'#286b5b',[.72,.07,.77],[side*.36,-.035,0],.025);
      box(leaf,'#f7eed7',[.67,.065,.69],[side*.335,.0325,0],.018);
      for(let line=0;line<4;line++)box(leaf,'#bbc8ae',[.40,.006,.014],[side*.34,.069,-.21+line*.13],.002);
    }
    const spine=new THREE.Mesh(new THREE.CylinderGeometry(.073,.073,.77,16),material('#276553'));
    spine.rotation.x=Math.PI/2;book.add(spine);
    hands(root,color,[[-.75,-.91,.74],[.75,-.91,.74]]);
  }else if(kind==='work'){
    const bag=new THREE.Group();root.add(bag);bag.position.set(.23,-1.03,.65);
    box(bag,'#705b45',[1.2,.6,.40],[0,0,0],.075);
    box(bag,'#b58c54',[1.16,.07,.026],[0,.045,.214],.014);
    box(bag,'#e0c68e',[.15,.15,.046],[0,.02,.237],.018);
    for(const x of [-.4,.4])box(bag,'#453d37',[.065,.56,.028],[x,0,.214],.012);
    const handle=new THREE.Mesh(new THREE.TorusGeometry(.14,.026,8,20,Math.PI),material('#705b45'));
    handle.position.set(0,.3,0);bag.add(handle);
    const tasks=new THREE.Group();root.add(tasks);tasks.position.set(-.94,-.28,.71);tasks.rotation.z=.10;
    box(tasks,'#f7edd4',[.46,.64,.08],[0,0,0],.04);
    box(tasks,'#ccb171',[.21,.09,.09],[0,.31,0],.015);
    for(let i=0;i<3;i++){
      box(tasks,'#69a694',[.06,.06,.014],[-.13,.15-i*.15,.048],.008);
      box(tasks,'#b2ad9b',[.17,.022,.014],[.045,.15-i*.15,.048],.008);
    }
    hands(root,color,[[-.94,-.48,.66],[.32,-.60,.65]]);
  }else if(kind==='coding'){
    for(const x of [-.94,.94])box(head,'#344768',[.23,.58,.60],[x,.05,-.02],.09);
    const band=new THREE.Mesh(new THREE.TorusGeometry(1.02,.05,8,32,Math.PI),material('#45669e'));
    band.position.set(0,.08,-.30);head.add(band);
    const laptop=new THREE.Group();root.add(laptop);laptop.position.set(0,-1.30,.68);
    box(laptop,'#344b69',[1.2,.07,.64],[0,0,0],.025);
    for(let row=0;row<3;row++)for(let key=0;key<7;key++)box(laptop,'#708da6',[.085,.013,.063],[-.36+key*.12,.042,-.03+row*.10],.006);
    box(laptop,'#7e9eb7',[.27,.009,.08],[0,.042,.26],.009);
    box(laptop,'#344b69',[1.2,.46,.065],[0,.325,-.20],.028);
    box(laptop,'#162d45',[1.08,.34,.018],[0,.33,-.159],.016);
    for(let i=0;i<3;i++)box(laptop,['#82d4df','#d6c181','#a7caa5'][i],[.40+i*.06,.021,.012],[-.14+i*.025,.41-i*.082,-.145],.005);
    beam(laptop,[-.54,.06,-.20],[.54,.06,-.20],.09,'#52728c');
    hands(root,color,[[-.63,-1.27,.81],[.63,-1.27,.81]]);
  }else if(kind==='pi'){
    // Keep the orbital silhouette behind the face, and attach the bead to it.
    const orbit=new THREE.Mesh(new THREE.TorusGeometry(1.17,.029,8,56,Math.PI*1.7),material('#b29bd7',.6));
    orbit.position.set(0,.05,-.81);orbit.rotation.z=-.45;head.add(orbit);
    sphere(head,'#e5f680',.095,[Math.cos(.6)*1.17,Math.sin(.6)*1.17+.05,-.81]);
    box(head,'#6e538d',[.07,.31,.07],[0,.88,0],.022);sphere(head,'#e3d5fb',.07,[0,1.105,0]);
  }
}
