import {THREE} from './kit.js';

const paths={
  education:[[-.44,.60],[.10,.20],[-.44,.40],[.72,.36],[.94,.38]],
  professional:[[-.53,.60],[-.45,.32],[.48,.38],[.52,.31],[-.62,.32]]
};

export function worldCamera(type,model){
  model.root.updateMatrixWorld(true);
  const bounds=model.focus.map(part=>new THREE.Box3().setFromObject(part,true));
  model.root.traverse(part=>{const index=part.userData.worldFocus;if(index>0)bounds[index].union(new THREE.Box3().setFromObject(part,true));});
  const centers=bounds.map(b=>b.getCenter(new THREE.Vector3()));
  const extents=bounds.map(b=>b.getSize(new THREE.Vector3()).multiplyScalar(.5));
  let last='';
  return function pose(view,amount){
    const tour=view.element.parentElement,r=view.element.getBoundingClientRect(),reading=tour.classList.contains('reading');
    const safe=reading?{left:20,right:r.width-20,top:16,bottom:r.height-16}:{left:Number(tour.dataset.safeLeft),right:Number(tour.dataset.safeRight),top:Number(tour.dataset.safeTop),bottom:Number(tour.dataset.safeBottom)};
    const signature=[amount,r.width,r.height,reading,...Object.values(safe)].join(':');if(signature===last)return;last=signature;
    const progress=reading?0:THREE.MathUtils.clamp(amount,0,4);
    model.focusAt?.(progress);
    const lo=Math.floor(progress),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(progress-lo,0,1);
    const [a,e]=paths[type][lo].map((v,i)=>THREE.MathUtils.lerp(v,paths[type][hi][i],mix));
    const target=centers[lo].clone().lerp(centers[hi],mix);
    const extent=extents[lo].clone().lerp(extents[hi],mix),outline=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])outline.push(target.clone().add(new THREE.Vector3(x*extent.x,y*extent.y,z*extent.z)));
    const centerX=(safe.left+safe.right)/2,centerY=(safe.top+safe.bottom)/2;
    const halfX=Math.max(.02,(safe.right-safe.left)/r.width*.90),halfY=Math.max(.02,(safe.bottom-safe.top)/r.height*.90);
    view.camera.fov=42;view.camera.setViewOffset(r.width,r.height,r.width/2-centerX,r.height/2-centerY,r.width,r.height);
    const direction=new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e));
    const right=new THREE.Vector3(Math.cos(a),0,-Math.sin(a)),up=new THREE.Vector3().crossVectors(direction,right);
    const tangent=Math.tan(THREE.MathUtils.degToRad(view.camera.fov/2));
    let distance=2;
    // Solve the perspective bounds directly, avoiding iterative zoom jumps.
    for(const vertex of outline){
      const offset=vertex.clone().sub(target);
      distance=Math.max(distance,offset.dot(direction)+Math.max(Math.abs(offset.dot(right))/(tangent*view.camera.aspect*halfX),Math.abs(offset.dot(up))/(tangent*halfY)));
    }
    // A gentle outward arc creates breathing room before settling into a close-up.
    view.camera.position.copy(target).addScaledVector(direction,distance*(1+Math.sin(mix*Math.PI)*.10));
    view.camera.far=Math.max(100,view.camera.position.length()+30);view.camera.updateProjectionMatrix();view.camera.lookAt(target);view.camera.updateMatrixWorld();
  };
}
