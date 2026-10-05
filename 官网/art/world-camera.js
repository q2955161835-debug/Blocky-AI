import {THREE} from './kit.js';

const paths={
  education:[[-.44,.60,23],[-.79,.58,17],[-.34,.50,15],[.64,.53,18],[1.02,.55,17]],
  professional:[[-.53,.60,24],[-.77,.58,18],[1.04,.55,18],[.57,.51,16],[-.43,.52,16]]
};

export function worldCamera(type,model){
  model.root.updateMatrixWorld(true);
  const centers=model.focus.map(part=>new THREE.Box3().setFromObject(part,true).getCenter(new THREE.Vector3()));
  const outline=[];
  model.root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])outline.push(new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld));
  });
  let last='';
  return function pose(view,amount){
    const tour=view.element.parentElement,r=view.element.getBoundingClientRect(),reading=tour.classList.contains('reading');
    const safe=reading?{left:20,right:r.width-20,top:16,bottom:r.height-16}:{left:Number(tour.dataset.safeLeft),right:Number(tour.dataset.safeRight),top:Number(tour.dataset.safeTop),bottom:Number(tour.dataset.safeBottom)};
    const signature=[amount,r.width,r.height,reading,...Object.values(safe)].join(':');if(signature===last)return;last=signature;
    const lo=Math.min(4,Math.max(0,Math.floor(amount))),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(amount-lo,0,1);
    const [a,e,d]=paths[type][lo].map((v,i)=>THREE.MathUtils.lerp(v,paths[type][hi][i],mix));
    // Fit the connected world in the transparent space beside the copy.
    const target=centers[0].clone().lerp(centers[lo].clone().lerp(centers[hi],mix),.42);
    const centerX=(safe.left+safe.right)/2,centerY=(safe.top+safe.bottom)/2;
    const halfX=Math.max(.02,(safe.right-safe.left)/r.width*.94),halfY=Math.max(.02,(safe.bottom-safe.top)/r.height*.94);
    const nx=centerX/r.width*2-1,ny=1-centerY/r.height*2;
    view.camera.setViewOffset(r.width,r.height,r.width/2-centerX,r.height/2-centerY,r.width,r.height);
    const position=new THREE.Vector3(Math.sin(a)*d,1+Math.tan(e)*d,Math.cos(a)*d);
    for(let attempt=0;attempt<8;attempt++){
      view.camera.position.copy(position);view.camera.lookAt(target);view.camera.updateMatrixWorld();let excess=1;
      for(const vertex of outline){const p=vertex.clone().project(view.camera);excess=Math.max(excess,Math.abs(p.x-nx)/halfX,Math.abs(p.y-ny)/halfY);}
      if(excess<=1.001)break;position.sub(target).multiplyScalar(excess*1.015).add(target);
    }
    view.camera.far=Math.max(100,position.length()+30);view.camera.updateProjectionMatrix();
    view.camera.position.copy(position);view.camera.lookAt(target);view.camera.updateMatrixWorld();
  };
}
