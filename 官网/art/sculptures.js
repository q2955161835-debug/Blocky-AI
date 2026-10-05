import {THREE,block,bracket,glyph} from './kit.js';
import {mascot} from './characters.js';
import {heroExpressions} from './expressions.js';

export function heroSculpture(scene){
  const root=new THREE.Group();scene.add(root);let hovered=null,clicked=-100;
  const palette=['#dc5aac','#5361d7','#e9cb58','#4eba9b','#a7c86c','#a080cb'];
  const positions=[[-.32,.26,1.25], [.32,.25,1.05],[-.41,-.12,.8],[.4,-.23,1.2],[-.29,-.34,1.1],[.23,-.37,.95],[-.45,.33,.55],[.44,.36,.6],[-.43,.05,.45],[.45,.03,.6],[-.08,.39,.42],[.1,-.44,.45],[-.45,-.4,.48],[.43,-.43,.55],[-.2,.36,.45],[.2,.36,.5],[-.13,-.39,.45],[.34,.06,.42],[-.34,.1,.46],[.05,.41,.36]];
  const objects=positions.map(([x,y,s],i)=>{
    const color=palette[i%palette.length],character=i<6||i===11?mascot(root,{color,expression:heroExpressions[i%heroExpressions.length]}):null;
    const mesh=character?.root||(i%6===0?bracket(root,color,1.4,1.1,.45):block(root,color,1.5,.55,.7));
    mesh.scale.setScalar(s);mesh.traverse(child=>{child.userData.owner=mesh;});
    return {mesh,character,x,y,s,phase:i,rotation:[.15+(i%3)*.12,(i%4-.8)*.16,(i%2?.12:-.17)]};
  });
  return {root,interact(ray,type){
    hovered=ray?.intersectObjects(objects.map(o=>o.mesh),true)[0]?.object.userData.owner||null;
    if(hovered&&type==='click')clicked=performance.now()/1000;return !!hovered;
  },update(time,progress,pointer,reduced,aspect=1.6,context){
    const height=8.45,age=time-clicked,wave=reduced||age>.9?0:Math.sin(age/.9*Math.PI)*.32;
    for(const o of objects){
      const narrow=aspect<.9,px=o.x*height*aspect,py=o.y*height;
      // On phones the side clusters move to the upper/lower frame, keeping copy clear.
      const x=narrow?o.x*height*aspect*1.12:px,y=narrow?(Math.abs(o.y)<.2?Math.sign(o.x)*3.15:Math.sign(o.y)*(2.9+Math.abs(o.y)*1.1)):py;
      const over=o.mesh===hovered&&!reduced?1:0;
      const target=new THREE.Vector3(x+wave*Math.sign(x)+(reduced?0:pointer.x*.12),y+(reduced?0:Math.sin(time*.6+o.phase)*.1)+over*.12,-(o.phase%3)*.5+over*.22);
      if(!o.initialized){o.mesh.position.copy(target);o.initialized=true;}else o.mesh.position.lerp(target,reduced?1:.12);
      const scale=o.s*(narrow?.63:1);o.mesh.scale.setScalar(scale);
      o.mesh.rotation.set(o.rotation[0],o.rotation[1]+over*.13,o.rotation[2]+(reduced?0:Math.sin(time*.4+o.phase)*.035));
      o.character?.look(pointer,reduced,context);
    }
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
