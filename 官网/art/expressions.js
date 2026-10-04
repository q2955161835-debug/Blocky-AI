import {THREE,sphere,material,box} from './kit.js';

// Small, closed-mouth expressions; curves stay shallow even at hero scale.
const faces={
  gentle:{eyeHeight:1.04,brows:[.39,.39],angles:[.035,-.035],mouth:[[-.14,-.29],[-.055,-.325],[.055,-.325],[.14,-.29]]},
  curious:{eyeHeight:1.08,eyeY:[.08,.12],brows:[.39,.46],angles:[.035,-.10],mouth:[[-.10,-.30],[-.035,-.322],[.07,-.314],[.13,-.285]]},
  content:{eyeHeight:.76,pupilHeight:.8,brows:[.35,.35],angles:[.025,-.025],mouth:[[-.13,-.29],[-.05,-.315],[.05,-.315],[.13,-.29]]},
  cheerful:{eyeHeight:.96,brows:[.40,.40],angles:[.065,-.065],mouth:[[-.17,-.275],[-.065,-.33],[.065,-.33],[.17,-.275]]},
  focused:{eyeHeight:.88,pupilHeight:.94,brows:[.36,.36],angles:[0,0],mouth:[[-.12,-.30],[-.045,-.305],[.045,-.305],[.12,-.30]]},
  playful:{eyeHeight:1.04,wink:1,brows:[.39,.43],angles:[.04,-.09],mouth:[[-.13,-.295],[-.04,-.325],[.075,-.31],[.145,-.275]]}
};

function stroke(parent,points,width=.018){
  const curve=new THREE.CubicBezierCurve3(...points.map(([x,y])=>new THREE.Vector3(x,y,.668)));
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,20,width,8,false),material('#28434b'));
  parent.add(mesh);
  // Rounded ends prevent sharp hooks at the mouth corners.
  for(const point of [curve.v0,curve.v3])sphere(parent,'#28434b',width,[point.x,point.y,point.z]);
}

export function addExpression(head,name='gentle'){
  const face=faces[name]||faces.gentle,pupils=[];
  [-.35,.35].forEach((x,index)=>{
    const y=face.eyeY?.[index]??.10;
    if(face.wink===index){
      stroke(head,[[x-.105,y],[x-.04,y+.04],[x+.04,y+.04],[x+.105,y]],.017);
    }else{
      const eye=sphere(head,'#f6f9f5',.19,[x,y,.638]);eye.scale.set(1,face.eyeHeight,.26);
      const pupil=sphere(head,'#20313a',.079,[x,y,.689]);pupil.scale.set(1,face.pupilHeight??1.06,.25);
      sphere(pupil,'#ffffff',.018,[-.021,.024,.021]);pupils.push({pupil,x,y});
    }
    const brow=box(head,'#28434b',[.225,.029,.035],[x,face.brows[index],.645],.014);
    brow.rotation.z=face.angles[index];
  });
  stroke(head,face.mouth);
  return pupils;
}

export const roleExpressions={brand:'gentle',knowledge:'curious',work:'cheerful',coding:'focused',pi:'playful'};
export const heroExpressions=['gentle','curious','content','cheerful','focused','playful'];
