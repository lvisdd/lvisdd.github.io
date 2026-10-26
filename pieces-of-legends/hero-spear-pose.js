import {projectChargeSpearTip} from './charge-spear-projection.js';
import * as THREE from './vendor/three.module.min.js';
import data from './assets/wall-braced-spear.js';
import {wallBracedSpearClip,WALL_SPEAR_MOTION} from './shared-spear-motion.js';
import {createSpearHandGrip,HERO_SPEAR_PALM_SOCKET} from './spear-hand-grip.js';
import {HERO_HELD_SPEAR_LENGTH} from './weapon-accents.js';
// Share the accepted hero spear layer with capped lightweight NPC rigs.
// NPC hit reactions retain their existing ownership; hero recoil stays exact.
const clip=wallBracedSpearClip();
export function createHeroSpearPose(model,{recoilSupport=true}={}){
 const heroRecoilSupport=recoilSupport;
 const currentSocket=new THREE.Vector3(-.012,.042,-.020),closedSocket=new THREE.Vector3(...HERO_SPEAR_PALM_SOCKET);
 const grasp=createSpearHandGrip(model),bracedUpper=new Set(['spine','chest','neck','head','clavicle_R','upperarm_R','forearm_R','hand_R','hand_edge_R','clavicle_L','upperarm_L','forearm_L','hand_L','hand_edge_L']);
 const bindings=clip.tracks.map(track=>{const split=track.name.lastIndexOf('.'),bone=model.getObjectByName(track.name.slice(0,split)),property=track.name.slice(split+1);return{bone,property,interpolant:track.createInterpolant(),saved:bone?.[property]?.clone()};});
 const available=bindings.every(b=>b.bone&&b.saved),rotation=new THREE.Quaternion(),up=new THREE.Vector3();let applied=false,weight=0,supported=false,lastPauseKey=null;
 const pausedUpper=bindings.filter(b=>b.bone&&bracedUpper.has(b.bone.name)).map(b=>({...b,cached:b.bone[b.property].clone()}));
 const chargeFreeArm=bindings.filter(b=>b.property==='quaternion'&&['clavicle_L','upperarm_L','forearm_L','hand_L','hand_edge_L'].includes(b.bone?.name)).map(b=>({bone:b.bone,rotation:b.bone.quaternion.clone()}));
 const chargeReleaseArms=bindings.filter(b=>b.property==='quaternion'&&['upperarm_R','forearm_R','hand_R','clavicle_L','upperarm_L','forearm_L','hand_L','hand_edge_L'].includes(b.bone?.name)).map(b=>({bone:b.bone,from:b.bone.quaternion.clone()}));
 let guardChargeDraw=null,previousGuardChargeDraw=null;
 const guardChargeSamples=new Map();
 const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
 const hand=model.getObjectByName('hand_R'),upper=model.getObjectByName('upperarm_R'),fore=model.getObjectByName('forearm_R'),spine=model.getObjectByName('spine'),clavicle=model.getObjectByName('clavicle_R');
 const supportedAxis=new THREE.Vector3(...data.userData.supportedShaftAxis).normalize(),fingerAxis=new THREE.Vector3(0,1,0);fingerAxis.addScaledVector(supportedAxis,-fingerAxis.dot(supportedAxis)).normalize();const palmNormal=new THREE.Vector3().crossVectors(fingerAxis,supportedAxis).normalize(),localBasisInverse=new THREE.Matrix4().makeBasis(supportedAxis,palmNormal,fingerAxis).invert(),wristBasis=new THREE.Matrix4(),normalWorld=new THREE.Vector3(),fingerWorld=new THREE.Vector3(),localOffset=new THREE.Vector3();
 const origin=new THREE.Vector3(),forward=new THREE.Vector3(),grip=new THREE.Vector3(),goalGrip=new THREE.Vector3(),wrist=new THREE.Vector3(),offset=new THREE.Vector3(),tipPoint=new THREE.Vector3(),referenceDirection=new THREE.Vector3(),actualDirection=new THREE.Vector3();
 const projectionReferenceGrip=new THREE.Vector3(),projectionSourceTip=new THREE.Vector3(),chargeDisplayTip=new THREE.Vector3();let projectionCamera=null,hasChargeDisplayTip=false;
 const viewCamera=new THREE.Camera();viewCamera.matrixAutoUpdate=false;viewCamera.matrixWorldAutoUpdate=false;
 const desiredWrist=new THREE.Vector3(),desiredGrip=new THREE.Vector3(),bracedRotation=new THREE.Quaternion();
 const shoulder=new THREE.Vector3(),elbow=new THREE.Vector3(),target=new THREE.Vector3(),bend=new THREE.Vector3(),joint=new THREE.Vector3(),v=new THREE.Vector3(),w=new THREE.Vector3();
 const handRotation=new THREE.Quaternion(),wantedRotation=new THREE.Quaternion(),turn=new THREE.Quaternion(),parentRotation=new THREE.Quaternion(),inverseParent=new THREE.Quaternion();
 // A stable elbow-plane roll avoids shortest-arc axial flips in the sleeve.
 // Child direction remains exact; only forearm twist around that axis changes.
 const foreLocalY=hand?hand.position.clone().normalize():new THREE.Vector3(0,1,0),foreLocalZ=new THREE.Vector3(0,0,1);foreLocalZ.addScaledVector(foreLocalY,-foreLocalZ.dot(foreLocalY)).normalize();
 const foreLocalX=new THREE.Vector3().crossVectors(foreLocalY,foreLocalZ),foreBasisInverse=new THREE.Matrix4().makeBasis(foreLocalX,foreLocalY,foreLocalZ).invert();
 const foreDirection=new THREE.Vector3(),foreNormal=new THREE.Vector3(),foreSide=new THREE.Vector3(),foreBasis=new THREE.Matrix4(),foreWorldRotation=new THREE.Quaternion(),foreOriginal=new THREE.Quaternion();

 function aim(bone,from,to){bone.parent.getWorldQuaternion(parentRotation);turn.setFromUnitVectors(from.normalize(),to.normalize());turn.premultiply(inverseParent.copy(parentRotation).invert()).multiply(parentRotation);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);}
 function supportTip(elapsed,point,charge=false,frameTime=0,bracePass=0){
  if(!hand||!upper||!fore)return;
  (model.parent||model).getWorldPosition(origin);forward.set(0,0,1).applyQuaternion(rotation);forward.y=0;forward.normalize();
  hand.getWorldPosition(wrist);hand.localToWorld(grip.copy(currentSocket));offset.copy(grip).sub(wrist);hand.getWorldQuaternion(handRotation);
  referenceDirection.copy(supportedAxis).applyQuaternion(handRotation).normalize();
  goalGrip.copy(grip).addScaledVector(v.set(-forward.z,0,forward.x),(charge?0:.085)*smooth((elapsed-.315)/.025)*(1-smooth((elapsed-.38)/.015))*weight);
  const extension=elapsed<=.16?1.1:elapsed<.24?1.1+2.1*(elapsed-.16)/.08:elapsed<=.27?3.2:3.2-2.1*THREE.MathUtils.clamp((elapsed-.27)/.13,0,1);
  if(charge){tipPoint.copy(origin).addScaledVector(forward,1.7);tipPoint.y=origin.y+1.9;}else if(point&&['x','y','z'].every(k=>Number.isFinite(point[k])))tipPoint.set(point.x,point.y,point.z);else{tipPoint.copy(origin).addScaledVector(forward,extension);tipPoint.y=origin.y+1.9;}
  // A continuous arm arc follows the real 80 ms extension. Keeping a small
  // bend avoids a straight-arm lock followed by an IK branch change.
  upper.getWorldPosition(shoulder);fore.getWorldPosition(elbow);hand.getWorldPosition(wrist);const first=shoulder.distanceTo(elbow),second=elbow.distanceTo(wrist);
  const progress=charge?.28:THREE.MathUtils.clamp((extension-1.1)/2.1,0,1),angle=(charge?140:120-114*progress**2)*Math.PI/180;
  const right=v.set(-forward.z,0,forward.x),elbowOut=.06,elbowForward=charge?-.19:-.20+.535*progress;
  // Keep the upper arm close to the ribs. The elbow advances toward the tip
  // while the forearm unfolds; the shoulder does not fan the whole arm sideways.
  joint.copy(shoulder).addScaledVector(right,elbowOut).addScaledVector(forward,elbowForward);
  joint.y-=Math.sqrt(Math.max(.01,first*first-elbowOut*elbowOut-elbowForward*elbowForward));
  actualDirection.copy(right).multiplyScalar(Math.sin(angle)).addScaledVector(forward,Math.cos(angle));actualDirection.y=-.1;actualDirection.normalize();
  target.copy(joint).addScaledVector(actualDirection,second);
  // Enter/leave while the existing weapon fade runs, preserving interruption
  // ownership and the authored non-action arm exactly.
  const ownership=charge?(1-smooth((frameTime-.22)/.046)):smooth(elapsed/.075)*(1-smooth((elapsed-.27)/.13));
  // Charge starts in one complete waist brace; interpolating a wrist flip
  // after the spear appears would swing the shaft through the sleeve.
  // Lower the wrist itself to brace at the waist. The palm socket stays
  // anatomical; translating only the hand mesh would stretch its wrist.
  target.y-=.13;desiredWrist.copy(target);target.lerp(wrist,1-ownership);actualDirection.copy(target).sub(shoulder);let distance=THREE.MathUtils.clamp(actualDirection.length(),Math.abs(first-second)+1e-5,first+second-.025);actualDirection.normalize();target.copy(shoulder).addScaledVector(actualDirection,distance);
  // Solve wrist roll around the fixed target, then use that very palm for the
  // displayed shaft. This does not move or retime the gameplay endpoint.
  localOffset.copy(offset).applyQuaternion(turn.copy(handRotation).invert());goalGrip.copy(target).add(offset);
  // Root recoil keeps its body/leg ownership. The grasp itself must still lie
  // on the fixed pole: ease only the wrist toward the true point near the butt,
  // then solve the same fixed-length arm. No root translation or hit reach.
  const solveWrist=()=>{
    actualDirection.copy(tipPoint).sub(goalGrip).normalize();normalWorld.set(0,-1,0).addScaledVector(actualDirection,actualDirection.y).normalize();fingerWorld.crossVectors(actualDirection,normalWorld).normalize();wristBasis.makeBasis(w.copy(actualDirection).negate(),normalWorld,fingerWorld.negate()).multiply(localBasisInverse);bracedRotation.setFromRotationMatrix(wristBasis);
    // Blend the supported palm itself, rather than the wrist pivot. The palm
    // stays on its continuous return path while the overhand wrist unwinds.
    desiredGrip.copy(desiredWrist).add(w.copy(localOffset).applyQuaternion(bracedRotation));goalGrip.copy(grip).lerp(desiredGrip,ownership);
    const wristOwnership=charge?ownership:smooth(elapsed/.055)*(1-smooth((elapsed-.38)/.02));wantedRotation.copy(bracedRotation).slerp(handRotation,1-wristOwnership);target.copy(goalGrip).sub(w.copy(localOffset).applyQuaternion(wantedRotation));
    actualDirection.copy(target).sub(shoulder);distance=THREE.MathUtils.clamp(actualDirection.length(),Math.abs(first-second)+1e-5,first+second-.025);target.copy(shoulder).addScaledVector(actualDirection.normalize(),distance);goalGrip.copy(target).add(w.copy(localOffset).applyQuaternion(wantedRotation));
  };
  for(let correction=0;correction<4;correction++){
   for(let i=0;i<8;i++)solveWrist();
   if(charge&&projectionCamera){
    if(correction===0){projectionReferenceGrip.copy(goalGrip);projectionSourceTip.copy(tipPoint);}
    for(let i=0;i<20;i++){
     projectChargeSpearTip(tipPoint,{origin,forward,grip:goalGrip,referenceGrip:projectionReferenceGrip,sourceTip:projectionSourceTip,camera:projectionCamera});
     solveWrist();
    }
    chargeDisplayTip.copy(tipPoint);hasChargeDisplayTip=true;
   }
   actualDirection.copy(tipPoint).sub(goalGrip).normalize();
   const excess=goalGrip.distanceTo(tipPoint)-(HERO_HELD_SPEAR_LENGTH-.06);if(excess<=1e-7||correction===3)break;
   desiredWrist.addScaledVector(actualDirection,excess*smooth(excess/.06)/Math.max(ownership,.01));target.addScaledVector(actualDirection,excess*smooth(excess/.06));actualDirection.copy(target).sub(shoulder);distance=THREE.MathUtils.clamp(actualDirection.length(),Math.abs(first-second)+1e-5,first+second-.025);target.copy(shoulder).addScaledVector(actualDirection.normalize(),distance);goalGrip.copy(target).add(w.copy(localOffset).applyQuaternion(wantedRotation));
  }
  distance=target.distanceTo(shoulder);
  // Strong root flinch can move the shoulder outside the short pole's arm
  // reach. Counter-brace only the upper torso/right shoulder, with rotations
  // bounded at 17.2/11.5 degrees; root, hips, legs and bone lengths stay owned
  // by the hit reaction. Ordinary poses never enter this branch.
  const reachGap=goalGrip.distanceTo(tipPoint)-(HERO_HELD_SPEAR_LENGTH-.04);
  if(heroRecoilSupport&&!bracePass&&spine&&clavicle&&up.y<Math.cos(.04)&&reachGap>1e-6){
   const brace=smooth(reachGap/.2);
   const rotateWorld=(bone,axis,angle)=>{bone.parent.getWorldQuaternion(parentRotation);turn.setFromAxisAngle(axis,angle).premultiply(inverseParent.copy(parentRotation).invert()).multiply(parentRotation);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);};
   rotateWorld(spine,right,-.30*brace);normalWorld.set(0,1,0);rotateWorld(clavicle,normalWorld,.20*brace);supportTip(elapsed,point,charge,frameTime,1);return;
  }
  actualDirection.copy(target).sub(shoulder).normalize();bend.copy(joint).sub(shoulder);bend.addScaledVector(actualDirection,-bend.dot(actualDirection)).normalize();
  // Follow the authored elbow plane as thrust ownership enters and leaves.
  // The palm socket remains the interpolation anchor throughout the handoff.
  if(ownership<1){
   foreSide.copy(elbow).sub(shoulder);foreSide.addScaledVector(actualDirection,-foreSide.dot(actualDirection));
   if(foreSide.lengthSq()>1e-12)bend.lerp(foreSide.normalize(),1-ownership).normalize();
  }
  const along=(first*first-second*second+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,first*first-along*along));joint.copy(shoulder).addScaledVector(actualDirection,along).addScaledVector(bend,height);
  aim(upper,v.copy(elbow).sub(shoulder),w.copy(joint).sub(shoulder));fore.getWorldPosition(elbow);hand.getWorldPosition(wrist);aim(fore,v.copy(wrist).sub(elbow),w.copy(target).sub(elbow));
  foreDirection.copy(target).sub(elbow).normalize();foreNormal.crossVectors(foreSide.copy(elbow).sub(shoulder),foreDirection).normalize();foreSide.crossVectors(foreDirection,foreNormal).normalize();foreNormal.crossVectors(foreSide,foreDirection).normalize();
  foreBasis.makeBasis(foreSide,foreDirection,foreNormal).multiply(foreBasisInverse);foreWorldRotation.setFromRotationMatrix(foreBasis).premultiply(turn.setFromAxisAngle(foreDirection,-.35));foreOriginal.copy(fore.quaternion);fore.parent.getWorldQuaternion(parentRotation);fore.quaternion.copy(parentRotation.invert().multiply(foreWorldRotation)).slerp(foreOriginal,1-ownership);model.updateWorldMatrix(true,true);
  hand.parent.getWorldQuaternion(parentRotation);hand.quaternion.copy(parentRotation.invert().multiply(wantedRotation));model.updateWorldMatrix(true,true);
 }
 // The free left fist chambers at the waist with the elbow beside the ribs.
 // A two-handed grip is not reachable on the existing fully extended short
 // pole. Keep exact arm lengths and a neutral wrist rather than fake contact.
 const leftUpper=model.getObjectByName('upperarm_L'),leftFore=model.getObjectByName('forearm_L'),leftHand=model.getObjectByName('hand_L');
 const leftNeutral=new THREE.Quaternion().fromArray(clip.tracks.find(t=>t.name==='hand_L.quaternion').values);
 const leftRight=new THREE.Vector3(),leftSourceUpper=new THREE.Quaternion(),leftSourceFore=new THREE.Quaternion(),leftSourceHand=new THREE.Quaternion();
 function chamberLeftFist(frame){
  if(!leftUpper||!leftFore||!leftHand)return;
  const ownership=smooth(frame.time/(WALL_SPEAR_MOTION.brace*.7))*(1-smooth((frame.time-(WALL_SPEAR_MOTION.end-.045))/.045));if(ownership<=0)return;
  leftSourceUpper.copy(leftUpper.quaternion);leftSourceFore.copy(leftFore.quaternion);leftSourceHand.copy(leftHand.quaternion);
  forward.set(0,0,1).applyQuaternion(rotation);forward.y=0;forward.normalize();const right=leftRight.set(-forward.z,0,forward.x);
  leftUpper.getWorldPosition(shoulder);leftFore.getWorldPosition(elbow);leftHand.getWorldPosition(wrist);const first=shoulder.distanceTo(elbow),second=elbow.distanceTo(wrist);
  joint.copy(shoulder).addScaledVector(right,-.075).addScaledVector(forward,-.045);joint.y-=Math.sqrt(Math.max(.01,first*first-.075*.075-.045*.045));
  actualDirection.copy(forward).addScaledVector(right,-.025);actualDirection.y=-.38;actualDirection.normalize();target.copy(joint).addScaledVector(actualDirection,second);
  aim(leftUpper,v.copy(elbow).sub(shoulder),w.copy(joint).sub(shoulder));leftFore.getWorldPosition(elbow);leftHand.getWorldPosition(wrist);aim(leftFore,v.copy(wrist).sub(elbow),w.copy(target).sub(elbow));
  leftHand.quaternion.copy(leftNeutral);leftUpper.quaternion.slerp(leftSourceUpper,1-ownership);leftFore.quaternion.slerp(leftSourceFore,1-ownership);leftHand.quaternion.slerp(leftSourceHand,1-ownership);model.updateWorldMatrix(true,true);
 }
 function restore(){if(applied){for(const b of bindings)b.bone[b.property].copy(b.saved);applied=false;}}
 function apply(frame,{elapsed=0,tip=null,dt=0,pauseKey=null,variant=null,chargeCamera=null,readyHandWeight=0}={}){
  const readyClosure=THREE.MathUtils.clamp(readyHandWeight,0,1);
  // Production passes a value-only camera snapshot, so action inputs remain
  // serializable and the pose cannot retain or mutate the renderer camera.
  projectionCamera=null;hasChargeDisplayTip=false;previousGuardChargeDraw=guardChargeDraw;guardChargeDraw=null;
  if(dt>0||!frame)guardChargeSamples.clear();
  if(chargeCamera?.isCamera)projectionCamera=chargeCamera;
  else if(chargeCamera?.matrixWorld?.length===16&&chargeCamera?.projectionMatrix?.length===16){
   viewCamera.matrixWorld.fromArray(chargeCamera.matrixWorld);viewCamera.matrixWorldInverse.copy(viewCamera.matrixWorld).invert();viewCamera.projectionMatrix.fromArray(chargeCamera.projectionMatrix);projectionCamera=viewCamera;
  }
  const repeated=dt===0&&pauseKey!==null&&pauseKey===lastPauseKey;supported=false;if(!available||!frame){weight=0;if(available&&readyClosure>0){grasp.apply(readyClosure);currentSocket.set(-.012,.042,-.020).lerp(closedSocket,readyClosure);}else{grasp.reset();currentSocket.set(-.012,.042,-.020);}lastPauseKey=null;return 0;}
  (model.parent||model).getWorldQuaternion(rotation);up.set(0,1,0).applyQuaternion(rotation);
  const tilt=Math.acos(THREE.MathUtils.clamp(up.y,-1,1)),entry=smooth(frame.time/(WALL_SPEAR_MOTION.brace*.7)),exit=1-smooth((frame.time-(WALL_SPEAR_MOTION.end-.045))/.045);
  // Recoil owns hit frames; the shared action resumes at its unchanged clock.
  weight=entry*exit*(1-smooth(tilt/.04));
  // A fully owned NPC recoil keeps the previous non-braced attack pose.
  // Do not impose the hero upper-body brace on its stronger directional lean.
  // Fade the solved arms and grasp with the recoil layer too; fading only
  // the authored clip leaves an abrupt IK and finger takeover at the threshold.
  if(!recoilSupport&&tilt>=.04){if(readyClosure>0){grasp.apply(readyClosure);currentSocket.set(-.012,.042,-.020).lerp(closedSocket,readyClosure);}else{grasp.reset();currentSocket.set(-.012,.042,-.020);}lastPauseKey=null;return 0;}const recoilBlend=recoilSupport?1:1-smooth(tilt/.04),closure=(frame.action==='charge'?exit:smooth(elapsed/.055)*(1-smooth((elapsed-.38)/.02)))*recoilBlend;const combinedClosure=readyClosure>0?closure+(1-closure)*readyClosure:closure;grasp.apply(combinedClosure);currentSocket.set(-.012,.042,-.020).lerp(closedSocket,combinedClosure);
  for(const b of bindings){b.saved.copy(b.bone[b.property]);const poseWeight=heroRecoilSupport&&bracedUpper.has(b.bone.name)?entry*exit:weight;if(poseWeight<=0)continue;const value=b.interpolant.evaluate(frame.time);if(b.property==='quaternion')b.bone.quaternion.fromArray(value).slerp(b.saved,1-poseWeight);else{b.bone.position.fromArray(value).lerp(b.saved,1-poseWeight);if(b.bone.name!=='hips'){const length=b.bone.position.length();if(length>1e-12)b.bone.position.multiplyScalar(b.saved.length()/length);}}}
  applied=true;model.updateWorldMatrix(true,true);
  const supportedTip=frame.action==='thrust'?(variant?.apply({elapsed,tip,weight,repeated,palmSocket:currentSocket})||tip):tip;
  if(repeated){hasChargeDisplayTip=!!projectionCamera&&frame.action==='charge';for(const b of pausedUpper)b.bone[b.property].copy(b.cached);model.updateWorldMatrix(true,true);}
  else{supportTip(elapsed,supportedTip,frame.action==='charge',frame.time);chamberLeftFist(frame);if(recoilBlend<1){for(const b of bindings){if(b.property==='quaternion')b.bone.quaternion.slerp(b.saved,1-recoilBlend);else{b.bone.position.lerp(b.saved,1-recoilBlend);if(b.bone.name!=='hips'){const length=b.bone.position.length();if(length>1e-12)b.bone.position.multiplyScalar(b.saved.length()/length);}}}model.updateWorldMatrix(true,true);}for(const b of pausedUpper)b.cached.copy(b.bone[b.property]);lastPauseKey=pauseKey;}
  for(const b of chargeFreeArm)b.rotation.copy(b.bone.quaternion);
  supported=true;
  return weight;
 }
 function finalizeGuardCharge(frame,elapsed,dt,pauseKey){
  if(!available||!supported||frame?.action!=='charge')return;
  guardChargeDraw={profile:'guard-charge-draw-v1',elapsed,opacity:smooth((elapsed-.05)/.025)};
  // A paused viewport change reprojects the brace without advancing the arm
  // release. Returning to a sampled camera must restore the exact displayed pose.
  const cached=dt===0?guardChargeSamples.get(pauseKey):null;
  if(cached){
   chargeReleaseArms.forEach((b,i)=>b.bone.quaternion.copy(cached.arms[i]));
   chargeDisplayTip.copy(cached.tip);hasChargeDisplayTip=cached.hasTip;
   model.updateWorldMatrix(true,true);
   for(const b of pausedUpper)b.cached.copy(b.bone[b.property]);
   return;
  }
  // The guard keeps its continuous torso and planted legs. Its final blend
  // must not replace the visible pole's solved arm: re-establish the same
  // fixed-length waist brace using the shoulders in that displayed body pose.
  // Release both crossed arms continuously into the brace during the existing
  // non-damaging windup. Only this guard handoff summons its pole after the
  // fingers have reached the solved grip; it is fully drawn before active travel.
  for(const b of chargeReleaseArms){
   if(dt===0&&previousGuardChargeDraw?.elapsed===elapsed)b.bone.quaternion.copy(b.from);
   else b.from.copy(b.bone.quaternion);
  }
  for(const b of chargeFreeArm)b.bone.quaternion.copy(b.rotation);
  model.updateWorldMatrix(true,true);
  supportTip(0,null,true,frame.time);chamberLeftFist(frame);
  const takeover=smooth(elapsed/.05);
  for(const b of chargeReleaseArms)b.bone.quaternion.slerp(b.from,1-takeover);
  model.updateWorldMatrix(true,true);
  for(const b of pausedUpper)b.cached.copy(b.bone[b.property]);
  if(pauseKey!==null){
   if(guardChargeSamples.size>=8)guardChargeSamples.delete(guardChargeSamples.keys().next().value);
   guardChargeSamples.set(pauseKey,{arms:chargeReleaseArms.map(b=>b.bone.quaternion.clone()),tip:chargeDisplayTip.clone(),hasTip:hasChargeDisplayTip});
  }
 }
 return{available,restore,apply,finalizeGuardCharge,guardChargeDraw:()=>guardChargeDraw,reset(){restore();grasp.reset();currentSocket.set(-.012,.042,-.020);weight=0;supported=false;lastPauseKey=null;hasChargeDisplayTip=false;guardChargeDraw=null;previousGuardChargeDraw=null;guardChargeSamples.clear();},chargeDisplayTip:()=>hasChargeDisplayTip?chargeDisplayTip:null,weight:()=>weight,gripSocket:()=>currentSocket,gripSupported:()=>supported};
}
