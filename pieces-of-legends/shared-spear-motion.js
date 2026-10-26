import * as THREE from './vendor/three.module.min.js';
import data from './assets/wall-braced-spear.js';
// One planted action shape. Only the existing engine moves the actor.
// Thrust and charge retain their own preparation/contact/recovery timings.
export const WALL_SPEAR_MOTION=Object.freeze({name:'wall-braced-spear-v1',brace:1/15,end:4/15});
const clip=THREE.AnimationClip.parse({...data,userData:JSON.stringify(data.userData)});
export function wallBracedSpearClip(){return clip;}
export function createSharedSpearMotion(){
 const {brace,end}=WALL_SPEAR_MOTION;let previousMode='',action='',time=0,tail=null,frame=null;
 function reset(){previousMode='';action='';time=0;tail=null;frame=null;}
 function sample({mode,phase=0,dt=0,thrust=false,charge=false,alive=true,guarding=false}){
  const step=Math.max(0,dt);let stage='off',enabled=false;
  if(!alive||guarding||(!thrust&&!charge)){reset();return null;}
  if(mode==='thrust'&&thrust){
   const elapsed=THREE.MathUtils.clamp(.4-phase,0,.4);action='thrust';tail=null;enabled=true;
   if(elapsed<.16){stage='prepare';time=brace*elapsed/.16;}
   else if(elapsed<=.27){stage='hold';time=brace;}
   else{stage='return';time=brace+(end-brace)*(elapsed-.27)/.13;}
  }else if(charge&&(mode==='windup'||mode==='charge')){
   action='charge';tail=null;enabled=true;stage=mode==='windup'?'prepare':'hold';time=mode==='windup'?THREE.MathUtils.clamp(.075-phase,0,brace):brace;
  }else if(charge&&(mode==='ready'||mode==='charge_recover')&&action==='charge'){
   // A real wall stop uses the same settle shape. Early user interruption
   // returns through the normal mixer instead of completing a new thrust.
   if(tail===null){if(previousMode==='windup'&&time<brace*.8){reset();return null;}tail=0;}
   tail+=step;time=brace+Math.min(end-brace,tail);stage='return';enabled=tail<end-brace-1e-9;
   if(!enabled){reset();return null;}
  }else{reset();return null;}
  previousMode=mode;frame=enabled?{profile:WALL_SPEAR_MOTION.name,action,stage,time,normalizedTime:time/end}:null;return frame;
 }
 return{sample,reset,frame:()=>frame};
}

// A final pose layer leaves the original clip clocks and interruption owners
// running underneath. Complete authored joint transforms prevent the previous
// thrust/run clip from changing the planted stance. Gameplay roots stay external.
export function createSharedSpearPose(model){
 const bindings=clip.tracks.map(track=>{const split=track.name.lastIndexOf('.'),bone=model.getObjectByName(track.name.slice(0,split)),property=track.name.slice(split+1);return{bone,property,interpolant:track.createInterpolant(),saved:bone?.[property]?.clone()};});
 const available=bindings.every(b=>b.bone&&b.saved),rotation=new THREE.Quaternion(),up=new THREE.Vector3();let applied=false,weight=0;
 const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
 const hand=model.getObjectByName('hand_R'),upper=model.getObjectByName('upperarm_R'),fore=model.getObjectByName('forearm_R');
 const supportedAxis=new THREE.Vector3(...data.userData.supportedShaftAxis);
 const origin=new THREE.Vector3(),forward=new THREE.Vector3(),grip=new THREE.Vector3(),goalGrip=new THREE.Vector3(),wrist=new THREE.Vector3(),offset=new THREE.Vector3(),tipPoint=new THREE.Vector3(),referenceDirection=new THREE.Vector3(),actualDirection=new THREE.Vector3();
 const shoulder=new THREE.Vector3(),elbow=new THREE.Vector3(),target=new THREE.Vector3(),bend=new THREE.Vector3(),joint=new THREE.Vector3(),v=new THREE.Vector3(),w=new THREE.Vector3();
 const handRotation=new THREE.Quaternion(),wantedRotation=new THREE.Quaternion(),turn=new THREE.Quaternion(),parentRotation=new THREE.Quaternion(),inverseParent=new THREE.Quaternion();
 function aim(bone,from,to){bone.parent.getWorldQuaternion(parentRotation);turn.setFromUnitVectors(from.normalize(),to.normalize());turn.premultiply(inverseParent.copy(parentRotation).invert()).multiply(parentRotation);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);}
 function supportTip(elapsed,point){
  if(!hand||!upper||!fore)return;
  (model.parent||model).getWorldPosition(origin);forward.set(0,0,1).applyQuaternion(rotation);forward.y=0;forward.normalize();
  hand.getWorldPosition(wrist);hand.localToWorld(grip.set(-.012,.042,-.020));offset.copy(grip).sub(wrist);hand.getWorldQuaternion(handRotation);
  referenceDirection.copy(supportedAxis).applyQuaternion(handRotation).normalize();
  goalGrip.copy(grip).addScaledVector(v.set(-forward.z,0,forward.x),.085*smooth((elapsed-.315)/.025)*(1-smooth((elapsed-.38)/.015))*weight);
  const extension=elapsed<=.16?1.1:elapsed<.24?1.1+2.1*(elapsed-.16)/.08:elapsed<=.27?3.2:3.2-2.1*THREE.MathUtils.clamp((elapsed-.27)/.13,0,1);
  if(point&&['x','y','z'].every(k=>Number.isFinite(point[k])))tipPoint.set(point.x,point.y,point.z);else{tipPoint.copy(origin).addScaledVector(forward,extension);tipPoint.y=origin.y+1.9;}
  actualDirection.copy(tipPoint).sub(goalGrip).normalize();turn.setFromUnitVectors(referenceDirection,actualDirection);wantedRotation.copy(turn).multiply(handRotation);target.copy(goalGrip).sub(w.copy(offset).applyQuaternion(turn));
  upper.getWorldPosition(shoulder);fore.getWorldPosition(elbow);hand.getWorldPosition(wrist);const first=shoulder.distanceTo(elbow),second=elbow.distanceTo(wrist);
  actualDirection.copy(target).sub(shoulder);const distance=THREE.MathUtils.clamp(actualDirection.length(),Math.abs(first-second)+1e-5,first+second-1e-5);actualDirection.normalize();target.copy(shoulder).addScaledVector(actualDirection,distance);
  bend.copy(elbow).sub(shoulder).addScaledVector(actualDirection,-v.copy(elbow).sub(shoulder).dot(actualDirection));if(bend.lengthSq()<1e-10)bend.set(-forward.z,1,forward.x).addScaledVector(actualDirection,-bend.dot(actualDirection));bend.normalize();
  const along=(first*first-second*second+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,first*first-along*along));joint.copy(shoulder).addScaledVector(actualDirection,along).addScaledVector(bend,height);
  aim(upper,v.copy(elbow).sub(shoulder),w.copy(joint).sub(shoulder));fore.getWorldPosition(elbow);hand.getWorldPosition(wrist);aim(fore,v.copy(wrist).sub(elbow),w.copy(target).sub(elbow));hand.parent.getWorldQuaternion(parentRotation);hand.quaternion.copy(parentRotation.invert().multiply(wantedRotation));model.updateWorldMatrix(true,true);
 }
 function restore(){if(applied){for(const b of bindings)b.bone[b.property].copy(b.saved);applied=false;}}
 function apply(frame,{elapsed=0,tip=null}={}){
  if(!available||!frame){weight=0;return 0;}
  (model.parent||model).getWorldQuaternion(rotation);up.set(0,1,0).applyQuaternion(rotation);
  const tilt=Math.acos(THREE.MathUtils.clamp(up.y,-1,1)),entry=smooth(frame.time/(WALL_SPEAR_MOTION.brace*.7)),exit=1-smooth((frame.time-(WALL_SPEAR_MOTION.end-.045))/.045);
  // Recoil owns hit frames; the shared action resumes at its unchanged clock.
  weight=entry*exit*(1-smooth(tilt/.04));if(weight<=0)return 0;
  for(const b of bindings){b.saved.copy(b.bone[b.property]);const value=b.interpolant.evaluate(frame.time);if(b.property==='quaternion')b.bone.quaternion.fromArray(value).slerp(b.saved,1-weight);else{b.bone.position.fromArray(value).lerp(b.saved,1-weight);if(b.bone.name!=='hips'){const length=b.bone.position.length();if(length>1e-12)b.bone.position.multiplyScalar(b.saved.length()/length);}}}
  applied=true;model.updateWorldMatrix(true,true);
  if(frame.action==='thrust')supportTip(elapsed,tip);
  return weight;
 }
 return{available,restore,apply,reset(){restore();weight=0;},weight:()=>weight};
}
