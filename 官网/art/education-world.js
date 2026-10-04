import {THREE,box,cylinder,block,sphere} from './kit.js';
import {beam,tree,pane,plant} from './world-core.js';
import {mascot} from './characters.js';

function library(root,x,z){
  const g=new THREE.Group();g.position.set(x,1.3,z);root.add(g);
  // Each giant book is an inhabited open bay, with pages wrapping the roof.
  for(let b=0;b<3;b++){
    const bx=-1.85+b*1.55,h=2.8+b*.35,color=['#88b7b5','#ddb49c','#a4b585'][b];
    box(g,color,[1.4,h,.2],[bx,h/2,-.8],.12);box(g,color,[.17,h,1.7],[bx-.63,h/2,0],.07);
    box(g,'#f0e6cd',[1.35,.2,1.9],[bx,h,.05],.06);
    for(let page=0;page<5;page++)box(g,'#fff4df',[1.26,.018,1.82],[bx,h+.06+page*.038,.04],.008);
    for(let shelf=0;shelf<3;shelf++){
      box(g,'#ad8861',[1.17,.08,.5],[bx,.6+shelf*.65,-.47],.025);
      for(let i=0;i<5;i++){const book=box(g,['#8eab80','#cea089','#8fa9bd','#d5be88'][i%4],[.13,.28+(i%2)*.08,.2],[bx-.43+i*.21,.8+shelf*.65,-.41],.02);book.rotation.z=(i-2)*.035;}
    }
  }
  for(let i=0;i<5;i++)box(root,'#eed9b6',[1.6,.2+i*.17,.42],[x, .2+i*.085,z+2.5-i*.4],.04);
}
function classroom(root,x,z){
  const g=new THREE.Group();g.position.set(x,.34,z);root.add(g);
  box(g,'#e2ba8d',[4,.22,2.8],[0,0,0],.1);
  const colors=['#83b6b6','#c9a0ac','#e4bb72','#edc989','#92aaa9'];
  for(let i=0;i<5;i++){
    const angle=Math.PI*(i+.5)/5,m=box(g,colors[i],[.9,.9,.55],[Math.cos(angle)*1.4,Math.sin(angle)*1.4+.8,-.72],.1);m.rotation.z=angle-Math.PI/2;
  }
  for(const sx of [-1.4,1.4])box(g,colors[sx<0?0:4],[.6,.85,.55],[sx,.53,-.72],.08);
  for(let i=0;i<4;i++){
    const dx=(i%2)*1.5-.75,dz=Math.floor(i/2)*.85-.15;box(g,'#cfab76',[1,.1,.6],[dx,.7,dz]);
    for(const lx of [-.33,.33])box(g,'#a98455',[.065,.6,.065],[dx+lx,.37,dz],.02);
    box(g,['#adc696','#c8a4bd'][i%2],[.36,.34,.35],[dx,.29,dz+.48],.06);
  }
  box(g,'#faf1d9',[.95,.62,.12],[0,1.08,-.68],.04);
}
function greenhouse(root,x,z){
  const g=new THREE.Group();g.position.set(x,.34,z);root.add(g);const w=2.8,d=3.5,h=2;
  box(g,'#c4af86',[w+.35,.18,d+.35],[0,0,0],.08);
  for(const xx of [-w/2,w/2])for(const zz of [-d/2,d/2])beam(g,[xx,0,zz],[xx,h,zz],.09,'#be9a62');
  for(const xx of [-w/2,w/2])pane(g,[.06,h,d],[xx,h/2,0]);
  for(const zz of [-d/2,d/2]){
    pane(g,[w,h,.04],[0,h/2,zz]);beam(g,[-w/2,h,zz],[0,h+.95,zz],.1,'#be9a62');beam(g,[0,h+.95,zz],[w/2,h,zz],.1,'#be9a62');
  }
  for(const side of [-1,1]){const roof=pane(g,[1.7,.035,d],[side*.67,h+.48,0]);roof.rotation.z=side*-.59;}
  beam(g,[0,h+.95,-d/2],[0,h+.95,d/2],.11,'#be9a62');
  for(let i=0;i<12;i++)plant(g,-.8+(i%3)*.8,.3,-1.15+Math.floor(i/3)*.75);
}
export function educationWorld(root){
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++){
    if(x===1)continue;const elevated=x<0&&z<0,h=.65+(elevated?.95:0)+((x+z)%3===0?.18:0);
    box(root,(x+z)%2?'#e6c7a4':'#f0dfbd',[1.75,h,1.75],[x*1.75,h/2-.7,z*1.75],.2);
  }
  box(root,'#82c7bf',[1.7,.16,11.9],[1.75,-.62,0],.13);
  const ripples=[];for(let i=0;i<13;i++){const m=box(root,'#c7ece0',[.58,.026,.05],[1.75+(i%3-.8)*.28,-.51,-5.5+i*.85],.012);ripples.push(m);}
  library(root,-3.15,-3);classroom(root,-3,2.7);greenhouse(root,4.4,-2.2);
  const school=new THREE.Group();school.position.set(-.6,.65,-4.4);root.add(school);
  for(let i=0;i<3;i++){const b=block(school,['#e4bd7c','#f5e5c7','#aac197'][i],1.35,.6,1.2);b.position.y=i*.72;}
  cylinder(school,'#f5ead1',.4,.12,[0,2.48,.66]).rotation.x=Math.PI/2;
  box(school,'#ab8352',[.035,.24,.12],[0,2.47,.75],.015).rotation.z=-.3;
  for(let i=0;i<10;i++)box(root,'#b99a6c',[.27,.1,1.15],[.45+i*.3,.2,2.55],.04);
  for(const side of [-1,1]){beam(root,[.5,.75,2.55+side*.53],[3.15,.75,2.55+side*.53],.045,'#ac8d5e');for(let i=0;i<5;i++)beam(root,[.6+i*.6,.15,2.55+side*.53],[.6+i*.6,.78,2.55+side*.53],.045,'#ac8d5e');}
  for(const [x,z,s] of [[-5,4,1.1],[-5,-5,.9],[5,4,1],[5.7,-5,1.2],[-.6,5.3,.8],[3.4,-5.3,.8]])tree(root,x,.15,z,s);
  for(let i=0;i<8;i++)plant(root,3.65+(i%2)*.9,.25,3.5+Math.floor(i/2)*.55);
  const character=mascot(root);character.root.position.set(-1.4,.6,1);character.root.scale.setScalar(.4);
  return {anchors:[new THREE.Vector3(0,2,0),new THREE.Vector3(-3.15,4,-3),new THREE.Vector3(-3,2,2.7),new THREE.Vector3(-.6,2.7,-4.4),new THREE.Vector3(4.4,2.7,-2.2)],animate(time,pointer,reduced){character.look(pointer,reduced);if(!reduced)ripples.forEach((m,i)=>{m.position.x=1.75+Math.sin(time*.6+i)*.28;});}};
}
