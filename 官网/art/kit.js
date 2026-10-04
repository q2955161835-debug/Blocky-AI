import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const geometry = new Map(), materials = new Map();
export function material(color, metalness = .08, roughness=.32, clearcoat=.55) {
  const key = `${color}/${metalness}/${roughness}/${clearcoat}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshPhysicalMaterial({color, roughness, metalness, clearcoat, clearcoatRoughness:.28}));
  return materials.get(key);
}
export function box(parent, color, size, position=[0,0,0], radius=.12) {
  const key = `box/${size}/${radius}`;
  if (!geometry.has(key)) geometry.set(key,new RoundedBoxGeometry(...size,2,radius));
  const mesh=new THREE.Mesh(geometry.get(key),material(color));
  mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function cylinder(parent,color,radius,height,position,segments=32) {
  const key=`cylinder/${radius}/${height}/${segments}`;
  if(!geometry.has(key))geometry.set(key,new THREE.CylinderGeometry(radius,radius,height,segments));
  const mesh=new THREE.Mesh(geometry.get(key),material(color));mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function sphere(parent,color,radius,position) {
  const key=`sphere/${radius}`;
  if(!geometry.has(key))geometry.set(key,new THREE.SphereGeometry(radius,16,12));
  const mesh=new THREE.Mesh(geometry.get(key),material(color));mesh.position.set(...position);mesh.castShadow=true;parent.add(mesh);return mesh;
}
// The connecting tongue and inset slot come from Blocky's nested block language.
export function block(parent,color,width=2,height=.72,depth=.85) {
  const g=new THREE.Group();parent.add(g);
  box(g,color,[width,height,depth]);
  box(g,color,[.55,.2,depth*.82],[-width*.22,-height/2-.06,0],.055);
  box(g,'#26342b',[.57,.065,depth*.72],[-width*.22,height/2+.005,0],.025);
  box(g,'#ffffff',[width*.43,.19,.035],[width*.16,0,depth/2+.025],.04).material=material('#f4f5e9',.05);
  return g;
}
export function bracket(parent,color,width=3,height=2.6,depth=.8) {
  const g=new THREE.Group();parent.add(g);
  box(g,color,[width,.55,depth],[0,height/2,0]);
  box(g,color,[width,.55,depth],[0,-height/2,0]);
  box(g,color,[.52,height,depth],[-width/2+.22,0,0]);
  box(g,color,[.55,.19,depth*.75],[-width*.22,-height/2-.31,0],.05);
  return g;
}
export function glyph(parent,text,color,position,size=.6) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.font='700 170px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,128,134);
  const texture=new THREE.CanvasTexture(canvas);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
  mesh.position.set(...position);parent.add(mesh);return mesh;
}
export function lighting(scene,shadows=false) {
  scene.add(new THREE.HemisphereLight('#e9f5ff','#374035',2.1));
  const key=new THREE.DirectionalLight('#fff4d7',4.6);key.position.set(-8,14,10);key.castShadow=shadows;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:.5,far:50});key.shadow.bias=-.0008;key.shadow.normalBias=.025;
  scene.add(key);
  const rim=new THREE.DirectionalLight('#d3e9ff',2.3);rim.position.set(8,7,-6);scene.add(rim);
}
export function disposeKit() {for(const g of geometry.values())g.dispose();for(const m of materials.values())m.dispose();geometry.clear();materials.clear();}
export function disposeScene(scene){
  const sharedGeometry=new Set(geometry.values()),sharedMaterials=new Set(materials.values());
  scene.traverse(object=>{if(!object.isMesh)return;if(!sharedGeometry.has(object.geometry))object.geometry.dispose();
    for(const m of Array.isArray(object.material)?object.material:[object.material])if(!sharedMaterials.has(m)){m.map?.dispose();m.dispose();}
  });
}
export { THREE };
