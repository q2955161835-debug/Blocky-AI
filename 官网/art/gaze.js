import {THREE} from './kit.js';

// Saturation controls angle; damping controls how quickly the face settles.
export function gazeResponse(offset){return Math.tanh(offset*1.65);}

export function facePointer(head,pointer,context){
  if(pointer.active===false)return {x:0,y:0};
  if(!context)return {x:gazeResponse(pointer.x),y:gazeResponse(pointer.y)};
  const {camera,rect,width,height}=context;
  head.updateWorldMatrix(true,false);
  const face=new THREE.Vector3(0,.08,.63).applyMatrix4(head.matrixWorld).project(camera);
  const centerX=rect.left+(face.x+1)*rect.width/2,centerY=rect.top+(1-face.y)*rect.height/2;
  const mouseX=(pointer.x+1)*width/2,mouseY=(1-pointer.y)*height/2;
  return {x:gazeResponse((mouseX-centerX)/(width/2)),y:gazeResponse((centerY-mouseY)/(height/2))};
}
