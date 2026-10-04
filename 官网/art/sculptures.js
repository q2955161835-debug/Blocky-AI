import {THREE, block, bracket, box, sphere, cylinder, glyph} from './kit.js';

export function heroSculpture(scene) {
  const root=new THREE.Group();scene.add(root);root.rotation.set(.15,-.4,-.12);
  const frame=bracket(root,'#e5f680',3.9,3.6,1.1);frame.position.set(.2,.25,0);
  const nested=bracket(root,'#f5f3e5',2.55,2.15,.95);nested.position.set(.55,.25,.35);
  const inner=block(root,'#a1b49a',1.75,.6,.85);inner.position.set(.85,.35,.65);
  const objects=[];let hovered=null,clickedAt=-100;
  [['#e5f680',[-2.4,2.35,.4],1.8],['#eff0df',[2.8,2.1,-.4],1.45],['#8caa85',[-2.7,-1.15,1],1.5],['#cbd5a5',[2.4,-1.9,.8],1.95],['#3d5744',[-1,-2.75,-.2],1.3],
    ['#eff0df',[-3.55,1.25,-1.1],.85],['#c5d49a',[3.35,.8,-.6],.9],['#667d53',[1.1,3.2,-1.2],1.1],['#d5dfbe',[-1,3.2,-1.4],.75],
    ['#e5f680',[-3.6,-2.4,-.8],1.1],['#f4f2e4',[.65,-3.4,-1],.9],['#9aaa79',[3.5,-3,-1.5],.8],['#bacb92',[-2.5,-3.5,-1.6],.75],
    ['#f0f3de',[3.7,3.25,-1.7],.9],['#849975',[-3.8,3.15,-1.8],.85]].forEach(([color,p,w],i)=>{
    const mesh=block(root,color,w,i<5?.72:.48,i<5?1:.65);mesh.position.set(...p);const rotation=[.18+(i%4)*.13,(i%5)*.4,.25-(i%4)*.2];mesh.rotation.set(...rotation);mesh.children.forEach(child=>child.userData.owner=mesh);objects.push({mesh,p:[...p],rotation,phase:i});
  });
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.53,.12,12,48),new THREE.MeshPhysicalMaterial({color:'#edf4bf',metalness:.68,roughness:.2}));ring.position.set(2.2,.35,1.25);ring.rotation.set(.4,.2,.3);root.add(ring);
  sphere(root,'#e5f680',.22,[-2,0,2]);glyph(nested,'✦','#405332',[.7,.25,.88],.65);
  return {root,interact(ray,type){
    hovered=ray?.intersectObjects(objects.flatMap(o=>o.mesh.children),false)[0]?.object.userData.owner||null;
    if(hovered&&type==='click')clickedAt=performance.now()/1000;
    return !!hovered;
  },update(time,progress,pointer,reduced){
    root.rotation.y=-.4+(reduced?0:Math.sin(time*.2)*.09+pointer.x*.12);
    root.rotation.x=.15+(reduced?0:pointer.y*.06);root.rotation.z=-.12+(reduced?0:progress*.22);
    objects.forEach(({mesh,p,rotation,phase})=>{
      const age=time-clickedAt,wave=reduced||age>1.5?0:Math.sin(Math.max(0,age)*Math.PI/1.5)*.55,over=mesh===hovered&&!reduced?1:0;
      const target=new THREE.Vector3(p[0]+wave*Math.sign(p[0])*.7+over*.2,p[1]+(reduced?0:Math.sin(time*.6+phase)*.12)+wave*Math.sign(p[1])*.65+over*.18,p[2]+over*.25);
      mesh.position.lerp(target,reduced?1:.14);mesh.rotation.set(rotation[0]+over*.12,rotation[1]+over*.24+wave*.25,rotation[2]-over*.12);
    });
  }};
}
export function assemblySculpture(scene) {
  const root=new THREE.Group();scene.add(root);root.rotation.set(.15,-.3,-.12);
  const pieces=['#e5f680','#bb9ddd','#8cb7e8','#8cc9af','#9bcbd4'].map((color,i)=>{const m=block(root,color,3-i*.12,.63,.9);m.position.set(0,1.5-i*.68,0);return m;});
  glyph(root,'✦','#263b29',[.65,.16,.6],.42);
  return {root,update(time,progress,pointer,reduced){
    const amount=reduced?1:THREE.MathUtils.smoothstep(progress,.12,.78);
    pieces.forEach((piece,i)=>{piece.position.x=(1-amount)*(i%2?1:-1)*(1.2+i*.12);piece.position.y=1.5-i*.68+(1-amount)*(2-i)*.5;piece.rotation.y=(1-amount)*(i-2)*.32;});
    root.rotation.y=-.3+(reduced?0:pointer.x*.1);
  }};
}
