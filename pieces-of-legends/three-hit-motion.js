import * as THREE from './vendor/three.module.min.js';
const smooth=v=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*t*(t*(t*6-15)+10);};
export function threeHitStage(p,mode){return mode==='thrust'&&p&&p.enabled!==false&&p.action===mode&&(p.stage===2||p.stage===3)?p.stage:0;}

// A reversible, actor-bound presentation layer. Contact anchors stay engine-owned.
// The clavicle and two arm segments are solved together at their real lengths;
// no bone scales, rest offsets, actor travel, timing or hit volume are changed.
export function createThreeHitMotion(model){
 const names=['hips','spine','chest','neck','head','clavicle_R','upperarm_R','forearm_R','hand_R','clavicle_L','upperarm_L','forearm_L','hand_L',...['R','L'].flatMap(s=>['thigh_','shin_','foot_'].map(n=>n+s))];
 const list=names.map(n=>model.getObjectByName(n));if(list.some(b=>!b))return{restore(){},reset(){},apply(){}};
 const bones=Object.fromEntries(names.map((n,i)=>[n,list[i]])),saved=list.map(b=>({p:b.position.clone(),q:b.quaternion.clone()}));
 const aq=new THREE.Quaternion(),pq=new THREE.Quaternion(),wq=new THREE.Quaternion(),dq=new THREE.Quaternion(),inv=new THREE.Quaternion(),rot=new THREE.Quaternion(),euler=new THREE.Euler();
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3(),v=new THREE.Vector3(),u=new THREE.Vector3(),elbow=new THREE.Vector3(),bend=new THREE.Vector3(),target=new THREE.Vector3();
 const legs=['R','L'].map(s=>({upper:bones['thigh_'+s],lower:bones['shin_'+s],end:bones['foot_'+s],target:new THREE.Vector3(),q:new THREE.Quaternion(),bend:new THREE.Vector3()}));
 const arm={upper:bones.upperarm_R,lower:bones.forearm_R,end:bones.hand_R,target:new THREE.Vector3(),q:new THREE.Quaternion(),bend:new THREE.Vector3()};
 const basePalm=new THREE.Vector3(),desiredPalm=new THREE.Vector3(),poleBase=new THREE.Vector3(),poleGoal=new THREE.Vector3(),baseOffset=new THREE.Vector3(),poleTurn=new THREE.Quaternion();
 const endTip=new THREE.Vector3(),displayTip=new THREE.Vector3(),actorOrigin=new THREE.Vector3(),bladeAxis=new THREE.Vector3();let preview=null;
 let applied=false;
 function restore(){if(!applied)return;list.forEach((n,i)=>{n.position.copy(saved[i].p);n.quaternion.copy(saved[i].q);});applied=false;}
 function capture(chain){chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(chain.target);chain.end.getWorldQuaternion(chain.q);d.copy(chain.target).sub(a).normalize();chain.bend.copy(b).sub(a).addScaledVector(d,-u.copy(b).sub(a).dot(d)).normalize();}
 function rotate(bone,x,y,z){if(!x&&!y&&!z)return;bone.getWorldQuaternion(wq);bone.parent.getWorldQuaternion(pq);dq.setFromEuler(euler.set(x,y,z,'YXZ')).premultiply(aq).multiply(inv.copy(aq).invert());bone.quaternion.copy(pq.invert().multiply(dq).multiply(wq));model.updateWorldMatrix(true,true);}
 function aim(bone,from,to){bone.parent.getWorldQuaternion(pq);rot.setFromUnitVectors(from.normalize(),to.normalize()).premultiply(inv.copy(pq).invert()).multiply(pq);bone.quaternion.premultiply(rot);model.updateWorldMatrix(true,true);}
 function solve(chain){chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);const l1=a.distanceTo(b),l2=b.distanceTo(c);d.copy(chain.target).sub(a);const length=THREE.MathUtils.clamp(d.length(),Math.abs(l1-l2)+1e-5,l1+l2-1e-5);d.normalize();target.copy(a).addScaledVector(d,length);bend.copy(chain.bend).addScaledVector(d,-chain.bend.dot(d)).normalize();const along=(l1*l1-l2*l2+length*length)/(2*length),height=Math.sqrt(Math.max(0,l1*l1-along*along));elbow.copy(a).addScaledVector(d,along).addScaledVector(bend,height);aim(chain.upper,v.copy(b).sub(a),u.copy(elbow).sub(a));chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);aim(chain.lower,v.copy(c).sub(b),u.copy(target).sub(b));chain.end.parent.getWorldQuaternion(pq);chain.end.quaternion.copy(pq.invert().multiply(chain.q));model.updateWorldMatrix(true,true);}
 function apply({mode,phase,presentation,tip,socketWeight=0,timing=null}){
  preview=null;
  const stage=threeHitStage(presentation,mode);if(!stage||mode==='thrust'&&!timing)return;
  const duration=.4,t=duration-phase;
  (model.parent||model).getWorldQuaternion(aq);u.set(0,1,0).applyQuaternion(aq);const tilt=Math.acos(THREE.MathUtils.clamp(u.y,-1,1));
  // Damage recoil owns the body silhouette and cedes it continuously on recovery.
  const settle=1-smooth((t-(duration-.13))/.13);
  const w=smooth(t/.09)*settle*(1-smooth(tilt/.015));if(w<1e-10)return;
  list.forEach((bone,i)=>{saved[i].p.copy(bone.position);saved[i].q.copy(bone.quaternion);});model.updateWorldMatrix(true,true);(model.parent||model).getWorldQuaternion(aq);legs.forEach(capture);capture(arm);
  bones.hand_R.localToWorld(basePalm.set(-.012,.040,-.020).multiplyScalar(socketWeight));baseOffset.copy(basePalm).sub(arm.target);
  // A stage-two guarded coil and a lower stage-three drive. Both feet keep
  // the moving/standing clip's targets while the free arm makes each phrase legible.
  const finisher=stage===3,bodyWeight=w,compression=(finisher?.18:.07)*bodyWeight;
  bones.hips.parent.getWorldQuaternion(pq);bones.hips.parent.getWorldScale(v);u.set(0,-compression/Math.abs(v.y),0).applyQuaternion(pq.invert());bones.hips.position.add(u);model.updateWorldMatrix(true,true);
  rotate(bones.hips,finisher?-.04*bodyWeight:-.02*bodyWeight,finisher?-.12*bodyWeight:.10*bodyWeight,0);
  rotate(bones.spine,finisher?-.10*bodyWeight:-.08*bodyWeight,finisher?-.16*bodyWeight:.14*bodyWeight,finisher?.045*bodyWeight:-.06*bodyWeight);
  rotate(bones.chest,finisher?-.06*bodyWeight:-.05*bodyWeight,finisher?-.12*bodyWeight:.08*bodyWeight,0);
  rotate(bones.neck,0,finisher?.16*bodyWeight:-.12*bodyWeight,0);rotate(bones.head,finisher?-.04*bodyWeight:0,finisher?-.10*bodyWeight:-.08*bodyWeight,0);
  if(finisher){rotate(bones.upperarm_L,.28*bodyWeight,-.35*bodyWeight,.45*bodyWeight);rotate(bones.forearm_L,-.20*bodyWeight,0,-.18*bodyWeight);}
  else{rotate(bones.upperarm_L,-.25*bodyWeight,.12*bodyWeight,-.12*bodyWeight);rotate(bones.forearm_L,-.20*bodyWeight,.08*bodyWeight,0);}
  // A genuinely inactive spear chamber: stage two fans outboard, stage three
  // draws high/outboard. Recovery follows the original supported return. Pole, palm and wrist turn as one supported weapon frame.
  // Five-millisecond margins around the entire contact interval remain exact.
  const chamber=(smooth(t/.055)*(1-smooth((t-.085)/.070)))*(1-smooth(tilt/.015));
  if(tip&&['x','y','z'].every(k=>Number.isFinite(tip[k]))&&chamber>1e-10){
   endTip.set(tip.x,tip.y,tip.z);poleBase.copy(endTip).sub(basePalm);
   poleTurn.setFromEuler(euler.set(finisher?-.55*chamber:0,finisher?-1.05*chamber:-.95*chamber,0,'YXZ')).premultiply(aq).multiply(inv.copy(aq).invert());
   poleGoal.copy(poleBase).applyQuaternion(poleTurn);const gripRadius=poleBase.length(),rearRadius=3.6-gripRadius;
   (model.parent||model).getWorldPosition(actorOrigin);
   // Long windups expose earlier moving-arm poses. Constrain the one rigid
   // shaft against the actual actor floor rather than hiding a ground crossing.
   const maxRise=rearRadius>1e-6?THREE.MathUtils.clamp((basePalm.y-actorOrigin.y-.04)/rearRadius,-1,1):1;
   poleGoal.normalize();if(poleGoal.y>maxRise){const horizontal=Math.hypot(poleGoal.x,poleGoal.z),horizontalScale=Math.sqrt(Math.max(0,1-maxRise*maxRise))/(horizontal||1);poleGoal.x*=horizontalScale;poleGoal.z*=horizontalScale;poleGoal.y=maxRise;poleTurn.setFromUnitVectors(poleBase.clone().normalize(),poleGoal);}
   displayTip.copy(poleGoal).multiplyScalar(gripRadius).add(basePalm);
   arm.target.copy(basePalm).sub(baseOffset.applyQuaternion(poleTurn));arm.q.premultiply(poleTurn);
   preview={elapsed:t,authoritativeTip:{x:tip.x,y:tip.y,z:tip.z},displayTip:displayTip.clone(),stage,actorId:presentation.actorId,actionSerial:presentation.actionSerial,actionCount:presentation.actionCount,timingProfile:timing.profile,actualElapsed:timing.elapsed};
  }
  // Put the shoulder on its real clavicle sphere toward the original wrist.
  // This adds the missing skeletal degree of freedom before the arm solve.
  const clavicle=bones.clavicle_R;clavicle.getWorldPosition(a);bones.upperarm_R.getWorldPosition(b);const length=a.distanceTo(b),from=v.copy(b).sub(a).normalize();d.copy(arm.target).sub(a);const distance=d.length();d.normalize();bones.forearm_R.getWorldPosition(c);const reach=b.distanceTo(c)+c.distanceTo(bones.hand_R.getWorldPosition(target))-.012;const maxAngle=Math.acos(THREE.MathUtils.clamp((distance*distance+length*length-reach*reach)/(2*distance*length),-1,1)),angle=from.angleTo(d);if(angle>1e-8){rot.setFromUnitVectors(from,d);const turnAngle=Math.max(Math.min(angle,.48*w),angle-maxAngle);dq.identity().slerp(rot,turnAngle/angle);u.copy(from).applyQuaternion(dq).multiplyScalar(length);aim(clavicle,from,u);}
  solve(arm);legs.forEach(solve);applied=true;
 }
 return{restore,reset(){restore();preview=null;},apply,preview:()=>preview};
}
