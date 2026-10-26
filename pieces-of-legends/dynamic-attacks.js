import * as THREE from './vendor/three.module.min.js';

const smooth = value => { const t=THREE.MathUtils.clamp(value,0,1); return t*t*(3-2*t); };
// Deliberately asymmetric phrasing: load, brief hold, sharp release, then settle.
// The existing clip clock and all gameplay-active intervals remain unchanged.
export function dynamicAttackEnvelope(mode,phase) {
  if(mode==='sweep') {
    const t=.46-phase;
    return {drive:smooth((t-.145)/.06)*(1-smooth((t-.270)/.120)),load:smooth((t-.012)/.078)*(1-smooth((t-.127)/.060)),follow:smooth((t-.280)/.040)*(1-smooth((t-.325)/.135))};
  }
  if(mode==='thrust') {
    const t=.4-phase;
    return {drive:smooth((t-.120)/.075)*(1-smooth((t-.265)/.105)),load:smooth((t-.010)/.065)*(1-smooth((t-.116)/.043)),follow:smooth((t-.275)/.035)*(1-smooth((t-.315)/.085))};
  }
  return {load:0,follow:0,drive:0};
}

// Optional presentation layer for the current original skeleton only. It runs
// after existing locomotion corrections, keeping their exact foot targets.
export function createDynamicAttacks(model) {
  const names=['hips','spine','chest','neck','head','clavicle_R','upperarm_R','forearm_R','hand_R','hand_edge_R','clavicle_L','upperarm_L','forearm_L','hand_L',...['R','L'].flatMap(s=>['thigh_','shin_','foot_'].map(n=>n+s))];
  const list=names.map(n=>model.getObjectByName(n));
  if(list.some(n=>!n))return {restore(){},reset(){},apply(){}};
  const bones=Object.fromEntries(names.map((n,i)=>[n,list[i]])),saved=list.map(b=>({p:b.position.clone(),q:b.quaternion.clone()}));
  const actorQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),worldQ=new THREE.Quaternion(),deltaQ=new THREE.Quaternion(),turn=new THREE.Quaternion(),inverseParent=new THREE.Quaternion(),poseEuler=new THREE.Euler();
  const axis=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3(),bend=new THREE.Vector3(),elbow=new THREE.Vector3(),v=new THREE.Vector3(),v2=new THREE.Vector3(),wanted=new THREE.Vector3();
  const chains=['R','L'].map(side=>({side,upper:bones['thigh_'+side],lower:bones['shin_'+side],end:bones['foot_'+side],target:new THREE.Vector3(),q:new THREE.Quaternion(),bend:new THREE.Vector3()}));
  const arm={upper:bones.upperarm_R,lower:bones.forearm_R,end:bones.hand_R,target:new THREE.Vector3(),q:new THREE.Quaternion(),bend:new THREE.Vector3()};
  let applied=false,lastMode='',returnTail=0;
  function restore(){if(!applied)return;list.forEach((bone,i)=>{bone.position.copy(saved[i].p);bone.quaternion.copy(saved[i].q);});applied=false;}
  function rotate(bone,x,y,z){
    if(!x&&!y&&!z)return;
    bone.getWorldQuaternion(worldQ);bone.parent.getWorldQuaternion(parentQ);
    deltaQ.setFromEuler(poseEuler.set(x,y,z,'YXZ'));
    deltaQ.premultiply(actorQ).multiply(turn.copy(actorQ).invert());
    bone.quaternion.copy(parentQ.invert().multiply(deltaQ).multiply(worldQ));
    model.updateWorldMatrix(true,true);
  }
  function capture(chain){
    chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(chain.target);chain.end.getWorldQuaternion(chain.q);
    d.copy(chain.target).sub(a).normalize();chain.bend.copy(b).sub(a).addScaledVector(d,-v.copy(b).sub(a).dot(d)).normalize();
  }
  function aim(bone,from,to){
    bone.parent.getWorldQuaternion(parentQ);turn.setFromUnitVectors(from.normalize(),to.normalize());
    turn.premultiply(inverseParent.copy(parentQ).invert()).multiply(parentQ);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);
  }
  function solve(chain){
    chain.upper.getWorldPosition(a);chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);
    const l1=a.distanceTo(b),l2=b.distanceTo(c);d.copy(chain.target).sub(a);
    const len=THREE.MathUtils.clamp(d.length(),Math.abs(l1-l2)+1e-5,l1+l2-1e-5);d.normalize();wanted.copy(a).addScaledVector(d,len);
    bend.copy(chain.bend).addScaledVector(d,-chain.bend.dot(d));
    if(bend.lengthSq()<1e-8)bend.set(0,0,1).applyQuaternion(actorQ).addScaledVector(d,-bend.dot(d));bend.normalize();
    const along=(l1*l1-l2*l2+len*len)/(2*len),height=Math.sqrt(Math.max(0,l1*l1-along*along));elbow.copy(a).addScaledVector(d,along).addScaledVector(bend,height);
    aim(chain.upper,v.copy(b).sub(a),v2.copy(elbow).sub(a));chain.lower.getWorldPosition(b);chain.end.getWorldPosition(c);aim(chain.lower,v.copy(c).sub(b),v2.copy(wanted).sub(b));
    chain.end.parent.getWorldQuaternion(parentQ);chain.end.quaternion.copy(parentQ.invert().multiply(chain.q));model.updateWorldMatrix(true,true);
  }
  function apply({mode,phase,enabled=false,dt=0}){
    if(!enabled){lastMode='';returnTail=0;return;}
    if(lastMode==='sweep'&&mode==='ready')returnTail=.10;
    if(mode!=='ready')returnTail=0;else returnTail=Math.max(0,returnTail-Math.max(0,dt));
    lastMode=mode;
    let {load,follow,drive}=dynamicAttackEnvelope(mode,phase);
    const opening=mode==='sweep'?1-smooth((.46-phase)/.065):0;
    if(load+follow+drive+opening+returnTail<=1e-10)return;
    list.forEach((bone,i)=>{saved[i].p.copy(bone.position);saved[i].q.copy(bone.quaternion);});
    model.updateWorldMatrix(true,true);(model.parent||model).getWorldQuaternion(actorQ);
    // Recoil owns the body silhouette while a hit tilts the render root.
    // Smoothly remove the larger body drive instead of compounding that lean.
    axis.set(0,1,0).applyQuaternion(actorQ);const tilt=Math.acos(THREE.MathUtils.clamp(axis.y,-1,1)),brace=1-smooth((tilt-.015)/.065);load*=brace;follow*=brace;drive*=brace;
    chains.forEach(capture);capture(arm);
    const slash=mode==='sweep',coil=slash?-load+follow*.65+drive*.50:-load+follow*.35-drive*.40,compression=load*(slash?.24:.09)+drive*(slash?.115:.07)+follow*.075;
    // Only pelvis height changes. Actor X/Z and bone lengths are never modified.
    bones.hips.parent.getWorldQuaternion(parentQ);bones.hips.parent.getWorldScale(v);
    axis.set(0,-compression/Math.abs(v.y),0).applyQuaternion(parentQ.invert());bones.hips.position.add(axis);model.updateWorldMatrix(true,true);
    rotate(bones.hips,-.045*load+(slash?.045:.08)*drive+.025*follow,(slash?.20:.09)*coil,slash?-.04*coil:0);
    rotate(bones.spine,-.06*load+(slash?.09:.17)*drive+.04*follow,(slash?.27:.10)*coil,slash?-.045*coil:.025*coil);
    rotate(bones.chest,-.035*load+(slash?.07:.20)*drive+.035*follow,(slash?.19:.08)*coil,0);
    // Head counterturns so the gaze keeps reading toward the intended target.
    rotate(bones.neck,0,(slash?-.21:-.09)*coil,0);
    rotate(bones.head,0,(slash?-.14:-.06)*coil,0);
    // The free arm counterbalances the loaded shoulder and then trails it.
    rotate(bones.upperarm_L,slash?-.16*load+.25*drive+.15*follow:-.18*load+.46*drive+.14*follow,slash?.15*load-.22*drive+.16*follow:-.12*load+.16*drive+.08*follow,slash?.34*load+.18*drive-.12*follow:.28*load+.09*drive-.08*follow);
    rotate(bones.forearm_L,slash?.10*load:-.10*load,0,slash?.12*load:.10*load);
    if(slash){rotate(bones.upperarm_R,.04*load-.10*follow,-.10*load+.08*follow,-.06*load+.08*follow);}
    // Keep the thrust palm supported by fixed-length IK, with a small outward
    // recoil correction. Slash hand/edge anchors stay exact during contact.
    if(mode==='thrust'){
      const t=.4-phase,gripWindow=smooth(t/.06)*(1-smooth((t-.30)/.10));
      // Keep the palm outside the leaning torso. The engine tip and pole
      // length remain unchanged; this small recoil-only socket motion is IK.
      const gripOut=.16*Math.sin(Math.min(1,tilt/.13)*Math.PI/2)*gripWindow;
      axis.set(-1,0,0).applyQuaternion(actorQ);arm.target.addScaledVector(axis,gripOut);solve(arm);
    }
    else if(slash){const t=.46-phase,keep=smooth((t-.125)/.060)*(1-smooth((t-.277)/.030));if(keep>0){arm.end.getWorldPosition(v);arm.target.lerp(v,1-keep);arm.end.getWorldQuaternion(worldQ);arm.q.slerp(worldQ,1-keep);solve(arm);}}
    chains.forEach(solve);
    if(slash||returnTail>0){
      const t=.46-phase,w=slash?Math.max(opening,smooth((t-.282)/.035)):smooth(returnTail/.10);
      if(w>0){
        const hand=bones.hand_R;hand.getWorldPosition(a);bones.hand_edge_R.getWorldPosition(b);d.copy(b).sub(a).normalize();wanted.set(0,.25,1).normalize().applyQuaternion(actorQ);
        hand.getWorldQuaternion(worldQ);hand.parent.getWorldQuaternion(parentQ);turn.setFromUnitVectors(d,wanted);deltaQ.copy(parentQ).invert().multiply(turn).multiply(worldQ);hand.quaternion.slerp(deltaQ,w);
      }
    }
    applied=true;
  }
  return {restore,reset(){restore();lastMode='';returnTail=0;},apply};
}
