import {THREE,box,cylinder} from './kit.js';
import {beam,panel,finish} from './world-core.js';
import {mascot} from './characters.js';
import {fabrication,observatory,delivery,research} from './district-buildings.js';

function plinth(root,x,z,w,d,height){
  finish(box(root,'#506278',[w,height,d],[x,height/2,z],.09),'metal');
  for(let i=0;i<3;i++){
    const h=(height+.16)*(i+1)/3;
    finish(box(root,'#8193a5',[1.28,h,.28],[x,h/2,z+d/2+(2.5-i)*.28],.025));
  }
}

export function professionalWorld(root){
  finish(cylinder(root,'#34495d',8.1,.805,[0,-.4475,0],6),'metal').rotation.y=Math.PI/6;
  finish(cylinder(root,'#728491',8.03,.045,[0,-.0225,0],6),'metal').rotation.y=Math.PI/6;
  plinth(root,-3,-2.85,3.8,3.25,.40);plinth(root,3.35,-3.05,4.3,3.85,.22);
  plinth(root,3.50,2.75,4.45,3.20,.26);plinth(root,-2.6,3.25,4.25,3.3,.16);
  const buildings=[fabrication(root),observatory(root),delivery(root),research(root)];
  // Utilities run on the ground with anchored junctions instead of floating gantries.
  for(const x of [-6.05,6.05]){
    for(const z of [-2.5,-.8,.9,2.6]){
      finish(box(root,'#54728e',[.45,.34,.53],[x,.17,z],.06),'metal');
      panel(root,'#89bfda',[.24,.035,.025],[x,.22,z+.28]);
    }
    beam(root,[x,.0325,-2.7],[x,.0325,2.9],.065,'#90a2b1');
  }
  for(let i=0;i<7;i++)finish(box(root,'#8193a2',[1.45,.026,.36],[-.20,.013,-1.3+i*.65],.028));
  const people=[[-3.85,.56,-1.48,'focused'],[2.95,.42,3.98,'cheerful'],[-2.65,.32,4.37,'curious']].map(([x,floor,z,expression])=>{
    const m=mascot(root,{grounded:true,expression}),scale=.30;m.root.scale.setScalar(scale);m.root.position.set(x,floor+.87*scale,z);return m;
  });
  return {focus:[root,...buildings.map(b=>b.group)],anchors:[new THREE.Vector3(0,1,0),new THREE.Vector3(-3,2.9,-2.85),new THREE.Vector3(3.35,2.45,-3.05),new THREE.Vector3(3.50,1.7,2.75),new THREE.Vector3(-2.6,1.40,3.25)],animate(time,pointer,reduced){
    people.forEach(m=>m.look(pointer,reduced));buildings.forEach(b=>b.animate(time,reduced));
  }};
}
