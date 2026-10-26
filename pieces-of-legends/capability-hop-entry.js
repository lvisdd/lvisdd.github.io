import * as THREE from './vendor/three.module.min.js';

// A scoped correction for walking actors entering the already-authored jump.
// Captured displayed-pose entry blend plus fixed-length leg IK. Never moves
// actor/root or changes
// collision. Unwind first next sample so it cannot accumulate or contaminate
// another action. Disabled on every standard piece profile, including knight.
export function createCapabilityHopEntry(model,soleGroups=[]) {
  const feet=Object.fromEntries(['L','R'].map(side=>[side,{upper:model.getObjectByName('thigh_'+side),lower:model.getObjectByName('shin_'+side),foot:model.getObjectByName('foot_'+side)}]));
  if(Object.values(feet).some(p=>!p.upper||!p.lower||!p.foot))return {prepare(){},restore(){},apply(){return 0;},reset(){}};
  const bones=[];model.traverse(node=>{if(node.isBone)bones.push(node);});
  let entryFrom=null,lastMode='',lastEnabled=false;
  const original=new Map(),groups={L:[],R:[]},probe=new THREE.Vector3(),origin=new THREE.Vector3();
  const position=bone=>bone.getWorldPosition(new THREE.Vector3());
  // updateWorldMatrix alone does not run SkinnedMesh.updateMatrixWorld's
  // attached-bind inverse update. Refresh both before inspecting skin vertices,
  // especially when the actor root was tilted by hit feedback this frame.
  function sync(){model.updateWorldMatrix(true,true);model.updateMatrixWorld(true);}
  sync();const anchors={L:position(feet.L.foot),R:position(feet.R.foot)};
  // Reuse the sampler's neutral-rig sole index cache. Do not rescan all mesh
  // vertices, and do not derive contact groups from an already-moving pose.
  for(const {mesh,indices} of soleGroups){const sides={L:[],R:[]};mesh.skeleton.update();for(const i of indices){mesh.getVertexPosition(i,probe).applyMatrix4(mesh.matrixWorld);sides[probe.distanceToSquared(anchors.L)<probe.distanceToSquared(anchors.R)?'L':'R'].push(i);}for(const side of ['L','R'])if(sides[side].length)groups[side].push({mesh,indices:sides[side]});}
  function remember(bone){if(!original.has(bone))original.set(bone,{p:bone.position.clone(),q:bone.quaternion.clone()});}
  function prepare({enabled=false,mode}={}){
    // Capture what was actually displayed, before any prior procedural layer is
    // unwound. Mixer crossfades alone only remember the underlying base clip.
    if(enabled&&mode==='jump'&&(!lastEnabled||lastMode!=='jump'))entryFrom=bones.map(bone=>({bone,p:bone.position.clone(),q:bone.quaternion.clone()}));
    if(!enabled||mode!=='jump')entryFrom=null;
    lastMode=mode;lastEnabled=enabled;
  }
  function restore(){if(!original.size)return;for(const [bone,pose] of original){bone.position.copy(pose.p);bone.quaternion.copy(pose.q);}original.clear();sync();}

  function aim(bone,from,to){
    if(from.lengthSq()<1e-16||to.lengthSq()<1e-16)return;
    const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()),turn=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
    bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));sync();
  }
  function lift(p,dy){
    const start=position(p.upper),middle=position(p.lower),end=position(p.foot),target=end.clone().add(new THREE.Vector3(0,dy,0)),footWorld=p.foot.getWorldQuaternion(new THREE.Quaternion());
    const a=start.distanceTo(middle),b=middle.distanceTo(end),direction=target.clone().sub(start),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(a-b)+1e-7,a+b-1e-7);direction.normalize();
    target.copy(start).addScaledVector(direction,distance);
    const pole=middle.clone().sub(start);pole.addScaledVector(direction,-pole.dot(direction));
    if(pole.lengthSq()<1e-12){pole.set(0,0,1).applyQuaternion(p.upper.parent.getWorldQuaternion(new THREE.Quaternion()));pole.addScaledVector(direction,-pole.dot(direction));}
    pole.normalize();const along=(a*a-b*b+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,a*a-along*along)),knee=start.clone().addScaledVector(direction,along).addScaledVector(pole,bend);
    aim(p.upper,middle.clone().sub(start),knee.sub(start));aim(p.lower,position(p.foot).sub(position(p.lower)),target.sub(position(p.lower)));
    p.foot.quaternion.copy(p.foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footWorld));sync();
  }
  function floor(side){let low=Infinity;for(const {mesh,indices} of groups[side]){mesh.skeleton.update();for(const i of indices){mesh.getVertexPosition(i,probe).applyMatrix4(mesh.matrixWorld);low=Math.min(low,probe.y);}}return low;}
  function apply({enabled=false,mode,phase}={}){
    if(!enabled||mode!=='jump'||.9-phase>.14+1e-9)return 0;
    const elapsed=.9-phase;
    if(entryFrom&&elapsed<.08){const t=THREE.MathUtils.clamp(elapsed/.08,0,1),blend=t*t*(3-2*t);for(const from of entryFrom){const bone=from.bone;remember(bone);if(bone.name==='hips')bone.position.lerpVectors(from.p,original.get(bone).p,blend);bone.quaternion.copy(from.q).slerp(original.get(bone).q,blend);}}
    sync();(model.parent||model).getWorldPosition(origin);let correction=0;
    for(const side of ['L','R']){
      const p=feet[side],dy=Math.max(0,origin.y-floor(side)+1e-7);if(dy<=1e-7)continue;
      for(const bone of [p.upper,p.lower,p.foot])remember(bone);
      // Sole vertices can retain a small shin weight. Re-measure rather than
      // assuming that moving the ankle lifts every weighted vertex equally.
      for(let i=0;i<3;i++){const delta=Math.max(0,origin.y-floor(side)+1e-7);if(delta<=1e-7)break;lift(p,delta);correction=Math.max(correction,delta);}
    }
    return correction;
  }
  return {prepare,restore,apply,reset(){restore();entryFrom=null;lastMode='';lastEnabled=false;}};
}
