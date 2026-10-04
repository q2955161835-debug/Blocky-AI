import {THREE,box,cylinder,glyph,material} from './kit.js';
import {beam,pane,plant,finish,foundation,table} from './world-core.js';

export function library(parent){
  const g=foundation(parent,'book-library',[-3.1,.75,-3.1],5.5,2.7,'#efe0c1');
  for(let b=0;b<3;b++){
    const x=(b-1)*1.68,h=[3.0,3.55,3.15][b],ink=['#7caead','#c9957e','#91a77e'][b];
    box(g,ink,[1.53,h,.18],[x,.16+h/2,-1.07],.055);
    box(g,ink,[.17,h,2.2],[x-.68,.16+h/2,0],.045);
    for(let p=0;p<6;p++)box(g,'#f6ead0',[.038,h-.09,2.05],[x+.51+p*.021,.16+h/2,0],.009);
    box(g,ink,[1.58,.10,2.27],[x,.16+h+.05,0],.035);
    for(let p=0;p<5;p++)box(g,'#fff4dc',[1.40,.021,2.14],[x,.16+h+.11+p*.021,0],.008);
    for(let shelf=0;shelf<4;shelf++){
      const top=.16+.42+shelf*.62;
      finish(box(g,'#ad8861',[1.10,.075,.48],[x,top-.0375,-.73],.018),'wood');
      for(let i=0;i<5;i++){
        const height=.25+(i%3)*.055;
        box(g,['#88a68a','#d7af8f','#90aabc','#d7c087'][i%4],[.13,height,.18],[x-.42+i*.21,top+height/2,-.72],.012);
      }
    }
    finish(box(g,'#b89a72',[1.09,.055,.57],[x,.19,.50],.018),'wood');
    for(const dx of [-.46,.46])beam(g,[x+dx,.16,.85],[x+dx,1.10,.85],.075,ink);
    beam(g,[x-.5,1.10,.85],[x+.5,1.10,.85],.075,ink);
    glyph(g,['A','B','C'][b],'#e6eddc',[x-.68,2.40,1.12],.28);
  }
  return g;
}

export function classroom(parent){
  const g=foundation(parent,'classroom',[-3.25,0,2.65],4.3,3.55,'#d8b68d');
  // Contiguous wedge blocks sit on two full-height piers.
  const r=1.46,colors=['#81abab','#bca1b4','#dfbd7e','#e8c791','#94aca1'];
  for(let i=0;i<5;i++){
    const a=i*Math.PI/5,b=(i+1)*Math.PI/5,s=new THREE.Shape();
    s.absarc(0,0,r+.17,a,b,false);s.lineTo(Math.cos(b)*(r-.17),Math.sin(b)*(r-.17));s.absarc(0,0,r-.17,b,a,true);s.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.48,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1,curveSegments:10}),material(colors[i]));
    mesh.position.set(0,1.26,-1.28);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
  }
  for(const x of [-r,r])box(g,colors[x<0?4:0],[.34,1.1,.53],[x,.71,-1.04],.045);
  for(const x of [-.8,.8])for(const z of [-.03,.95]){
    table(g,x,z);finish(box(g,'#a7b58b',[.4,.36,.43],[x,.34,z+.48],.05),'wood');
    box(g,'#efe9d1',[.34,.018,.28],[x,.989,z],.012);
  }
  beam(g,[-.5,.16,-1.0],[-.5,1.6,-1.0],.055,'#a28b69');beam(g,[.5,.16,-1.0],[.5,1.6,-1.0],.055,'#a28b69');
  box(g,'#466d65',[1.12,.73,.075],[0,1.24,-.95],.035);
  for(let i=0;i<3;i++)box(g,'#c9d7be',[.62-i*.10,.023,.016],[-.1,1.42-i*.17,-.905],.006);
  return g;
}

export function schoolCenter(parent){
  const g=foundation(parent,'school-center',[4.50,0,3.05],2.45,2.5,'#d0af80');
  for(const x of [-.98,.98])box(g,'#e7c48f',[.30,1.82,2.1],[x,1.07,0],.06);
  box(g,'#edd8b1',[1.72,1.82,.20],[0,1.07,-.98],.065);
  box(g,'#d8bc8b',[2.35,.18,2.3],[0,2.07,0],.055);
  for(const x of [-.7,.7])box(g,'#e7c48f',[.46,1.52,.20],[x,.92,1],.04);
  box(g,'#e7c48f',[1.15,.32,.20],[0,1.82,1],.045);
  box(g,'#355c59',[.65,1.18,.10],[0,.75,1.06],.035);
  box(g,'#d6dfc7',[.52,.51,.025],[0,1.04,1.125],.014);box(g,'#d5b575',[.03,.12,.035],[.24,.65,1.13],.009);
  for(const x of [-1.14,1.14]){
    pane(g,[.025,.72,1.55],[x,1.15,0],'#91c5bd',.55);
    for(const z of [-.5,0,.5])beam(g,[x,.79,z],[x,1.51,z],.035,'#ac926d');
  }
  box(g,'#a9b69a',[1.10,.73,.88],[0,2.525,-.22],.05);
  box(g,'#d2bd8d',[1.27,.12,1.03],[0,2.95,-.22],.045);
  const dial=cylinder(g,'#f4edce',.27,.05,[0,2.54,.25]);dial.rotation.x=Math.PI/2;
  box(g,'#7e704e',[.022,.17,.025],[0,2.59,.286],.007);
  box(g,'#7e704e',[.12,.02,.025],[.05,2.54,.286],.007);
  return g;
}

export function greenhouse(parent){
  const g=foundation(parent,'greenhouse',[4.20,0,-2.30],3.60,4.00,'#c5b291');
  const w=3.14,d=3.54,bottom=.16,eave=2.30,ridge=3.12;
  for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])beam(g,[x,bottom,z],[x,eave,z],.10,'#b29265');
  for(const y of [bottom+.05,eave])for(const x of [-w/2,w/2])beam(g,[x,y,-d/2],[x,y,d/2],.085,'#b29265');
  for(const x of [-w/2,w/2]){
    pane(g,[.03,eave-bottom-.1,d-.1],[x,(eave+bottom)/2,0],'#accec1',.25);
    for(const z of [-.9,0,.9])beam(g,[x,bottom,z],[x,eave,z],.065,'#b29265');
  }
  for(const z of [-d/2,d/2]){
    beam(g,[-w/2,eave,z],[0,ridge,z],.1,'#b29265');beam(g,[0,ridge,z],[w/2,eave,z],.1,'#b29265');
    beam(g,[-w/2,eave,z],[w/2,eave,z],.075,'#b29265');
    for(const x of [-1.015,1.015])pane(g,[1.03,eave-bottom-.1,.03],[x,(eave+bottom)/2,z],'#aed3c5',.25);
    for(const x of [-.5,.5])beam(g,[x,bottom,z],[x,eave,z],.075,'#b29265');
    pane(g,[.93,.47,.025],[0,eave-.27,z],'#aed3c5',.25);
    if(z<0)pane(g,[.93,1.58,.025],[0,.98,z],'#aed3c5',.25);
  }
  const slope=Math.atan((ridge-eave)/(w/2)),length=Math.hypot(w/2,ridge-eave);
  for(const side of [-1,1]){
    const roof=pane(g,[length,.035,d],[side*w/4,(eave+ridge)/2,0],'#bce0d1',.28);roof.rotation.z=-side*slope;
    for(const z of [-d/2,0,d/2])beam(g,[side*w/2,eave,z],[0,ridge,z],.065,'#b29265');
  }
  beam(g,[0,ridge,-d/2],[0,ridge,d/2],.11,'#b29265');
  for(const x of [-.88,.88]){
    finish(box(g,'#a88e65',[.67,.32,2.30],[x,.32,0],.035),'wood');
    for(let i=0;i<4;i++)plant(g,x,.58,-.85+i*.55);
  }
  return g;
}
