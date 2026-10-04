import {THREE,sphere} from './kit.js';
import {educationWorld} from './education-world.js';
import {professionalWorld} from './professional-world.js';

export function worldScene(scene,type){
  const root=new THREE.Group();scene.add(root);
  const model=type==='education'?educationWorld(root):professionalWorld(root);
  const marker=sphere(root,type==='education'?'#edc683':'#9cd7f2',.11,[0,2,0]);
  return {root,...model,marker,update(time,progress,pointer,reduced){
    model.animate(time,pointer,reduced);marker.scale.setScalar(reduced?1:1+Math.sin(time*2)*.1);
  }};
}
