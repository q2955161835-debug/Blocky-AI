export const clamp=(x)=>Math.max(0,Math.min(1,x));
export const ease=(x)=>{x=clamp(x);return x*x*(3-2*x)};
export const phase=(t,a,b)=>ease((t-a)/(b-a));
export function animateWorld(w,t,camera,scene){
 const {root,giant,back,slats,supports,old,fresh,hand,character:c,endCharacter,exitPads,shadow}=w;
 const ending=t>=55;root.visible=!ending;endCharacter.root.visible=ending;shadow.visible=!ending;w.ground.visible=!ending;
 old.visible=t<31;fresh.visible=t>=29&&t<55;hand.visible=t>=25&&t<35;
 const u=phase(t,35,45);back.rotation.x=-u*Math.PI/2;
 slats.forEach((s,i)=>{s.position.set(4.95+u*i*.73,.43+i*.61-u*i*.33,-.1);s.rotation.z=-u*.08;});
 supports.forEach((s,i)=>{s.visible=u>.08;const height=(.42+i*.28)*u;s.scale.y=height;s.position.set(4.95+u*i*.73,height/2,-.1);});
 giant.children[0].rotation.z=-u*.08;giant.children[0].position.y=3.25+u*.5;giant.children[0].position.x=u*.5;giant.children[4].position.y=3.25+u*.5;giant.children[4].position.x=u*.5;
 const out=phase(t,26.2,28.8),insert=phase(t,30,33.5);
 old.position.set(-.3+out*4.6,5.52+out*.9,3.08+out*4.6);old.rotation.z=-out*.25;
 fresh.position.set(-.3-(1-insert)*4.6,5.52+(1-insert)*1.5,3.08+(1-insert)*4.8);fresh.rotation.z=(1-insert)*.15;
 hand.position.set(t<30?old.position.x:fresh.position.x,t<30?old.position.y+1.6:fresh.position.y+1.6,t<30?old.position.z+.5:fresh.position.z+.5);
 hand.rotation.z=t<30?-out*.15:(1-insert)*.1;
 if(t<9){const cycle=t%4.5,p=clamp(cycle/2.55),impact=cycle>2.55&&cycle<3.15?Math.sin((cycle-2.55)/.6*Math.PI):0;c.root.position.set(-3+6.3*p,1.05+.08*Math.abs(Math.sin(cycle*9)),1.12);c.root.rotation.set(0,.30*(1-p),-.07*Math.sin(cycle*8)+impact*.18);c.head.scale.set(1+impact*.07,1-impact*.08,1);}
 else if(t<35){c.root.position.set(3.05,1.05,1.12);c.root.rotation.set(0,-phase(t,9,11)*.65,.10*Math.sin(t*.8));c.head.scale.setScalar(1);c.head.rotation.y=-.12+Math.sin(t*.6)*.06;c.head.rotation.z=Math.sin(t*.6)*.035;}
 else{const walk=phase(t,43,49),x=3.05+walk*7.55,foot=Math.max(.15,.73+(x-4.95)/.73*.28);c.root.position.set(x,foot+.87+.055*Math.abs(Math.sin(t*8)),1.12);c.root.rotation.set(0,.24,-.045*Math.sin(t*8));c.head.rotation.set(0,.15,0);}
 shadow.position.set(c.root.position.x,t>=43?Math.max(.15,.73+(c.root.position.x-4.95)/.73*.28)+.012:.152,c.root.position.z);
 exitPads.forEach((b,i)=>{b.visible=t>38&&t<55;b.position.set(9+i*2,2.2+Math.sin(t*.55+i)*.3,-5-i*.8);b.rotation.set(.12*Math.sin(t+i),i*.45+t*.1,.15*Math.cos(t+i));b.scale.setScalar(phase(t,38+i*.6,43+i*.6));});
 if(t<9){const x=c.root.position.x;camera.position.set(x+2.2,2.55,8);camera.lookAt(x+.35,1.25,1.12);camera.fov=32;}
 else if(t<16){camera.position.set(5.3,2.6,8);camera.lookAt(3,1.15,1.1);camera.fov=32;}
 else if(t<25){const p=phase(t,16,25);camera.position.set(5.3+p*.7,2.6+p*9.4,8+p*24);camera.lookAt(3*(1-p),1.15+p*1.75,1.1-p*1.2);camera.fov=32+p*2;}
 else if(t<35){const p=phase(t,25,27);camera.position.set(6-3*p,12-4*p,32-16*p);camera.lookAt(-.3,3+1.4*p,2);camera.fov=34;}
 else if(t<49){const p=phase(t,35,46);camera.position.set(3+4*p,8-1*p,16+7*p);camera.lookAt(phase(t,43,49)*4.7,2.4,-.3);camera.fov=35;}
 else if(t<55){camera.position.set(7,7,23);camera.lookAt(4.7,2.4,-.3);camera.fov=35;}
 else{endCharacter.root.position.set(-4.7,.7,1);endCharacter.root.rotation.set(0,.15,-.04*Math.sin(t*2));endCharacter.head.rotation.y=.1*Math.sin(t);endCharacter.head.position.y=.025*Math.sin(t*2);camera.position.set(0,3.1,20);camera.lookAt(0,1.15,0);camera.fov=34;}
 camera.updateProjectionMatrix();scene.background.setRGB(.001+u*.001,.002+u*.002,.003+u*.001);
}
