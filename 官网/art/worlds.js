import {THREE,box,block,cylinder,sphere,glyph} from './kit.js';

function tree(parent,x,z,color,scale=1) {
  const group=new THREE.Group();group.position.set(x,0,z);group.scale.setScalar(scale);parent.add(group);
  cylinder(group,'#a98c61',.1,.9,[0,.65,0],8);
  box(group,color,[.8,.9,.8],[0,1.35,0],.24);box(group,color,[.55,.6,.55],[0,1.9,0],.2);
}
function building(parent,x,z,w,h,d,color,type) {
  const group=new THREE.Group();group.position.set(x,0,z);parent.add(group);
  box(group,'#e4d9be',[w+.55,.25,d+.55],[0,.22,0]);
  const floors=Math.max(2,Math.round(h/.7));
  for(let i=0;i<floors;i++){
    const row=block(group,i%2?color:'#f1ead9',w,.58,d);row.position.set(0,.7+i*.68,0);
    for(let j=0;j<Math.floor(w/.75);j++)box(group,type==='professional'?'#4f7496':'#789496',[.32,.29,.07],[-w*.34+j*.73,.73+i*.68,d/2+.04],.035);
  }
  box(group,color,[w+.25,.24,d+.22],[0,.53+floors*.68,0]);
  box(group,'#334b45',[.45,.65,.08],[0,.59,d/2+.07],.08);
  return {group,top:.72+floors*.68};
}
export const destinations={
  education:[[-4.3,0,1.8],[.3,0,-3.6],[4,0,1.2],[-.2,0,4.2]],
  professional:[[-4,0,-1.5],[.2,0,-3.5],[4.1,0,.1],[-.4,0,4]],
};
export function worldScene(scene,type) {
  const education=type==='education',root=new THREE.Group();scene.add(root);
  const accent=education?'#deb274':'#89b8dc',green=education?'#96ad73':'#81a6a0';
  const island=cylinder(root,education?'#c6ad89':'#607d93',8,.45,[0,-.25,0],64);
  cylinder(root,education?'#e4d6b8':'#cad8dd',7.8,.15,[0,.015,0],64);
  // Four connected capability buildings, designed from the same block grammar.
  const points=destinations[type],buildings=[];
  for(let i=0;i<4;i++) {
    const p=points[i];const b=building(root,p[0],p[2],i===2?2:2.55,i===2?3.7:2.25,i===3?1.65:2.1,accent,type);buildings.push(b);
    glyph(b.group,['✦','≡','◇','π'][i],education?'#87622e':'#284a68',[0,b.top+.06,1.08],.62);
    for(let s=0;s<7;s++){const f=s/7;box(root,education?'#ba995f':'#83a5b5',[.35,.055,.35],[p[0]*(1-f),.14,p[2]*(1-f)],.045);}
  }
  // Central nested-block pavilion: an original symbol for a shared project language.
  cylinder(root,education?'#b7975f':'#587c9a',1.35,.24,[0,.3,0]);
  const central=new THREE.Group();root.add(central);central.rotation.y=-.5;
  for(let i=0;i<3;i++){const b=block(central,['#e5f680',accent,'#f3efe1'][i],1.8-i*.25,.45,.8);b.position.set(0,.75+i*.5,0);b.rotation.y=i*.17;}
  sphere(root,'#f4f2cf',.16,[0,2.4,0]);
  if(education){
    // Knowledge-library books, workshop desks and the campus botanical project.
    for(let i=0;i<5;i++)box(buildings[0].group,['#b895be','#8da9bb','#97b989'][i%3],[.25,.65,.2],[-.8+i*.35,buildings[0].top+.45,0]);
    for(let i=0;i<4;i++)box(root,'#d4ae72',[.65,.25,.45],[-1.3+(i%2)*1.2,.3,-1.8+Math.floor(i/2)*.65]);
    for(let i=0;i<6;i++){
      const x=-2+(i%3)*1.25,z=5.3+Math.floor(i/3)*.65;box(root,'#aa8661',[.95,.18,.45],[x,.25,z]);
      sphere(root,'#86a65a',.22,[x,.57,z]);sphere(root,'#b8cc7a',.15,[x+.23,.58,z]);
    }
  }else{
    // A compositional lab, observatory, delivery towers and a shared research desk.
    for(let i=0;i<3;i++){const b=block(root,['#b89ece','#88b2c1','#bad1ce'][i],1,.34,.5);b.position.set(-5+i*.75,.55,-3.4);b.rotation.y=.2;}
    const dish=new THREE.Mesh(new THREE.TorusGeometry(.58,.085,8,32),new THREE.MeshStandardMaterial({color:'#d9edf2',metalness:.5,roughness:.3}));dish.position.set(.2,buildings[1].top+1,-3.5);dish.rotation.set(.6,.2,0);root.add(dish);
    for(let i=0;i<4;i++)box(root,'#779bae',[.28,.3+i*.18,.28],[3.6+i*.42,.28+i*.09,2.3]);
    box(root,'#415f79',[2.6,.2,1.3],[-.4,.55,5.9]);
    for(let i=0;i<3;i++)box(root,'#bcd7df',[.6,.55,.08],[-1.2+i*.8,.95,5.75]);
  }
  for(let i=0;i<12;i++){const angle=i/12*Math.PI*2;tree(root,Math.cos(angle)*6.65,Math.sin(angle)*6.65,green,.7+(i%3)*.12);}
  const anchors=[new THREE.Vector3(0,2,0),...points.map((p,i)=>new THREE.Vector3(p[0],buildings[i].top,p[2]))];
  const marker=sphere(root,education?'#ffdd8c':'#a9dcff',.13,[0,2,0]);
  return {root,anchors,marker,update(time,progress,pointer,reduced){
    central.rotation.y=-.5+(reduced?0:Math.sin(time*.35)*.12);
    marker.scale.setScalar(reduced?1:1+Math.sin(time*2)*.12);
  }};
}
