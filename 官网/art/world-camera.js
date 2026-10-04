import {THREE} from './kit.js';

const paths={
  education:[[-.44,.53,23],[-.79,.36,17],[-.34,.32,15],[.22,.35,18],[1.02,.32,17]],
  professional:[[-.53,.53,24],[-.77,.36,18],[1.04,.34,18],[.57,.29,16],[-.43,.30,16]]
};

export function worldCamera(type,model){
  model.root.updateMatrixWorld(true);
  const bounds=model.focus.map(part=>new THREE.Box3().setFromObject(part,true));
  const centers=bounds.map(b=>b.getCenter(new THREE.Vector3()));
  const points=model.focus.map(part=>{
    const list=[];part.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const positions=mesh.geometry.getAttribute('position'),stride=Math.max(1,Math.floor(positions.count/40));
      for(let i=0;i<positions.count;i+=stride)list.push(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld));
    });return list;
  });
  let frames,aspect;
  function fit(camera){
    aspect=camera.aspect;
    frames=paths[type].map(([a,e,r],index)=>{
      const target=centers[index],position=new THREE.Vector3(Math.sin(a)*r,1+Math.tan(e)*r,Math.cos(a)*r),probe=camera.clone();
      probe.clearViewOffset();probe.updateProjectionMatrix();
      for(let attempt=0;attempt<4;attempt++){
        probe.position.copy(position);probe.lookAt(target);probe.updateMatrixWorld();let excess=1;
        for(const vertex of points[index]){const p=vertex.clone().project(probe);excess=Math.max(excess,Math.abs(p.x)/.87,Math.abs(p.y)/.78);}
        if(excess<=1.001)break;position.sub(target).multiplyScalar(excess*1.015).add(target);
      }
      const radius=Math.hypot(position.x,position.z);
      return [Math.atan2(position.x,position.z),Math.atan2(position.y-1,radius),radius];
    });
  }
  return function pose(view,amount){
    if(aspect!==view.camera.aspect)fit(view.camera);
    const lo=Math.min(4,Math.max(0,Math.floor(amount))),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(amount-lo,0,1);
    const [a,e,r]=frames[lo].map((v,i)=>THREE.MathUtils.lerp(v,frames[hi][i],mix));
    const target=centers[lo].clone().lerp(centers[hi],mix),position=new THREE.Vector3(Math.sin(a)*r,1+Math.tan(e)*r,Math.cos(a)*r);
    // Travel on an exterior orbit, fitted to actual model outlines at each stop.
    // No linear chord can cut through the campus or its tallest structures.
    view.camera.clearViewOffset();view.camera.position.copy(position);view.camera.lookAt(target);view.camera.updateMatrixWorld();
  };
}
