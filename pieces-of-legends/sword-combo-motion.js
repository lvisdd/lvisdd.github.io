import * as THREE from './vendor/three.module.min.js';
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t*t*t*(t*(t*6-15)+10); };
const phrases = Object.freeze({
  1: {name:'vertical', chamber:[-.22,.95,.225], release:[0,-.34,.94], upperLoad:[-.97,.06,.24], upperCut:[-.76,-.27,.59], start:.145,end:.275},
  2: {name:'horizontal', chamber:[-.94,.03,.34], release:[.88,.03,.475], upperLoad:[-.67,-.30,.68], upperCut:[.12,-.32,.94], start:.145,end:.275},
  3: {name:'diagonal', chamber:[-.50,.81,.31], release:[.68,-.34,.65], upperLoad:[-.75,.02,.66], upperCut:[.12,-.45,.885], start:.160,end:.275},
});
/** Pose-only phrases for an already accepted ordinary or optional sweep.
 * The arm's real segments are aimed as a chain, never stretched. The held
 * blade follows the real hand/edge markers. The hips, feet and actor root are
 * untouched; authoritative slash waves remain the engine's horizontal slab.
 */
export function swordComboPhrase(presentation, phase) {
  const p=presentation;
  const combo=p?.version==='ground-combo-v2'&&p.stageLimit===3&&[1,2,3].includes(p.stage);
  const ordinary=p?.version==='ordinary-attack-phrase-v1'&&p.clock==='native-action-v1'&&[1,2,3].includes(p.stage);
  if (!p || p.enabled!==true || !(combo||ordinary) || p.action!=='sweep' || !Number.isInteger(p.actorId) || !Number.isInteger(p.actionSerial) || p.actionSerial<=0 || !Number.isInteger(p.actionCount) || p.actionCount<=0) return null;
  const elapsed=.46-phase;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>.46)return null;
  const phrase=phrases[p.stage],cut=smooth((elapsed-phrase.start)/(phrase.end-phrase.start));
  return {stage:p.stage,name:phrase.name,elapsed,cut,opacity:smooth((elapsed-.012)/.028)*(1-smooth((elapsed-.395)/.040)),weight:smooth(elapsed/.060)*(1-smooth((elapsed-.395)/.065)),...phrase};
}
export function createSwordComboMotion(model) {
  const spine=model.getObjectByName('spine'),chest=model.getObjectByName('chest'),head=model.getObjectByName('head'),left=model.getObjectByName('upperarm_L');
  const upper=model.getObjectByName('upperarm_R'),lower=model.getObjectByName('forearm_R'),hand=model.getObjectByName('hand_R'),edge=model.getObjectByName('hand_edge_R');
  if(!spine||!chest||!head||!left||!upper||!lower||!hand||!edge)return {restore(){},reset(){},apply(){}};
  const bones=[spine,chest,head,upper,lower,hand],saved=bones.map(b=>b.quaternion.clone());
  const actorQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),delta=new THREE.Quaternion(),worldQ=new THREE.Quaternion(),targetQ=new THREE.Quaternion();
  const headQ=new THREE.Quaternion(),inverseActor=new THREE.Quaternion();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),from=new THREE.Vector3(),to=new THREE.Vector3(),upperDirection=new THREE.Vector3(),bladeDirection=new THREE.Vector3(),up=new THREE.Vector3();
  let applied=false;
  function restore(){if(!applied)return;bones.forEach((bone,i)=>bone.quaternion.copy(saved[i]));applied=false;}
  function aim(bone,end,direction,weight){
    bone.getWorldPosition(a);end.getWorldPosition(b);from.copy(b).sub(a).normalize();
    delta.setFromUnitVectors(from,direction);bone.getWorldQuaternion(worldQ);bone.parent.getWorldQuaternion(parentQ);
    targetQ.copy(parentQ).invert().multiply(delta).multiply(worldQ);bone.quaternion.slerp(targetQ,weight);model.updateWorldMatrix(true,true);
  }
  function yaw(bone,angle){bone.parent.getWorldQuaternion(parentQ);bone.getWorldQuaternion(worldQ);delta.setFromAxisAngle(up,angle);bone.quaternion.copy(parentQ.invert().multiply(delta).multiply(worldQ));model.updateWorldMatrix(true,true);}
  function apply({mode,phase,presentation}){
    if(mode!=='sweep')return;
    const phrase=swordComboPhrase(presentation,phase);
    if(!phrase){
      // Preserve the older explicit two-stage adapter's small outside guard.
      if(presentation?.enabled===false||presentation?.action!=='sweep'||presentation?.stage!==2||presentation?.stageLimit!==2)return;
      const t=.46-phase;if(!Number.isFinite(t)||t<=.035||t>=.185)return;
      (model.parent||model).getWorldQuaternion(actorQ);up.set(0,1,0).applyQuaternion(actorQ);const tilt=Math.acos(THREE.MathUtils.clamp(up.y,-1,1)),weight=smooth((t-.035)/.040)*(1-smooth((t-.110)/.075))*(1-smooth(tilt/.015));if(weight<1e-10)return;
      bones.forEach((bone,i)=>saved[i].copy(bone.quaternion));model.updateWorldMatrix(true,true);
      up.set(0,1,0);delta.setFromAxisAngle(up,.90);targetQ.identity().slerp(delta,weight);upper.parent.getWorldQuaternion(parentQ);delta.copy(parentQ).invert().multiply(targetQ).multiply(parentQ);upper.quaternion.premultiply(delta);model.updateWorldMatrix(true,true);applied=true;return;
    }
    (model.parent||model).getWorldQuaternion(actorQ);up.set(0,1,0).applyQuaternion(actorQ);
    // A damage tilt owns the silhouette. Do not stack a combo pose on recoil.
    const tilt=Math.acos(THREE.MathUtils.clamp(up.y,-1,1)),weight=phrase.weight*(1-smooth(tilt/.015));if(weight<1e-10)return;
    bones.forEach((bone,i)=>saved[i].copy(bone.quaternion));model.updateWorldMatrix(true,true);
    // The source clip turns its shoulder past the torso centre in its coil.
    // Share a modest counterturn across the two real spine joints so an
    // overhead blade stays outboard of the head, with the source feet exact.
    head.getWorldQuaternion(headQ);upper.getWorldPosition(a);left.getWorldPosition(b);
    from.copy(a).sub(b).applyQuaternion(inverseActor.copy(actorQ).invert());
    const sourceYaw=Math.atan2(from.x,from.z),wantedYaw=-Math.PI/2+(phrase.stage===1?-.08+.14*phrase.cut:phrase.stage===2?-.65+1.05*phrase.cut:-.40+.65*phrase.cut);
    const turn=Math.atan2(Math.sin(wantedYaw-sourceYaw),Math.cos(wantedYaw-sourceYaw))*weight;
    yaw(spine,turn*.55);yaw(chest,turn*.45);
    head.parent.getWorldQuaternion(parentQ);head.quaternion.copy(parentQ.invert().multiply(headQ));model.updateWorldMatrix(true,true);
    bladeDirection.fromArray(phrase.chamber).lerp(to.fromArray(phrase.release),phrase.cut).normalize().applyQuaternion(actorQ);
    upperDirection.fromArray(phrase.upperLoad).lerp(to.fromArray(phrase.upperCut),phrase.cut).normalize().applyQuaternion(actorQ);
    // A compact outside return avoids dragging the pommel across the hips.
    const recovery=smooth((phrase.elapsed-.310)/.085);
    bladeDirection.lerp(to.set(0,.15,.989).normalize().applyQuaternion(actorQ),recovery).normalize();
    upperDirection.lerp(to.set(-.84,-.43,.33).normalize().applyQuaternion(actorQ),recovery).normalize();
    aim(upper,lower,upperDirection,weight);aim(lower,hand,bladeDirection,weight);aim(hand,edge,bladeDirection,weight);
    applied=true;
  }
  return {restore,reset:restore,apply};
}
