import {THREE,box,block,bracket} from '/art/kit.js';
import {mascot} from '/art/characters.js';

export function label(parent,text,position,width=3.1,height=.52,color='#f6f7ef'){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=192;
 const ctx=canvas.getContext('2d');ctx.font='700 116px "Microsoft YaHei"';ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,98);
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));mesh.position.set(...position);parent.add(mesh);return mesh;
}
export function makeWorld(scene){
 const root=new THREE.Group();scene.add(root);
 const giant=bracket(root,'#8366c4',12.5,6.5,7);giant.position.set(0,3.05,-.75);
 label(giant,'重复',[0,3.25,3.535],2.1,.56);
 box(root,'#2d3942',[11.2,.18,5.7],[0,.04,-.1],.04);
 const back=new THREE.Group();root.add(back);back.position.set(0,.13,-2.92);
 box(back,'#30404b',[11.1,5.75,.2],[0,2.875,0],.03);
 for(let i=0;i<7;i++)box(back,'#40515a',[10.6,.018,.024],[0,.70+i*.7,.105],.01);
 const slats=[],supports=[];for(let i=0;i<9;i++){slats.push(box(root,'#51606c',[.82,.6,5.7],[4.95,.43+i*.61,-.1],.055));supports.push(box(root,'#3c4b53',[.75,1,5.5],[4.95,0,-.1],.04));}
 const old=block(root,'#e4ae48',3.7,.70,.76);old.position.set(-.3,5.52,3.08);label(old,'一直向前',[0,0,.411],2.9,.34,'#17221b');
 const fresh=block(root,'#d9ef70',3.7,.70,.76);fresh.position.copy(old.position);label(fresh,'换一种方式',[0,0,.411],2.9,.34,'#17221b');
 for(const m of [old,fresh])m.traverse(o=>{if(o.isMesh&&o.geometry.type!=='PlaneGeometry'&&o.geometry.parameters.width<2&&o.material.color.getHexString()==='f4f5e9')o.visible=false;});
 const hand=new THREE.Group();root.add(hand);hand.position.set(-.3,9,5.0);
 box(hand,'#ecede4',[1.35,1.55,.6],[0,0,0],.25);box(hand,'#c8cfb6',[1.05,1.4,.53],[0,1.25,0],.15);
 for(let i=0;i<3;i++)box(hand,'#f4f4e8',[.32,1.12,.34],[-.43+i*.42,-1.08,.08],.15);
 const thumb=box(hand,'#eff0df',[.35,.92,.40],[-.86,-.3,.32],.16);thumb.rotation.z=-.6;
 const character=mascot(root,{color:'#13b5e8',expression:'curious',grounded:true});
 character.root.position.set(-3,1.05,1.12);
 const endCharacter=mascot(scene,{color:'#13b5e8',expression:'playful',grounded:true});endCharacter.root.scale.setScalar(1.9);
 const ground=box(scene,'#030509',[130,.16,130],[0,-.68,0],.01);
 const exitPads=[];for(let i=0;i<6;i++){const b=block(scene,['#92b9df','#afd373','#d9b76e','#9b8bc7','#63bb9c','#c977a0'][i],1.4,.5,.9);exitPads.push(b);}
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d');const grad=ctx.createRadialGradient(64,64,1,64,64,64);grad.addColorStop(0,'rgba(0,0,0,.7)');grad.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
 const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.8,2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;root.add(shadow);
 return {root,giant,back,slats,supports,old,fresh,hand,character,endCharacter,ground,exitPads,shadow};
}
