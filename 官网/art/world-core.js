import {THREE,box,cylinder,sphere,material} from './kit.js';
export function ring(parent,radius,tube,color,position,rotation=[0,0,0]){
  const m=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,10,56),material(color,.65));m.position.set(...position);m.rotation.set(...rotation);m.castShadow=true;parent.add(m);return m;
}
export function beam(parent,from,to,width,color){
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),mid=a.clone().add(b).multiplyScalar(.5),m=box(parent,color,[width,a.distanceTo(b),width],mid.toArray(),Math.min(.06,width/3));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());return m;
}
export function tree(parent,x,y,z,scale=1){
  const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);parent.add(g);cylinder(g,'#b49368',.09,.8,[0,.4,0],8);box(g,'#91ac6a',[.8,.8,.8],[0,1.1,0],.18);box(g,'#aec585',[.5,.55,.5],[.13,1.55,0],.15);
}
export function pane(parent,size,position,color='#9edac9',opacity=.27){
  const m=box(parent,color,size,position,.02);m.material=new THREE.MeshPhysicalMaterial({color,transparent:true,opacity,roughness:.15,metalness:.1,depthWrite:false,side:THREE.DoubleSide});return m;
}
export function plant(parent,x,y,z){box(parent,'#b79464',[.32,.2,.32],[x,y,z],.035);for(let i=0;i<3;i++)sphere(parent,['#84ae67','#a6bc72','#5f986c'][i],.14,[x+(i-1)*.1,y+.2+i*.075,z]);}
export function panel(parent,color,size,position){
  const m=box(parent,color,size,position,.015);m.material=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.2,roughness:.3});return m;
}
