import {THREE,sphere,material} from './kit.js';

// Selected soft-bean concept: dark inlaid eyes, tiny catchlights and closed mouths.
const faces={
  gentle:{brows:[.40,.40],tilts:[.015,-.015],mouth:[[-.12,-.265],[-.05,-.325],[.05,-.325],[.12,-.265]]},
  curious:{eyeY:[.10,.065],brows:[.445,.37],tilts:[.045,-.055],eyeTilt:[-.10,.08],mouth:[[-.11,-.265],[-.04,-.34],[.065,-.33],[.14,-.245]]},
  content:{closed:[0,1],brows:[.38,.38],tilts:[.025,-.025],mouth:[[-.12,-.27],[-.04,-.32],[.04,-.32],[.12,-.27]]},
  cheerful:{closed:[0,1],brows:[.405,.405],tilts:[.025,-.025],mouth:[[-.13,-.245],[-.055,-.345],[.055,-.345],[.13,-.245]]},
  focused:{eyeHeight:.90,brows:[.38,.38],tilts:[-.035,.035],browArch:0,mouth:[[-.115,-.285],[-.04,-.288],[.04,-.288],[.115,-.285]]},
  playful:{closed:[1],brows:[.425,.365],tilts:[.045,-.035],mouth:[[-.11,-.27],[-.03,-.33],[.07,-.32],[.14,-.245]]}
};

const ink='#172729';
function stroke(parent,points,width=.018){
  const curve=new THREE.CubicBezierCurve3(...points.map(([x,y])=>new THREE.Vector3(x,y,.643)));
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,20,width,8,false),material(ink,0,.45,.15));
  parent.add(mesh);
  // Rounded ends prevent sharp hooks at the mouth corners.
  for(const point of [curve.v0,curve.v3])sphere(parent,ink,width,[point.x,point.y,point.z]);
}

export function addExpression(head,name='gentle'){
  const face=faces[name]||faces.gentle,pupils=[];
  [-.34,.34].forEach((x,index)=>{
    const y=face.eyeY?.[index]??.10;
    if(face.closed?.includes(index)){
      stroke(head,[[x-.11,y-.025],[x-.075,y+.135],[x+.075,y+.135],[x+.11,y-.025]],.029);
    }else{
      // Track the complete dark eye and its catchlight as one shallow inlay.
      const pupil=new THREE.Group();pupil.position.set(x,y,.626);head.add(pupil);
      const eye=sphere(pupil,ink,1,[0,0,0]);eye.scale.set(.106,.153*(face.eyeHeight??1),.043);
      eye.material=material(ink,0,.32,.3);pupil.rotation.z=face.eyeTilt?.[index]??0;
      const glint=sphere(pupil,'#fff9e9',.021,[-.031,.068,.037]);glint.scale.set(.78,1,.35);
      pupils.push({pupil,x,y});
    }
    const by=face.brows[index],tilt=face.tilts[index],arch=face.browArch??.038;
    stroke(head,[[x-.105,by-tilt],[x-.045,by+arch],[x+.045,by+arch],[x+.105,by+tilt]],.017);
  });
  stroke(head,face.mouth);
  return pupils;
}

export const roleExpressions={brand:'gentle',knowledge:'curious',work:'cheerful',coding:'focused',pi:'playful'};
export const heroExpressions=['gentle','curious','content','cheerful','focused','playful'];
