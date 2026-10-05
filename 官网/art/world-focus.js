import {THREE} from './kit.js';

// Recede surrounding architecture during a detail shot without covering the
// transparent copy or changing any building geometry.
export function worldFocus(root,subjects){
  let records;
  return progress=>{
    if(!records){
      const materials=new Map();records=[];
      root.traverse(mesh=>{
        if(!mesh.isMesh||mesh.userData.alwaysVisible)return;
        let owner=mesh,index=-1;
        while(owner&&owner!==root){index=owner.userData.worldFocus??subjects.indexOf(owner);if(index>0)break;owner=owner.parent;}
        const key=index>0?index:-1;
        if(!materials.has(key))materials.set(key,new Map());
        const copies=materials.get(key),original=mesh.material;
        if(!copies.has(original)){const material=original.clone();material.transparent=true;copies.set(original,{material,opacity:original.opacity,depthWrite:original.depthWrite});}
        const entry=copies.get(original);mesh.material=entry.material;
        records.push({mesh,index:key,entry,shadow:mesh.castShadow});
      });
    }
    const lo=Math.floor(progress),hi=Math.min(4,lo+1),mix=THREE.MathUtils.smoothstep(progress-lo,0,1);
    for(const {mesh,index,entry,shadow} of records){
      const weight=(lo===0||lo===index?1-mix:0)+(hi===0||hi===index?mix:0);
      const visibility=.06+.94*weight;
      entry.material.opacity=entry.opacity*visibility;
      entry.material.depthWrite=visibility>.999&&entry.depthWrite;
      mesh.castShadow=shadow&&visibility>.9;
    }
  };
}
