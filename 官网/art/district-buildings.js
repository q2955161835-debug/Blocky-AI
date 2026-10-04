import {THREE,box,cylinder,sphere} from './kit.js';
import {beam,ring,pane,panel,finish,foundation,table} from './world-core.js';

function parcel(parent,color,x,y,z,size=.46){
  const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  box(g,color,[size,size,size],[0,size/2,0],.055);
  box(g,'#d5dfd9',[size*.15,size+.012,size+.012],[0,size/2,0],.008);
  for(let i=0;i<3;i++)box(g,'#4d6178',[.018,.08,.008],[-.10+i*.035,size*.4,size/2+.008],.003);
  return g;
}

export function fabrication(parent){
  const g=foundation(parent,'fabrication-tower',[-3.0,.40,-2.85],3.8,3.25,'#8095aa');
  for(const x of [-1.49,1.49])for(const z of [-1.14,1.14])finish(box(g,'#4b6586',[.23,4.34,.23],[x,2.33,z],.035),'metal');
  for(let level=0;level<3;level++){
    const base=.16+level*1.5;
    box(g,['#3d6bb0','#506a98','#3d6bb0'][level],[3.03,1.34,.14],[0,base+.67,-1.13],.04);
    for(const x of [-1.54,1.54]){
      pane(g,[.025,1.15,1.98],[x,base+.65,0],'#86aecd',.24);
      beam(g,[x,base,-1.1],[x,base,1.1],.07,'#7893ad');beam(g,[x,base+1.34,-1.1],[x,base+1.34,1.1],.07,'#7893ad');
    }
    for(const x of [-1.32,1.32])panel(g,'#8dcde8',[.065,.93,.035],[x,base+.65,1.265]);
    if(level>0)finish(box(g,'#879db2',[3.44,.16,2.72],[0,level*1.5+.08,0],.045),'metal');
    for(let item=0;item<3;item++)box(g,['#9aadbe','#87b9ca','#d0ccaf'][item],[.47,.34,.43],[-.65+item*.65,base+.17,-.73],.04);
  }
  box(g,'#4b6ca1',[3.5,.28,2.8],[0,4.64,0],.09);
  for(const x of [-.72,.72])cylinder(g,'#7694be',.31,.22,[x,4.89,0]);
  box(g,'#415a72',[1.13,.16,1.80],[0,.24,.20],.035);
  box(g,'#759ab0',[1.08,.035,1.70],[0,.3375,.20],.015);
  for(let i=0;i<8;i++)beam(g,[-.51,.36,-.48+i*.20],[.51,.36,-.48+i*.20],.025,'#567b94');
  const cargo=parcel(g,'#9bbfce',0,.375,.18,.46);
  cylinder(g,'#6085a3',.15,.54,[.99,.43,-.6]);
  const joints=[[.99,.74,-.6],[.72,1.29,-.6],[.12,1.46,-.36]];
  joints.forEach(p=>sphere(g,'#91adbf',.115,p));
  for(let i=0;i<2;i++)beam(g,joints[i],joints[i+1],.11,'#7896b2');
  for(const x of [.045,.195])beam(g,[x,1.46,-.36],[x,1.23,-.36],.045,'#a7bec7');
  return {group:g,animate(time,reduced){cargo.position.z=.18+(reduced?0:Math.sin(time*.4)*.24);}};
}

export function observatory(parent){
  const g=foundation(parent,'observatory',[3.35,.22,-3.05],4.3,3.85,'#647f94');
  finish(cylinder(g,'#788e9e',1.78,.12,[0,.22,0]),'metal');
  const height=2.24;
  for(const x of [-1.72,1.72]){
    beam(g,[x,.28,0],[x,height,0],.19,'#8ca3b0');
    beam(g,[x,height,0],[Math.sign(x)*1.58,height,0],.16,'#9bacb9');
    sphere(g,'#adbec7',.15,[Math.sign(x)*1.58,height,0]);
  }
  ring(g,1.58,.11,'#acbac5',[0,height,0]);
  const inner=new THREE.Group();inner.position.y=height;g.add(inner);
  ring(inner,1.13,.075,'#5889bd',[0,0,0]);sphere(inner,'#8ac4d5',.48,[0,0,0]);
  for(const side of [-1,1]){
    beam(g,[side*1.13,height,0],[side*1.58,height,0],.085,'#b0c2ca');
    beam(inner,[side*.48,0,0],[side*1.13,0,0],.075,'#b0c2ca');
  }
  box(g,'#426784',[.57,.07,.4],[0,.195,1.45],.025);
  beam(g,[0,.23,1.45],[0,.97,1.45],.09,'#7899b0');
  box(g,'#3e5d79',[.98,.53,.10],[0,1.03,1.46],.035);
  panel(g,'#94d3dc',[.84,.39,.022],[0,1.03,1.523]);
  for(let i=0;i<3;i++)box(g,'#317c96',[.48-i*.07,.018,.012],[-.08,1.15-i*.12,1.54],.004);
  return {group:g,animate(time,reduced){inner.rotation.x=.58+(reduced?0:Math.sin(time*.28)*.20);}};
}

export function delivery(parent){
  const g=foundation(parent,'delivery-center',[3.50,.26,2.75],4.45,3.20,'#7b839f');
  for(const x of [-1.73,1.73])box(g,'#716890',[.25,2.2,2.32],[x,1.26,0],.045);
  box(g,'#797198',[3.47,2.20,.14],[0,1.26,-1.09],.045);
  box(g,'#b0a6cd',[3.97,.20,2.70],[0,2.46,0],.08);
  for(const x of [-.65,.65])cylinder(g,'#b0a6cd',.235,.16,[x,2.64,0]);
  box(g,'#817aa0',[3.23,.4,.21],[0,2.16,1.045],.05);
  panel(g,'#c1d0df',[1.23,.27,.018],[0,2.16,1.16]);
  for(let i=0;i<3;i++)box(g,['#7877a3','#91b49d','#7babc3'][i],[.20,.11,.014],[-.32+i*.32,2.16,1.174],.018);
  for(const x of [-1.87,1.87]){
    pane(g,[.025,.76,1.75],[x,1.72,0],'#b4b5d7',.40);
    beam(g,[x,1.34,-.9],[x,1.34,.9],.055,'#b2a9c5');
  }
  box(g,'#4a5372',[2.73,.14,.84],[0,.23,.40],.025);
  box(g,'#9ba7be',[2.64,.035,.76],[0,.3175,.40],.012);
  for(let i=0;i<12;i++)beam(g,[-1.2+i*.22,.344,.04],[-1.2+i*.22,.344,.76],.018,'#74889f');
  const packages=[-1,0,1].map((n,i)=>parcel(g,['#c3b9db','#a2c5d3','#dbcbaa'][i],n*.67,.355,.38,.43));
  box(g,'#4d5674',[1.37,.16,.45],[0,.24,-.71],.025);
  box(g,'#334761',[1.30,.83,.075],[0,1.17,-.68],.04);
  panel(g,'#9cc7d5',[1.11,.64,.021],[0,1.17,-.63]);
  for(let i=0;i<3;i++)box(g,'#7f9bad',[.73-i*.12,.031,.014],[-.10,1.33-i*.15,-.612],.007);
  for(const x of [-.5,.5])beam(g,[x,.32,-.71],[x,.78,-.71],.07,'#76819e');
  return {group:g,animate(time,reduced){packages.forEach((p,i)=>{p.position.x=(i-1)*.67+(reduced?0:Math.sin(time*.45+i)*.08);});}};
}

export function research(parent){
  const g=foundation(parent,'research-lab',[-2.6,.16,3.25],4.25,3.3,'#849bad');
  for(const x of [-1.86,1.86])for(const z of [-1.39,1.39])beam(g,[x,.16,z],[x,2.34,z],.10,'#7f9dab');
  box(g,'#abc7d6',[4.03,.16,3.08],[0,2.42,0],.055);
  for(const x of [-1.86,1.86]){
    pane(g,[.025,2.04,2.68],[x,1.25,0],'#accedc',.26);
    for(const y of [.20,2.30])beam(g,[x,y,-1.4],[x,y,1.4],.08,'#86a4b3');
  }
  pane(g,[3.6,2.04,.025],[0,1.25,-1.4],'#aed0df',.24);
  for(const x of [-1.18,1.18]){
    pane(g,[1.18,2.04,.025],[x,1.25,1.4],'#aed0df',.24);
    for(const xx of [x-.59,x+.59])beam(g,[xx,.20,1.4],[xx,2.30,1.4],.055,'#86a4b3');
  }
  beam(g,[-1.86,2.3,1.4],[1.86,2.3,1.4],.07,'#86a4b3');
  for(const x of [-.88,.88]){
    table(g,x,-.22,{screen:true});box(g,'#718ea4',[.44,.4,.48],[x,.36,.63],.05);
  }
  return {group:g,animate(){}};
}
