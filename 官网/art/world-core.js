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
export function finish(mesh,style='stone'){
  const settings={stone:[.02,.72,.08],wood:[.02,.57,.10],metal:[.5,.38,.22]};
  mesh.material=material(mesh.material.color.getHex(),...settings[style]);return mesh;
}
export function foundation(parent,name,position,w,d,color){
  const g=new THREE.Group();g.name=name;g.position.set(...position);parent.add(g);
  finish(box(g,color,[w,.16,d],[0,.08,0],.07));return g;
}
export function table(parent,x,z,{floor=.16,screen=false}={}){
  const top=floor+.72;
  finish(box(parent,'#b59a74',[1.05,.10,.68],[x,top+.05,z],.035),'wood');
  for(const dx of [-.40,.40])for(const dz of [-.24,.24])finish(box(parent,'#8f785c',[.06,.72,.06],[x+dx,floor+.36,z+dz],.016),'wood');
  if(screen){
    box(parent,'#52728b',[.23,.035,.20],[x,top+.118,z-.17],.012);
    beam(parent,[x,top+.135,z-.17],[x,top+.38,z-.17],.045,'#64849b');
    box(parent,'#334d65',[.60,.38,.06],[x,top+.39,z-.17],.025);
    panel(parent,'#8bd0dc',[.50,.28,.014],[x,top+.39,z-.133]);
    box(parent,'#8daaba',[.47,.025,.17],[x,top+.113,z+.16],.01);
  }
}
