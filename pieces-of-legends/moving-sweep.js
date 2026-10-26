import * as THREE from './vendor/three.module.min.js';

// Opt-in render-only locomotion layer for moving sword sweeps.
// Separate from the forward-thrust profile: the gameplay root remains authoritative.
export function createMovingSweep(model, clips, {scale,preserveSoleClearance}) {
 const names=['hips',...['L','R'].flatMap(s=>['thigh_','shin_','foot_','toe_'].map(n=>n+s))];
 const bones=names.map(n=>model.getObjectByName(n)),hips=bones[0],spine=model.getObjectByName('spine');
 if(bones.some(b=>!b)||!spine)return null;
 const saved=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()})),previous=saved.map(s=>({p:s.p.clone(),q:s.q.clone()}));
 const spineSaved=new THREE.Quaternion(),upper=new THREE.Quaternion();
 const sourceRoot=new THREE.Group(),source=new Map();
 for(const b of bones){const n=new THREE.Object3D();n.position.copy(b.position);n.quaternion.copy(b.quaternion);n.scale.copy(b.scale);source.set(b.name,n);(source.get(b.parent.name)||sourceRoot).add(n);}
 const sets=['walk','run'].map(n=>{const c=clips.find(c=>c.name===n);return{duration:c.duration,stride:c.userData.strideCoefficient,tracks:names.map((n,i)=>({p:i===0?c.tracks.find(t=>t.name===n+'.position').createInterpolant():null,q:c.tracks.find(t=>t.name===n+'.quaternion').createInterpolant()}))}});
 const legs=['L','R'].map((side,i)=>({side,thigh:bones[1+i*4],shin:bones[2+i*4],foot:bones[3+i*4],toe:bones[4+i*4],target:new THREE.Vector3(),rotation:new THREE.Quaternion()}));
 const actorQ=new THREE.Quaternion(),inverseQ=new THREE.Quaternion(),actorOrigin=new THREE.Vector3(),direction=new THREE.Vector3(0,0,1),desiredDirection=new THREE.Vector3(0,0,1),movement=new THREE.Vector3();
 const q=new THREE.Quaternion(),q2=new THREE.Quaternion(),pq=new THREE.Quaternion(),turn=new THREE.Quaternion(),v=new THREE.Vector3(),v2=new THREE.Vector3(),v3=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3(),bend=new THREE.Vector3(),elbow=new THREE.Vector3();
 let applied=false,active=false,weight=0,oldMode='',previousX,previousZ,gaitPhase=0,gaitMix=0,hasPrevious=false;
 const snapshot=to=>bones.forEach((b,i)=>{to[i].p.copy(b.position);to[i].q.copy(b.quaternion)});
 function restore(){if(!applied)return;bones.forEach((b,i)=>{b.position.copy(saved[i].p);b.quaternion.copy(saved[i].q)});spine.quaternion.copy(spineSaved);applied=false;}
 function reset(){restore();active=false;weight=0;oldMode='';previousX=previousZ=undefined;gaitPhase=0;gaitMix=0;hasPrevious=false;direction.set(0,0,1);}
 function aim(bone,from,to){bone.parent.getWorldQuaternion(pq);turn.setFromUnitVectors(from.normalize(),to.normalize());turn.premultiply(pq.clone().invert()).multiply(pq);bone.quaternion.premultiply(turn);model.updateWorldMatrix(true,true);}
 function solve(leg){
  leg.thigh.getWorldPosition(a);leg.shin.getWorldPosition(b);leg.foot.getWorldPosition(c);
  const l1=a.distanceTo(b),l2=b.distanceTo(c);d.copy(leg.target).sub(a);const len=THREE.MathUtils.clamp(d.length(),Math.abs(l1-l2)+1e-4,l1+l2-1e-4);d.normalize();
  v3.copy(a).addScaledVector(d,len);bend.set(leg.side==='L'?.14:-.14,0,1).applyQuaternion(actorQ).addScaledVector(d,-bend.dot(d)).normalize();
  const along=(l1*l1-l2*l2+len*len)/(2*len),height=Math.sqrt(Math.max(0,l1*l1-along*along));elbow.copy(a).addScaledVector(d,along).addScaledVector(bend,height);
  aim(leg.thigh,v.copy(b).sub(a),v2.copy(elbow).sub(a));leg.shin.getWorldPosition(b);leg.foot.getWorldPosition(c);aim(leg.shin,v.copy(c).sub(b),v2.copy(v3).sub(b));
  leg.foot.parent.getWorldQuaternion(pq);leg.foot.quaternion.copy(pq.invert().multiply(leg.rotation));
 }
 function update({mode,phase,x,z,walking,dt,enabled,gaitPhase:ordinaryPhase}) {
  const step=Math.max(0,dt);movement.set(previousX===undefined?0:x-previousX,0,previousZ===undefined?0:z-previousZ);previousX=x;previousZ=z;
  const distance=movement.length(),moving=distance>1e-5;
  (model.parent||model).getWorldScale(v);const unitScale=Math.abs(v.y)||scale;
  (model.parent||model).getWorldQuaternion(actorQ);inverseQ.copy(actorQ).invert();(model.parent||model).getWorldPosition(actorOrigin);
  if(step>0&&moving){desiredDirection.copy(movement).applyQuaternion(inverseQ).normalize();const old=Math.atan2(direction.x,direction.z),goal=Math.atan2(desiredDirection.x,desiredDirection.z),delta=Math.atan2(Math.sin(goal-old),Math.cos(goal-old)),angle=old+delta*(1-Math.exp(-step/.065));direction.set(Math.sin(angle),0,Math.cos(angle));}
  const targetMix=walking?0:1;gaitMix+=THREE.MathUtils.clamp(targetMix-gaitMix,-step/.12,step/.12);
  const directionalScale=1/(1+.75*Math.abs(direction.x)+.25*Math.max(0,-direction.z));
  const stride=THREE.MathUtils.lerp(sets[0].stride,sets[1].stride,gaitMix)*unitScale*directionalScale;
  const desired=enabled&&mode==='sweep'&&(step===0?active:moving);
  if(mode==='sweep'&&oldMode!=='sweep'){gaitPhase=ordinaryPhase;active=desired;}
  if(mode!=='sweep'&&mode!=='ready'){active=false;}
  if(desired)active=true;
  else if(step>0)active=false;
  gaitPhase=(gaitPhase+distance/stride)%1;
  const target=desired?1:0;weight=THREE.MathUtils.clamp(weight+(target?step/.10:-step/.16),0,1);
  oldMode=mode;
  if(!enabled||weight<=0){snapshot(previous);hasPrevious=true;return 0;}
  snapshot(saved);spineSaved.copy(spine.quaternion);upper.copy(hips.quaternion).multiply(spineSaved);
  if(step===0&&hasPrevious){bones.forEach((b,i)=>{b.position.copy(previous[i].p);b.quaternion.copy(previous[i].q)});spine.quaternion.copy(q.copy(hips.quaternion).invert().multiply(upper));applied=true;return weight;}
  const walk=sets[0],run=sets[1];
  for(let i=0;i<bones.length;i++){const s=source.get(names[i]),wt=walk.tracks[i],rt=run.tracks[i];s.quaternion.fromArray(wt.q.evaluate(gaitPhase*walk.duration)).slerp(q.fromArray(rt.q.evaluate(gaitPhase*run.duration)),gaitMix);if(i===0)s.position.fromArray(wt.p.evaluate(gaitPhase*walk.duration)).lerp(v.fromArray(rt.p.evaluate(gaitPhase*run.duration)),gaitMix);}
  sourceRoot.updateMatrixWorld(true);
  const sourceHip=source.get('hips');hips.position.copy(sourceHip.position);hips.quaternion.copy(sourceHip.quaternion);
  for(const leg of legs){
   const foot=source.get(leg.foot.name),toe=source.get(leg.toe.name);foot.getWorldPosition(v);foot.getWorldQuaternion(leg.rotation).premultiply(actorQ);
   leg.target.set(v.x*unitScale+direction.x*v.z*unitScale*directionalScale,v.y*unitScale, direction.z*v.z*unitScale*directionalScale).applyQuaternion(actorQ).add(actorOrigin);
   // Source targets use the same normalized asset origin as the live model.
   leg.target.y+=model.position.y*unitScale;
   leg.toe.quaternion.copy(toe.quaternion);
  }
  model.updateWorldMatrix(true,true);
  // Pelvis height is a shared degree of freedom; limb lengths are never changed.
  let drop=0;
  for(const leg of legs){leg.thigh.getWorldPosition(a);leg.shin.getWorldPosition(b);leg.foot.getWorldPosition(c);const reach=a.distanceTo(b)+b.distanceTo(c)-.002,horiz=Math.hypot(a.x-leg.target.x,a.z-leg.target.z);const maxY=leg.target.y+Math.sqrt(Math.max(.03,reach*reach-horiz*horiz));drop=Math.max(drop,a.y-maxY);}
  hips.position.y-=Math.min(.12,Math.max(0,drop))/unitScale;model.updateWorldMatrix(true,true);
  for(const leg of legs)solve(leg);
  for(let i=0;i<bones.length;i++){bones[i].quaternion.slerp(saved[i].q,1-weight);if(i===0)bones[i].position.lerp(saved[i].p,1-weight);}
  model.getWorldQuaternion(q2);const leaned=Math.abs(q2.x)+Math.abs(q2.z)>1e-6;
  if(weight<1||leaned||(gaitMix>0&&gaitMix<1))preserveSoleClearance();
  spine.quaternion.copy(q.copy(hips.quaternion).invert().multiply(upper));
  snapshot(previous);hasPrevious=true;applied=true;return weight;
 }
 return{restore,reset,update};
}

// Opening/recovery-only wrist mask; the authored active cut (.19–.276 s) is untouched.
export function createMovingSwordReturn(model){
 const hand=model.getObjectByName('hand_R'),edge=model.getObjectByName('hand_edge_R');
 const base=new THREE.Quaternion(),world=new THREE.Quaternion(),parent=new THREE.Quaternion(),actor=new THREE.Quaternion(),turn=new THREE.Quaternion();
 const current=new THREE.Vector3(),goal=new THREE.Vector3(),pos=new THREE.Vector3(),guard=new THREE.Quaternion();let applied=false,curve=0,admitted=false,mask=0,lastMode='',lastPhase=0,warmOpening=false;
 model.updateWorldMatrix(true,true);hand.getWorldPosition(pos);edge.getWorldPosition(current);current.sub(pos).normalize();(model.parent||model).getWorldQuaternion(actor);goal.set(0,.2,1).normalize().applyQuaternion(actor);hand.getWorldQuaternion(world);guard.copy(actor).invert().multiply(turn.setFromUnitVectors(current,goal)).multiply(world);
 const smooth=v=>{v=THREE.MathUtils.clamp(v,0,1);return v*v*(3-2*v);};
 function restore(){if(applied){hand.quaternion.copy(base);applied=false;}}
 function apply(mode,phase,weight,dt,enabled){const step=Math.max(0,dt);if(mode==='sweep'){if(lastMode!=='sweep'||phase>lastPhase+.01){admitted=false;warmOpening=mask>0;}if(weight>0)admitted=true;}else admitted=false;lastMode=mode;lastPhase=phase;mask=enabled?THREE.MathUtils.clamp(mask+(admitted?step/.025:-step/.16),0,1):0;if(mask<=0)return;const t=.46-phase;if(mode==='sweep')curve=Math.max(1-smooth(t/.07),smooth((t-.282)/.030));const w=curve*mask;if(w<=0)return;
  base.copy(hand.quaternion);model.updateWorldMatrix(true,true);hand.getWorldPosition(pos);edge.getWorldPosition(current);current.sub(pos).normalize();(model.parent||model).getWorldQuaternion(actor);goal.set(0,.2,1).normalize().applyQuaternion(actor);
  hand.parent.getWorldQuaternion(parent);if(mode==='sweep'&&t<.07&&!warmOpening){hand.getWorldQuaternion(world);turn.setFromUnitVectors(current,goal);hand.quaternion.copy(parent.invert().multiply(turn).multiply(world));}else hand.quaternion.copy(parent.invert().multiply(actor).multiply(guard));hand.quaternion.slerp(base,1-w);applied=true;
 }
 return{restore,reset(){restore();admitted=false;mask=0;lastMode='';lastPhase=0;curve=0;warmOpening=false;},apply};
}
