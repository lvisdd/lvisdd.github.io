import * as T from './vendor/three.module.min.js';

// Opt-in original-rig appearance layer; the caller owns per-piece enablement.
// The dash uses a push / distance-driven leg pulses / actual-stop brace,
// not a distance-compressed run cycle. Grounded combat rules remain authoritative.
export const STYLIZED_DASH_PROFILE=Object.freeze({enabled:false,pushDistance:.78,entry:.045,driveStepDistance:3.42,contactDuty:.23,driveLeanBase:.12,driveLeanPulse:.18,driveCompression:.04,driveRebound:.035,gazeCounter:.30,brake:.20,locomotionReturn:.065});
export function createStylizedDash(model,{scale=3.8/.9752848,profile=STYLIZED_DASH_PROFILE}={}){
 const P=profile;
 const names=['hips',...['L','R'].flatMap(s=>['thigh_','shin_','foot_','toe_'].map(n=>n+s)),...['L','R'].flatMap(s=>['upperarm_','forearm_','hand_'].map(n=>n+s)),'neck'],bones=names.map(n=>model.getObjectByName(n));if(bones.some(b=>!b))return null;
 const neck=model.getObjectByName('neck'),hips=bones[0],frame=model.parent||model,saved=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()})),last=saved.map(b=>({p:b.p.clone(),q:b.q.clone()}));
 const swordHandPosition=new T.Vector3(),swordHandRotation=new T.Quaternion();
 const origin=new T.Vector3(),actor=new T.Quaternion(),motion=new T.Quaternion(),inverse=new T.Quaternion(),parent=new T.Quaternion(),turn=new T.Quaternion(),rot=new T.Quaternion();
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),d=new T.Vector3(),v=new T.Vector3(),w=new T.Vector3(),bend=new T.Vector3(),knee=new T.Vector3(),target=new T.Vector3();
 const smooth=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
 model.updateWorldMatrix(true,true);frame.getWorldQuaternion(actor);frame.getWorldPosition(origin);inverse.copy(actor).invert();motion.copy(actor);
 const probes=[],legs=['L','R'].map((side,i)=>{const thigh=bones[1+i*4],shin=bones[2+i*4],foot=bones[3+i*4],toe=bones[4+i*4];foot.getWorldQuaternion(rot);foot.getWorldPosition(c);thigh.getWorldPosition(a);const q=rot.clone(),sole=[];model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const indices=[];for(let j=0;j<mesh.geometry.attributes.position.count;j++){v.fromBufferAttribute(mesh.geometry.attributes.position,j);if(v.y<.009&&(side==='L'?v.x>.055:v.x<-.055)){mesh.getVertexPosition(j,w).applyMatrix4(mesh.matrixWorld).sub(c).applyQuaternion(q.clone().invert());sole.push(w.clone());indices.push(j);}}if(indices.length)probes.push({mesh,indices,side});});return{side,thigh,shin,foot,toe,neutral:q.premultiply(inverse),toeQ:toe.quaternion.clone(),x:a.sub(origin).applyQuaternion(inverse).x,sole,target:new T.Vector3(),rotation:new T.Quaternion(),lastWorld:c.clone(),brakeFrom:c.clone()};});
 const arms=['L','R'].map(side=>({side,upper:model.getObjectByName('upperarm_'+side),fore:model.getObjectByName('forearm_'+side),hand:model.getObjectByName('hand_'+side),target:new T.Vector3()})),edge=model.getObjectByName('hand_edge_R');
 let applied=false,hasLast=false,previousX,previousZ,lastMode='',lastPhase=0,state='off',distance=0,weight=0,brakeTime=0,brakeDuration=.20,returning=false,maxReachError=0,maxLegReachError=0,maxArmReachError=0,lastLean=0,lastCompression=0,leadIndex=0,wasShort=false,launchLean=0,pulse=0;
 const snapshot=to=>bones.forEach((b,i)=>{to[i].p.copy(b.position);to[i].q.copy(b.quaternion)});
 function restore(){if(!applied)return;bones.forEach((b,i)=>{b.position.copy(saved[i].p);b.quaternion.copy(saved[i].q)});applied=false;}
 function reset(){restore();hasLast=false;previousX=previousZ=undefined;lastMode='';lastPhase=0;state='off';distance=0;weight=0;brakeTime=0;returning=false;maxReachError=0;maxLegReachError=maxArmReachError=0;lastLean=lastCompression=0;leadIndex=0;wasShort=false;launchLean=0;pulse=0;}
 function aim(bone,from,to){bone.parent.getWorldQuaternion(parent);turn.setFromUnitVectors(from.normalize(),to.normalize());turn.premultiply(parent.clone().invert()).multiply(parent);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);}
 function solve(first,second,end,goal,side,keepBend=false){first.getWorldPosition(a);second.getWorldPosition(b);end.getWorldPosition(c);const l1=a.distanceTo(b),l2=b.distanceTo(c);d.copy(goal).sub(a);const desired=d.length(),len=T.MathUtils.clamp(desired,Math.abs(l1-l2)+1e-5,first.name.startsWith('upperarm')?(l1+l2)*.97:l1+l2-1e-5);maxReachError=Math.max(maxReachError,desired-len);if(first.name.startsWith('thigh'))maxLegReachError=Math.max(maxLegReachError,desired-len);else maxArmReachError=Math.max(maxArmReachError,desired-len);d.normalize();target.copy(a).addScaledVector(d,len);if(keepBend){bend.copy(b).sub(a);bend.addScaledVector(d,-bend.dot(d));}else bend.set(side==='L'?.16:-.16,0,1).applyQuaternion(motion).addScaledVector(d,-bend.dot(d));if(bend.lengthSq()<1e-10)bend.set(1,0,0);bend.normalize();const along=(l1*l1-l2*l2+len*len)/(2*len),height=Math.sqrt(Math.max(0,l1*l1-along*along));knee.copy(a).addScaledVector(d,along).addScaledVector(bend,height);aim(first,v.copy(b).sub(a),w.copy(knee).sub(a));second.getWorldPosition(b);end.getWorldPosition(c);aim(second,v.copy(c).sub(b),w.copy(target).sub(b));}
 function legGoal(leg,fore,lift,pitch){rot.setFromAxisAngle(v.set(1,0,0),pitch);leg.rotation.copy(rot).multiply(leg.neutral).premultiply(motion);let min=Infinity;for(const p of leg.sole)min=Math.min(min,w.copy(p).applyQuaternion(leg.rotation).y);leg.target.set(leg.x+(leg.side==='L'?.11:-.11),0,fore).applyQuaternion(motion).add(origin);leg.target.y=origin.y-min+.002+lift;}
 function placeLeg(leg,keepBend=false){solve(leg.thigh,leg.shin,leg.foot,leg.target,leg.side,keepBend);leg.foot.parent.getWorldQuaternion(parent);leg.foot.quaternion.copy(parent.invert().multiply(leg.rotation));model.updateWorldMatrix(true,true);}
 function clearFloor(){model.updateWorldMatrix(true,true);for(const leg of legs){let floor=Infinity;for(const p of probes.filter(p=>p.side===leg.side)){p.mesh.skeleton.update();for(const index of p.indices){p.mesh.getVertexPosition(index,v).applyMatrix4(p.mesh.matrixWorld);floor=Math.min(floor,v.y);}}if(floor<origin.y){leg.foot.getWorldPosition(leg.target);leg.target.y+=origin.y-floor+.0001;leg.foot.getWorldQuaternion(leg.rotation);placeLeg(leg,true);}leg.foot.getWorldPosition(leg.lastWorld);}}
 function update({mode,phase=0,cooldown=0,x,z,dt,enabled=false}){
  const step=Math.max(0,dt),dx=previousX===undefined?0:x-previousX,dz=previousZ===undefined?0:z-previousZ,travel=Math.hypot(dx,dz);previousX=x;previousZ=z;
  const action=['windup','charge','dragon'].includes(mode),rush=['charge','dragon'].includes(mode),allowed=action||mode==='ready'||mode==='charge_recover';
  if(!enabled||!allowed){state='off';weight=0;returning=false;lastMode=mode;lastPhase=phase;snapshot(last);hasLast=true;model.updateWorldMatrix(true,true);for(const leg of legs)leg.foot.getWorldPosition(leg.lastWorld);return 0;}
  const fresh=action&&(!['windup','charge','dragon'].includes(lastMode)||mode===lastMode&&phase>lastPhase+.01);
  if(fresh){state=mode==='windup'?'push':'drive';distance=0;brakeTime=0;returning=false;frame.getWorldQuaternion(motion);v.set(0,0,1).applyQuaternion(motion);leadIndex=legs[0].lastWorld.dot(v)>=legs[1].lastWorld.dot(v)?0:1;wasShort=mode==='dragon';launchLean=0;}
  if(rush&&lastMode==='windup'){distance=0;launchLean=lastLean;}
  const ending=['charge','dragon','windup'].includes(lastMode)&&!action;
  if(ending){state='brace';brakeTime=0;brakeDuration=lastMode==='dragon'||mode==='charge_recover'?.20:Math.max(.04,Math.min(.20,(cooldown||.065)+step));returning=travel>1e-5&&lastMode==='windup';for(const leg of legs)leg.brakeFrom.copy(leg.lastWorld).add(v.set(dx,0,dz));}
  if(step>0&&travel>1e-5&&(action||ending)){distance+=travel;motion.setFromAxisAngle(v.set(0,1,0),Math.atan2(dx,dz));}
  if(action)state=mode==='windup'?'push':'drive';
  if(state==='brace'&&step>0){if(travel>1e-5&&!ending)returning=true;brakeTime+=step;}
  frame.getWorldPosition(origin);frame.getWorldQuaternion(actor);v.set(0,1,0).applyQuaternion(actor);const takingHit=Math.hypot(v.x,v.z)>1e-6&&(action||state!=='off');
  // Damage owns the silhouette while v50's existing root recoil is active.
  // Retain only ankle clearance, then rebuild the attack layer after impact.
  if(takingHit){weight=0;state='impact';snapshot(saved);applied=true;if(step===0&&hasLast){bones.forEach((b,i)=>{b.position.copy(last[i].p);b.quaternion.copy(last[i].q)});}else{clearFloor();snapshot(last);hasLast=true;}lastMode=mode;lastPhase=phase;return 0;}
  if(step>0)weight=T.MathUtils.clamp(weight+(action?step/P.entry:-step/(returning?P.locomotionReturn:brakeDuration)),0,1);
  lastMode=mode;lastPhase=phase;
  if(weight<=0){state='off';snapshot(last);hasLast=true;model.updateWorldMatrix(true,true);for(const leg of legs)leg.foot.getWorldPosition(leg.lastWorld);return 0;}
  snapshot(saved);applied=true;
  if(step===0&&hasLast){bones.forEach((b,i)=>{b.position.copy(last[i].p);b.quaternion.copy(last[i].q)});return weight;}
  frame.getWorldPosition(origin);frame.getWorldQuaternion(actor);arms[1].hand.getWorldPosition(swordHandPosition);arms[1].hand.getWorldQuaternion(swordHandRotation);
  const prep=smooth(1-phase/.075),stepDistance=P.driveStepDistance,half=wasShort?0:Math.floor(distance/stepDistance),u=wasShort?T.MathUtils.clamp(distance/3,0,1):(distance/stepDistance)%1,duty=P.contactDuty,swing=T.MathUtils.clamp((u-duty)/(1-duty),0,1),launch=smooth(distance/.55),brake=smooth(brakeTime/.085);
  pulse=Math.sin(Math.PI*u);const drive=smooth(T.MathUtils.clamp(u/.30,0,1));
  let lean=state==='push'?-.12*Math.sin(Math.PI*T.MathUtils.clamp(1-phase/.075,0,1))+.10*prep:state==='drive'?launchLean*(1-launch)+(P.driveLeanBase+P.driveLeanPulse*pulse)*launch:Math.min(.18,lastLean)*(1-brake)-.085*Math.sin(brake*Math.PI),compression=state==='push'?.22*Math.sin(Math.PI*T.MathUtils.clamp(1-phase/.075,0,1)):state==='drive'?P.driveCompression-P.driveRebound*pulse*pulse:Math.max(0,lastCompression*(1-brake)+.24*Math.sin(brake*Math.PI));
  const yaw=state==='drive'?(half%2?-1:1)*.12*Math.sin(2*Math.PI*u):state==='push'?-.12*Math.sin(Math.PI*T.MathUtils.clamp(1-phase/.075,0,1))+.10*prep:0;
  if(state==='brace'&&returning){lean=lastLean;compression=lastCompression;}
  if(state!=='brace'){lastLean=lean;lastCompression=compression;}
  hips.position.y-=compression/scale;hips.parent.getWorldQuaternion(parent);turn.setFromAxisAngle(v.set(1,0,0),lean);rot.setFromAxisAngle(v.set(0,1,0),yaw);turn.multiply(rot);turn.premultiply(actor).multiply(actor.clone().invert());turn.premultiply(parent.clone().invert()).multiply(parent);hips.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);
  for(let i=0;i<legs.length;i++){
   const leg=legs[i],lead=i===(leadIndex+half)%2;
   if(state==='push')legGoal(leg,lead?.40:.05,0,lead?0:.35*prep);
   else if(state==='drive'){
    if(lead){const fore=u<=duty?.40+.18*smooth(u/duty):.58-.53*smooth(swing),lift=u<=duty?.15+.28*smooth(u/duty):.43*(1-smooth(swing)),pitch=.10+.25*smooth(swing);legGoal(leg,fore,lift,pitch);}
    else if(u<=duty)legGoal(leg,.05-stepDistance*u,0,.35+.35*smooth(u/duty));
    else legGoal(leg,.05-stepDistance*duty+(.35+stepDistance*duty)*smooth(swing),.36*Math.sin(Math.PI*swing)+.15*smooth(swing),.70-.60*smooth(swing));
   }else{legGoal(leg,lead?.61:-.34,0,lead?-.02:.28*(1-brake));if(!returning)leg.target.lerp(leg.brakeFrom,1-smooth(brakeTime/.055));}
   leg.toe.quaternion.copy(leg.toeQ);placeLeg(leg);
  }
  // Keep the gaze above the fixed charge effect while the torso drives forward.
  // This rotates the existing neck joint; it never raises the actor or stretches a bone.
  const counter=state==='push'?0:-(lean+P.gazeCounter*(state==='drive'?1:1-brake));
  neck.parent.getWorldQuaternion(parent);turn.setFromAxisAngle(v.set(1,0,0),counter);turn.premultiply(actor).multiply(actor.clone().invert());turn.premultiply(parent.clone().invert()).multiply(parent);neck.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);
  // The attack silhouette reaches forward without moving the gameplay wave.
  const reach=state==='push'?.75*prep:state==='drive'?1:1-brake;
  for(const arm of arms){const side=arm.side==='L'?1:-1;arm.target.set(side*(arm.side==='R'?(state==='push'?.82:.65):.78),arm.side==='R'?(state==='push'?1.55:1.68+.12*pulse):1.65,arm.side==='R'?(state==='push'?-.14:.75+.30*drive):-.08+.40*pulse).applyQuaternion(actor).add(origin);arm.hand.getWorldPosition(v);arm.target.lerp(v,1-reach);if(reach>0)solve(arm.upper,arm.fore,arm.hand,arm.target,arm.side,true);model.updateWorldMatrix(true,true);}
  if(edge&&!wasShort){const hand=arms[1].hand;hand.getWorldPosition(a);edge.getWorldPosition(b);v.copy(b).sub(a);w.set(0,.04,1).applyQuaternion(actor);const q=hand.quaternion.clone();aim(hand,v,w);hand.quaternion.slerp(q,1-reach);}
  bones.forEach((b,i)=>{b.quaternion.slerp(saved[i].q,1-weight);if(b===hips)b.position.lerp(saved[i].p,1-weight);});model.updateWorldMatrix(true,true);
  if(wasShort){const arm=arms[1];solve(arm.upper,arm.fore,arm.hand,swordHandPosition,arm.side,true);arm.hand.parent.getWorldQuaternion(parent);arm.hand.quaternion.copy(parent.invert().multiply(swordHandRotation));model.updateWorldMatrix(true,true);}
  clearFloor();
  snapshot(last);hasLast=true;return weight;
 }
 return{restore,reset,update,diagnostics:()=>({state,distance,weight,brakeTime,brakeDuration,returning,maxReachError,maxLegReachError,maxArmReachError,lastLean,lastCompression,pulse,leadIndex,wasShort})};
}
