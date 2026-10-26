import {HERO_SPEAR_PALM_SOCKET} from './spear-hand-grip.js';
import * as THREE from './vendor/three.module.min.js';
const smooth=value=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
const validPoint=point=>point&&['x','y','z'].every(key=>Number.isFinite(point[key]));
export const THREE_HEIGHT_SPEAR_PROFILE='three-height-spear-v1';
// Actor-bound presentation only. This layer is evaluated inside the
// final planted action, before its fixed-length dominant-arm support solve.
export function createThreeHeightSpearPose(model,{poleLength=3.6}={}){
 const names=['hips','spine','chest','neck','head','upperarm_L','forearm_L','hand_R',...['R','L'].flatMap(side=>['thigh_','shin_','foot_'].map(name=>name+side))];
 const bones=Object.fromEntries(names.map(name=>[name,model.getObjectByName(name)]));
 const available=[2.4,3.6].includes(poleLength)&&names.every(name=>bones[name]);
 const actorQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),worldQ=new THREE.Quaternion(),turn=new THREE.Quaternion(),inverse=new THREE.Quaternion(),euler=new THREE.Euler();
 const origin=new THREE.Vector3(),up=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3(),v=new THREE.Vector3(),w=new THREE.Vector3(),joint=new THREE.Vector3(),goal=new THREE.Vector3(),bend=new THREE.Vector3(),palm=new THREE.Vector3(),sourceTip=new THREE.Vector3(),displayTip=new THREE.Vector3();
 const legs=['R','L'].map(side=>({upper:bones['thigh_'+side],lower:bones['shin_'+side],end:bones['foot_'+side],target:new THREE.Vector3(),q:new THREE.Quaternion(),bend:new THREE.Vector3()}));
 let context=null,preview=null,cachedPreview=null;
 function prepare({mode,elapsed,presentation,timing=null}){
  context=null;preview=null;
  if(!available||mode!=='thrust'||!Number.isFinite(elapsed)||elapsed<0||elapsed>.4)return;
  const p=presentation;if(!p||p.enabled!==true||!['ground-combo-v2','ordinary-attack-phrase-v1'].includes(p.version)||p.action!=='thrust'||![1,2,3].includes(p.stage)||!Number.isInteger(p.actorId)||!Number.isInteger(p.actionSerial)||p.actionSerial<1||!Number.isInteger(p.actionCount)||p.actionCount<1)return;
  const ordinary=p.version==='ordinary-attack-phrase-v1';if(ordinary&&(p.clock!=='native-action-v1'||p.stage===1||timing))return;
  if(!ordinary&&p.stage>1&&(!timing||timing.profile!=='three-hit-thrust-v1'||timing.stage!==p.stage||timing.actorId!==p.actorId||timing.actionCount!==p.actionCount||Math.abs(timing.canonicalElapsed-elapsed)>1e-8))return;
  if(!ordinary&&p.stage===1&&timing)return;
  context={elapsed,presentation:p,timing,ordinary};
 }
 function capture(chain){chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(chain.target);chain.end.getWorldQuaternion(chain.q);d.copy(chain.target).sub(a).normalize();chain.bend.copy(b).sub(a).addScaledVector(d,-v.copy(b).sub(a).dot(d)).normalize();}
 function rotate(bone,x,y,z){bone.getWorldQuaternion(worldQ);bone.parent.getWorldQuaternion(parentQ);turn.setFromEuler(euler.set(x,y,z,'YXZ')).premultiply(actorQ).multiply(inverse.copy(actorQ).invert());bone.quaternion.copy(parentQ.invert().multiply(turn).multiply(worldQ));model.updateWorldMatrix(true,true);}
 function aim(bone,from,to){bone.parent.getWorldQuaternion(parentQ);turn.setFromUnitVectors(from.normalize(),to.normalize()).premultiply(inverse.copy(parentQ).invert()).multiply(parentQ);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);}
 function solveLeg(chain){chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);const first=a.distanceTo(b),second=b.distanceTo(c);d.copy(chain.target).sub(a);const distance=THREE.MathUtils.clamp(d.length(),Math.abs(first-second)+1e-5,first+second-1e-5);d.normalize();goal.copy(a).addScaledVector(d,distance);bend.copy(chain.bend).addScaledVector(d,-chain.bend.dot(d)).normalize();const along=(first*first-second*second+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,first*first-along*along));joint.copy(a).addScaledVector(d,along).addScaledVector(bend,height);aim(chain.upper,v.copy(b).sub(a),w.copy(joint).sub(a));chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);aim(chain.lower,v.copy(c).sub(b),w.copy(goal).sub(b));chain.end.parent.getWorldQuaternion(parentQ);chain.end.quaternion.copy(parentQ.invert().multiply(chain.q));model.updateWorldMatrix(true,true);}
 function apply({elapsed,tip,weight=0,repeated=false,palmSocket=null}){
  if(!context||Math.abs(context.elapsed-elapsed)>1e-8||!validPoint(tip)||weight<=0)return tip;
  (model.parent||model).getWorldQuaternion(actorQ);up.set(0,1,0).applyQuaternion(actorQ);const tilt=Math.acos(THREE.MathUtils.clamp(up.y,-1,1));
  const envelope=smooth(elapsed/.075)*(1-smooth((elapsed-.29)/.095))*weight*(1-smooth(tilt/.015));if(envelope<1e-8)return tip;
  const stage=context.presentation.stage;legs.forEach(capture);
  if(stage===3){const stride=smooth(elapsed/.115)*(1-smooth((elapsed-.285)/.095))*weight,raise=elapsed<.13?Math.sin(Math.PI*THREE.MathUtils.clamp(elapsed/.13,0,1)):Math.sin(Math.PI*THREE.MathUtils.clamp((elapsed-.285)/.10,0,1));v.set(0,0,1).applyQuaternion(actorQ);v.y=0;v.normalize();legs[1].target.addScaledVector(v,.16*stride);legs[1].target.y+=.045*Math.max(0,raise)*envelope;}
  // High guard, low guard and a centered finishing drive. The support foot
  // stays planted; the small lead step is solved at exact bone lengths.
  // All non-hip bone translations and scales stay exact.
  const compression=(stage===1?.015:stage===2?.12:.16)*envelope;
  bones.hips.parent.getWorldQuaternion(parentQ);bones.hips.parent.getWorldScale(v);w.set(0,-compression/Math.abs(v.y),0).applyQuaternion(parentQ.invert());bones.hips.position.add(w);model.updateWorldMatrix(true,true);
  rotate(bones.spine,(stage===1?.06:stage===2?-.10:-.095)*envelope,(stage===1?-.035:stage===2?.075:-.08)*envelope,0);
  rotate(bones.chest,(stage===1?.055:stage===2?-.035:-.07)*envelope,0,(stage===1?-.035:stage===2?.04:0)*envelope);
  rotate(bones.neck,(stage===1?-.05:stage===2?.055:.04)*envelope,0,0);
  rotate(bones.upperarm_L,(stage===1?-.28:stage===2?.20:.25)*envelope,(stage===1?.06:stage===2?-.08:-.14)*envelope,(stage===1?-.11:stage===2?.15:.34)*envelope);
  rotate(bones.forearm_L,(stage===1?-.15:stage===2?.10:-.10)*envelope,0,0);
  legs.forEach(solveLeg);
  sourceTip.set(tip.x,tip.y,tip.z);displayTip.copy(sourceTip);
  // The hero's paused upper-body solve reuses its exact final arm. Keep its
  // matching display endpoint while still evaluating hips and legs above.
  if(repeated&&cachedPreview&&cachedPreview.stage===stage&&cachedPreview.actorId===context.presentation.actorId&&cachedPreview.actionSerial===context.presentation.actionSerial&&cachedPreview.actionCount===context.presentation.actionCount&&cachedPreview.presentationVersion===context.presentation.version&&Math.abs(cachedPreview.elapsed-elapsed)<1e-10&&['x','y','z'].every(k=>cachedPreview.authoritativeTip[k]===tip[k])){preview={...cachedPreview,grip:null};displayTip.set(preview.displayTip.x,preview.displayTip.y,preview.displayTip.z);return displayTip;}
  // Chambers never replace the true 160–270 ms contact interval. Both edges
  // have a five-millisecond exact margin and a smooth zero-slope transition.
  const chamber=smooth(elapsed/.055)*(1-smooth((elapsed-.095)/.060));
  const recovery=smooth((elapsed-.280)/.035)*(1-smooth((elapsed-.335)/.05));
  const pitch=(stage===1?.50:stage===2?-.50:0)*(chamber+.45*recovery)*weight*(1-smooth(tilt/.015));
  if(Math.abs(pitch)>1e-8){
   if(poleLength===2.4){if(palmSocket)palm.copy(palmSocket);else palm.fromArray(HERO_SPEAR_PALM_SOCKET);}else palm.set(-.012,.042,-.020);bones.hand_R.localToWorld(palm);v.copy(sourceTip).sub(palm);const radius=v.length(),horizontal=Math.hypot(v.x,v.z),angle=Math.atan2(v.y,horizontal)+pitch;
   (model.parent||model).getWorldPosition(origin);const rear=Math.max(0,poleLength-radius),maxRise=rear>1e-6?THREE.MathUtils.clamp((palm.y-origin.y-.08)/rear,-.95,.95):.95;
   const rise=THREE.MathUtils.clamp(Math.sin(angle),-.65,maxRise),flat=Math.sqrt(Math.max(0,1-rise*rise))*radius/(horizontal||1);v.set(v.x*flat,rise*radius,v.z*flat);displayTip.copy(palm).add(v);
   // An upper chamber stays beside the head, never through the forehead.
   if(stage===1){w.set(-1,0,0).applyQuaternion(actorQ);w.y=0;w.normalize();displayTip.addScaledVector(w,(poleLength===2.4?.45:0)*(chamber+.45*recovery)*weight*(1-smooth(tilt/.015)));}
  }
  preview={profile:THREE_HEIGHT_SPEAR_PROFILE,stage,elapsed,actorId:context.presentation.actorId,actionSerial:context.presentation.actionSerial,actionCount:context.presentation.actionCount,clock:context.ordinary?'native-action-v1':'profiled-combo-v1',presentationVersion:context.presentation.version,timingProfile:context.timing?.profile||null,actualElapsed:context.timing?.elapsed??elapsed,poleLength,authoritativeTip:{x:tip.x,y:tip.y,z:tip.z},displayTip:{x:displayTip.x,y:displayTip.y,z:displayTip.z},grip:null};
  return displayTip;
 }
 function finalize(grip){if(preview&&validPoint(grip)){preview.grip={x:grip.x,y:grip.y,z:grip.z};cachedPreview=preview;}}
 return{available,prepare,apply,finalize,preview:()=>preview,reset(){context=null;preview=null;cachedPreview=null;}};
}
// Strict render receipt: an optional stage cannot alter a gameplay contact.
export function threeHeightSpearDisplayTip(pose){
 const f=pose?.thrustPresentationFrame,p=pose?.attackPresentation;if(f?.profile!==THREE_HEIGHT_SPEAR_PROFILE)return null;
 if(!pose.hero||!p||p.enabled!==true||!['ground-combo-v2','ordinary-attack-phrase-v1'].includes(p.version)||f.presentationVersion!==p.version||p.action!=='thrust'||![1,2,3].includes(p.stage)||f.stage!==p.stage||f.actorId!==pose.id||f.actorId!==p.actorId||!Number.isInteger(p.actorId)||!Number.isInteger(p.actionCount)||p.actionCount<1||!Number.isInteger(p.actionSerial)||p.actionSerial<1||f.actionSerial!==p.actionSerial||f.actionCount!==p.actionCount)return pose;
 const elapsed=pose.elapsed;if(!Number.isFinite(elapsed)||!Number.isFinite(f.elapsed)||!Number.isFinite(f.actualElapsed)||elapsed<0||elapsed>.4||elapsed>=.155&&elapsed<=.275||Math.abs(f.elapsed-elapsed)>1e-8)return pose;
 const clock=pose.thrustTiming,ordinary=p.version==='ordinary-attack-phrase-v1';if(ordinary&&(p.clock!=='native-action-v1'||f.clock!=='native-action-v1'||p.stage===1||clock||f.timingProfile||Math.abs(f.actualElapsed-elapsed)>1e-8))return pose;
 if(!ordinary&&p.stage>1&&(!clock||clock.profile!==f.timingProfile||clock.profile!=='three-hit-thrust-v1'||clock.stage!==p.stage||clock.actorId!==p.actorId||clock.actionCount!==p.actionCount||!Number.isFinite(clock.elapsed)||!Number.isFinite(clock.canonicalElapsed)||Math.abs(clock.elapsed-f.actualElapsed)>1e-8||Math.abs(clock.canonicalElapsed-elapsed)>1e-8))return pose;
 if(!ordinary&&p.stage===1&&(clock||f.timingProfile||Math.abs(f.actualElapsed-elapsed)>1e-8))return pose;
 if(!validPoint(f.authoritativeTip)||!validPoint(f.displayTip)||!validPoint(pose.grip)||!validPoint(f.grip)||!['x','y','z'].every(k=>Math.abs(f.authoritativeTip[k]-pose[k])<1e-7&&Math.abs(f.grip[k]-pose.grip[k])<1e-7))return pose;
 const radius=Math.hypot(f.displayTip.x-pose.grip.x,f.displayTip.y-pose.grip.y,f.displayTip.z-pose.grip.z),shift=Math.hypot(f.displayTip.x-pose.x,f.displayTip.y-pose.y,f.displayTip.z-pose.z);
 if(![2.4,3.6].includes(f.poleLength)||radius<.1||radius>f.poleLength-.03||shift>.8)return pose;
 return f.displayTip;
}
