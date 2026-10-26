import {NPC_READY_VERSION,NPC_READY_HAND_WEIGHT} from './npc-ready-pose.js';
import {HERO_SPEAR_PALM_SOCKET} from './spear-hand-grip.js';
import {createGuardHandFist} from './guard-hand-fist.js';
import {createThreeHeightSpearPose} from './three-height-spear-pose.js';
import {createHeroSpearPose} from './hero-spear-pose.js';
import {createSharedSpearMotion,createSharedSpearPose} from './shared-spear-motion.js';
import {createThreeHitMotion} from './three-hit-motion.js';
import {createSwordComboMotion} from './sword-combo-motion.js';
import {createCapabilityHopEntry} from './capability-hop-entry.js';
import {createStylizedDash} from './stylized-dash.js';
import {createDynamicAttacks} from './dynamic-attacks.js';
import { createDynamicJumpClip } from './dynamic-jump.js';
import {createMovingSweep,createMovingSwordReturn} from './moving-sweep.js';
import * as THREE from './vendor/three.module.min.js';
import { createGuardStanceClip, guardStanceProfile, createGuardStanceTransition } from './guard-stance.js';

// Controllers may share immutable baked clips only when their source idle,
// bind skeleton, shared mesh geometry and normalization match exactly.
const presentationClipCache = new WeakMap();
function presentationRigKey(model) {
  model.updateWorldMatrix(true,true);
  const parts=[model.position.toArray(),model.quaternion.toArray(),model.scale.toArray(),model.getWorldScale(new THREE.Vector3()).toArray(),model.getWorldQuaternion(new THREE.Quaternion()).toArray()];
  model.traverse(node=>{if(node.isBone)parts.push(node.name,node.parent.name,node.position.toArray(),node.quaternion.toArray(),node.scale.toArray());if(node.isSkinnedMesh)parts.push(node.geometry.uuid,node.skeleton.boneInverses.map(m=>m.elements));});
  return JSON.stringify(parts);
}

export function createSamuraiActions(model, clips, { scale = 3.8 / .9752848, presentationOwner = 'npc', spearPresentationOwner = presentationOwner } = {}) {
  const sharedSpearMotion=createSharedSpearMotion(),sharedSpearPose=spearPresentationOwner==='hero'?createHeroSpearPose(model,{recoilSupport:presentationOwner==='hero'}):createSharedSpearPose(model);let sharedSpearFrame=null;
  const guardHandFist=presentationOwner==='hero'?createGuardHandFist(model):null;
  const sourceIdle = clips.find(clip => clip.name === 'idle');
  const guardClip = createGuardStanceClip(model, sourceIdle);
  if (guardClip) clips = [...clips, guardClip];
  let bracedGuardClip, dynamicJumpClip;
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(clips.map(clip => [clip.name, mixer.clipAction(clip)]));
  // Reuse the existing idle fade, without a second animation clock/history.
  const npcReadyAction=presentationOwner==='npc'&&sourceIdle?.userData?.npcReady===NPC_READY_VERSION?actions.get('idle'):null;
  const required = ['idle', 'walk', 'run', 'charge_windup', 'charge', 'charge_recover', 'hand_slash', 'thrust', 'jump'];
  for (const name of required) if (!actions.has(name)) throw new Error('Missing character action: ' + name);
  const configuredStride=clips.find(clip=>clip.name==='run')?.userData?.strideCoefficient,runStride=Number.isFinite(configuredStride)&&configuredStride>.5&&configuredStride<3?configuredStride:1.6464407873196987;
  const walkCalibration=clips.find(clip=>clip.name==='walk')?.userData?.strideCoefficient,walkStride=Number.isFinite(walkCalibration)&&walkCalibration>.2&&walkCalibration<3?walkCalibration:.4280746047031217;
  const calibratedWalking=Number.isFinite(walkCalibration)&&walkCalibration>.2&&walkCalibration<3&&clips.find(clip=>clip.name==='walk')?.userData?.calibration===clips.find(clip=>clip.name==='run')?.userData?.calibration;
  const hand = model.getObjectByName('hand_R');
  const edge = model.getObjectByName('hand_edge_R');
  if (!hand) throw new Error('Missing right hand bone');
  if (!edge) throw new Error('Missing hand edge marker');
  const pointA = new THREE.Vector3(), pointB = new THREE.Vector3(), thrustGrip = new THREE.Vector3(), chargeGrip = new THREE.Vector3();
  const thrustArm = createThrustArmPose(model, hand);
  const chargeArm = createThrustArmPose(model, hand, true,spearPresentationOwner==='hero'),chargeArmReturn=createMovingThrustReturn(model);
  const guardTransition = createGuardStanceTransition(model);
  const dynamicAttackPose = createDynamicAttacks(model);
  const threeHitMotion = createThreeHitMotion(model),threeHeightSpearPose=createThreeHeightSpearPose(model,{poleLength:spearPresentationOwner==='hero'?2.4:3.6});
  const swordComboMotion = createSwordComboMotion(model);
  // Only mixed locomotion poses need this correction. Gameplay roots and attack clips are untouched.
  const hips=model.getObjectByName('hips'),soleGroups=[],probe=new THREE.Vector3(),relative=new THREE.Matrix4(),modelInverse=new THREE.Matrix4();
  let restFloor=Infinity,restTop=-Infinity,gaitBlendLeft=0,fadingGaitAction=null;
  if((calibratedWalking||guardClip)&&hips){
    model.updateWorldMatrix(true,true);modelInverse.copy(model.matrixWorld).invert();
    model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;relative.multiplyMatrices(modelInverse,mesh.matrixWorld);const positions=mesh.geometry.attributes.position,heights=new Float32Array(positions.count);for(let i=0;i<positions.count;i++){probe.fromBufferAttribute(positions,i).applyMatrix4(relative);heights[i]=probe.y;restFloor=Math.min(restFloor,probe.y);restTop=Math.max(restTop,probe.y);}soleGroups.push({mesh,heights,indices:[]});});
    const threshold=restFloor+(restTop-restFloor)*.012;
    for(const group of soleGroups){for(let i=0;i<group.heights.length;i++)if(group.heights[i]<=threshold)group.indices.push(i);delete group.heights;}
  }
  function preserveBlendedSoleClearance(){
    if(!hips||!soleGroups.length)return;
    model.updateWorldMatrix(true,true);modelInverse.copy(model.matrixWorld).invert();let lowest=Infinity;
    for(const group of soleGroups){group.mesh.skeleton.update();relative.multiplyMatrices(modelInverse,group.mesh.matrixWorld);for(const i of group.indices){group.mesh.getVertexPosition(i,probe).applyMatrix4(relative);lowest=Math.min(lowest,probe.y);}}
    if(lowest<restFloor){hips.position.y+=restFloor-lowest+1e-7;model.updateWorldMatrix(true,true);}
  }
  const capabilityHopEntry=createCapabilityHopEntry(model,soleGroups);
  const stylizedDashLayer=createStylizedDash(model,{scale});
  const movingThrustReturn=createMovingThrustReturn(model);
  const movingThrust=calibratedWalking?createForwardThrustLegs(model,clips,preserveAttackSoleClearance):null;
  const movement=new THREE.Vector3(),actorQ=new THREE.Quaternion(),floorOrigin=new THREE.Vector3();
  function preserveAttackSoleClearance(){
    if(!hips||!soleGroups.length)return;
    model.updateWorldMatrix(true,false);model.updateMatrixWorld(true);(model.parent||model).getWorldPosition(floorOrigin);let lowest=Infinity;
    for(const group of soleGroups){group.mesh.skeleton.update();for(const i of group.indices){group.mesh.getVertexPosition(i,probe).applyMatrix4(group.mesh.matrixWorld);lowest=Math.min(lowest,probe.y);}}
    const vertical=hips.parent.matrixWorld.elements[5];
    if(lowest<floorOrigin.y&&vertical>1e-5){hips.position.y+=(floorOrigin.y-lowest+1e-7)/vertical;model.updateMatrixWorld(true);}
  }
  const movingSwordReturn=createMovingSwordReturn(model);
  const movingSweep=calibratedWalking?createMovingSweep(model,clips,{scale,preserveSoleClearance:preserveAttackSoleClearance}):null;
  let current = '', currentAction, gaitPhase = 0, idleTime = 0, previousX, previousZ;
  function reset() { guardHandFist?.reset(); sharedSpearPose.reset();sharedSpearMotion.reset();sharedSpearFrame=null;chargeArmReturn.reset(); chargeArm.restore(); swordComboMotion.reset(); threeHitMotion.reset(); threeHeightSpearPose.reset(); capabilityHopEntry.reset(); guardTransition.reset(); stylizedDashLayer?.reset(); dynamicAttackPose.reset(); movingSwordReturn.reset(); movingSweep?.reset(); movingThrustReturn.reset(); thrustArm.restore(); movingThrust?.reset(); mixer.stopAllAction(); current = ''; currentAction = null; gaitPhase = 0; idleTime = 0; gaitBlendLeft=0; fadingGaitAction=null; previousX = previousZ = undefined; }
  function refreshAnchors() {
    model.updateWorldMatrix(true, true);
    hand.localToWorld(pointA.set(0, 0, 0));
    edge.getWorldPosition(pointB);
    // Dedicated palm socket: the slash still uses its original wrist/edge anchors.
    thrustGrip.set(-.012, .040, -.020).multiplyScalar(thrustArm.socketWeight());
    if(spearPresentationOwner==='hero')chargeGrip.copy(sharedSpearPose.gripSocket());else chargeGrip.set(-.012, .042, -.020);
    if(spearPresentationOwner==='hero'?sharedSpearPose.gripSupported():sharedSpearPose.weight()>0)thrustGrip.copy(chargeGrip);
    hand.localToWorld(thrustGrip);hand.localToWorld(chargeGrip);
  }
  // Prewarm during normalized, tilt-free model loading before recoil effects.
  // Late first baking under a tilted root is not supported by the world-space IK.
  function preparePresentation({dynamicGuard=false,dynamicJump=false}={}) {
    if ((!dynamicGuard || bracedGuardClip) && (!dynamicJump || dynamicJumpClip)) return;
    // Key the actual preparation frame. An unsupported late tilted bake must
    // never enter the neutral frame cache used by other controllers.
    const preparedKey=presentationRigKey(model);
    let cache=presentationClipCache.get(sourceIdle);if(!cache){cache=new Map();presentationClipCache.set(sourceIdle,cache);}
    let prepared=cache.get(preparedKey);if(!prepared){prepared={};cache.set(preparedKey,prepared);}
    // AnimationMixers own independent actions/times; they never mutate the clips.
    if (dynamicGuard && !bracedGuardClip) {
      bracedGuardClip=prepared.guard || createGuardStanceClip(model,sourceIdle,'braced');
      if(bracedGuardClip){bracedGuardClip.name='guard_braced';prepared.guard=bracedGuardClip;actions.set(bracedGuardClip.name,mixer.clipAction(bracedGuardClip));}
    }
    if (dynamicJump && !dynamicJumpClip) {
      dynamicJumpClip=prepared.jump || createDynamicJumpClip(model,sourceIdle);
      if(dynamicJumpClip){prepared.jump=dynamicJumpClip;actions.set(dynamicJumpClip.name,mixer.clipAction(dynamicJumpClip));}
    }
  }
  function sample({ mode, phase, cooldown, x, z, walking, dt, stationary = false, forwardThrustGait = false, guard, directionalSweepGait = false, dynamicGuard = false, dynamicJump = false, dynamicAttacks = false, stylizedDash = false, capabilityHop = false, locomotion = null, attackPresentation = null, authoritativeThrustTip = null, thrustTiming = null, chargeCamera = null }) {
    const acceptedThrustTiming=mode==='thrust'&&thrustTiming?.profile==='three-hit-thrust-v1'&&(thrustTiming.stage===2||thrustTiming.stage===3)&&Number.isInteger(thrustTiming.actorId)&&Number.isInteger(thrustTiming.actionCount)&&thrustTiming.actionCount>0&&Number.isFinite(thrustTiming.canonicalPhase)&&Math.abs(thrustTiming.elapsed-(thrustTiming.duration-phase))<1e-7?thrustTiming:null;
    // Only admitted optional stages change the clock. All existing layers keep
    // their calibrated contact poses, while legs continue on real travel/dt.
    if(acceptedThrustTiming)phase=acceptedThrustTiming.canonicalPhase;
    // The shared final upper-body spear correction retains an identical
    // paused input. Always run the existing mixer and lower-body bookkeeping.
    let pauseKey=null;
    if(spearPresentationOwner==='hero'){
      const frameRoot=model.parent||model;frameRoot.updateWorldMatrix(true,false);
      pauseKey=JSON.stringify([mode,phase,cooldown,x,z,walking,stationary,forwardThrustGait,guard,directionalSweepGait,dynamicGuard,dynamicJump,dynamicAttacks,stylizedDash,capabilityHop,locomotion,attackPresentation,authoritativeThrustTip,thrustTiming,chargeCamera?.matrixWorld?.elements||chargeCamera?.matrixWorld,chargeCamera?.projectionMatrix?.elements||chargeCamera?.projectionMatrix,frameRoot.matrixWorld.elements]);
    }
    capabilityHopEntry.prepare({enabled:capabilityHop&&dynamicJump,mode});
    capabilityHopEntry.restore();
    preparePresentation({dynamicGuard,dynamicJump});
    const guarding = !!guardClip && !!guardStanceProfile(guard, mode);
    const motionMode = guarding ? 'guard' : mode;
    sharedSpearFrame=sharedSpearMotion.sample({mode:motionMode,phase,dt,thrust:dynamicAttacks&&sharedSpearPose.available,charge:stylizedDash&&sharedSpearPose.available,alive:guard?.alive!==false,guarding});
    guardTransition.prepare(guarding, mode, dynamicGuard);
    // prepare captured the displayed pose and restored the final guard layer.
    // Unwind all earlier layers in reverse application order before the mixer.
    sharedSpearPose.restore();
    chargeArmReturn.restore();
    chargeArm.restore();
    swordComboMotion.restore();
    threeHitMotion.restore();
    stylizedDashLayer?.restore();
    dynamicAttackPose.restore();
    movingSwordReturn.restore();
    movingSweep?.restore();
    movingThrustReturn.restore();
    thrustArm.restore();
    movingThrust?.restore();
    movement.set(locomotion?locomotion.dx:previousX===undefined?0:x-previousX,0,locomotion?locomotion.dz:previousZ===undefined?0:z-previousZ);
    (model.parent||model).getWorldQuaternion(actorQ);movement.applyQuaternion(actorQ.invert());
    const travel = stationary ? 0 : locomotion ? locomotion.travel : previousX === undefined ? 0 : Math.hypot(x - previousX, z - previousZ);
    previousX = x; previousZ = z;
    const moving = travel > .00001, walkMode=!!walking&&calibratedWalking;
    const movingThrustActive=movingThrust?.admit(motionMode,phase,forwardThrustGait&&moving&&movement.z>0&&Math.abs(movement.x)<travel*.03,dt);
    if(locomotion)gaitPhase=locomotion.phase;
    else if (mode === 'ready' || mode === 'sweep' || movingThrustActive) gaitPhase=(gaitPhase+travel/((walkMode?walkStride:runStride)*scale))%1;
    idleTime += dt;
    // Calibrated walk/run share contact phase; gameplay still owns movement speed.
    let name = moving ? (walkMode ? 'walk' : 'run') : 'idle', fraction;
    if (guarding) { name = dynamicGuard && bracedGuardClip ? 'guard_braced' : 'guard'; fraction = 0; }
    else if (mode === 'thrust') { name = 'thrust'; const t=THREE.MathUtils.clamp(.4-phase,0,.4),clipTime=t<=.16?t*.5:t<=.24?.08+(t-.16):.16+(t-.24)*1.5; fraction=clipTime/.4; }
    else if (mode === 'jump') { name = dynamicJump && dynamicJumpClip ? 'jump_dynamic' : 'jump'; fraction = 1 - phase / .9; }
    else if (mode === 'sweep') { name = 'hand_slash'; fraction = 1 - phase / .46; }
    else if (mode === 'windup') { name = 'charge_windup'; fraction = 1 - phase / .075; }
    else if (mode === 'charge' || mode === 'dragon') { name = 'charge'; fraction = 1 - phase / (mode === 'dragon' ? .18 : .38); }
    else if (mode === 'charge_recover') { name = 'charge_recover'; fraction = 1 - cooldown / .2; }
    else if (!moving && cooldown > 0 && (current === 'charge' || current === 'charge_recover')) { name = 'charge_recover'; fraction = 1 - cooldown / .2; }
    const action = actions.get(name), duration = action.getClip().duration;
    if (name !== current) {
      const gaitTransition=calibratedWalking&&['walk','run'].includes(current)&&['walk','run'].includes(name);
      // An interrupted gait fade must not leave a third action in an attack/idle blend.
      if(!gaitTransition&&fadingGaitAction&&fadingGaitAction!==currentAction)fadingGaitAction.stop();
      gaitBlendLeft=gaitTransition?.12:0;fadingGaitAction=gaitTransition?currentAction:null;
      // The jump clip already has a planted anticipation pose. Mixing two knee
      // chains at entry would sink its pinned soles during the first 60 ms.
      const authoredJumpEntry = name === 'jump_dynamic' && current === 'idle';
      if (guardTransition.active || authoredJumpEntry) mixer.stopAllAction();
      action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(0).setEffectiveWeight(1).play();
      action.clampWhenFinished = true;
      if (currentAction && !guardTransition.active && !authoredJumpEntry) currentAction.crossFadeTo(action, name === 'hand_slash' ? .025 : gaitBlendLeft>0 ? .12 : .06, false);
      current = name; currentAction = action;
    }
    action.time = fraction !== undefined ? THREE.MathUtils.clamp(fraction, 0, 1) * duration
      : (name === 'walk' || name === 'run') ? gaitPhase * duration
      : idleTime % duration;
    if(fadingGaitAction&&gaitBlendLeft>0)fadingGaitAction.time=gaitPhase*fadingGaitAction.getClip().duration;
    mixer.update(dt);
    const readyHandWeight=npcReadyAction?.isScheduled()&&npcReadyAction.enabled?NPC_READY_HAND_WEIGHT*npcReadyAction.getEffectiveWeight():0;
    if(gaitBlendLeft>0){preserveBlendedSoleClearance();gaitBlendLeft=Math.max(0,gaitBlendLeft-dt);if(!gaitBlendLeft)fadingGaitAction=null;}
    const legWeight=movingThrust?.apply({mode:motionMode,phase:gaitPhase,walking:walkMode,dt})||0;
    if (!guarding && mode === 'thrust') thrustArm.apply(THREE.MathUtils.clamp(.4 - phase, 0, .4),legWeight,movingThrust?.warmStart()||0);
    movingThrustReturn.apply(motionMode,legWeight,dt);
    const sweepWeight=movingSweep?.update({mode:motionMode,phase,x,z,walking:walkMode,dt,enabled:directionalSweepGait,gaitPhase})||0;
    movingSwordReturn.apply(motionMode,phase,sweepWeight,dt,directionalSweepGait);
    dynamicAttackPose.apply({mode:motionMode,phase,enabled:dynamicAttacks,dt});
    threeHitMotion.apply({mode:motionMode,phase,presentation:attackPresentation,tip:authoritativeThrustTip,socketWeight:thrustArm.socketWeight(),timing:acceptedThrustTiming});
    swordComboMotion.apply({mode:motionMode,phase,presentation:attackPresentation});
    stylizedDashLayer?.update({mode:motionMode,phase,cooldown,x,z,dt,enabled:stylizedDash&&guard?.alive!==false});
    // The right palm supports the same pole during charge preparation/travel.
    // Reuse the clearance-tested thrust IK at its braced extension, after the
    // distance-driven legs/torso. The engine still owns the 1.7-unit charge tip.
    const holdingCharge=stylizedDash&&guard?.alive!==false&&['windup','charge'].includes(motionMode);
    if(holdingCharge)chargeArm.apply(.18);
    chargeArmReturn.apply(!stylizedDash||guard?.alive===false?'off':holdingCharge?'thrust':motionMode==='charge_recover'?'ready':motionMode,holdingCharge?1:0,dt);
    threeHeightSpearPose.prepare({mode:motionMode,elapsed:THREE.MathUtils.clamp(.4-phase,0,.4),presentation:attackPresentation,timing:acceptedThrustTiming});
    if(sharedSpearPose.apply(sharedSpearFrame,{variant:threeHeightSpearPose,elapsed:THREE.MathUtils.clamp(.4-phase,0,.4),tip:authoritativeThrustTip,dt,pauseKey,chargeCamera,readyHandWeight})>0)preserveAttackSoleClearance();
    const guardBlended=guardTransition.apply(dt,presentationOwner==='hero'&&holdingCharge);
    if (guardBlended && dt > 0 && mode !== 'jump') preserveBlendedSoleClearance();
    if(guardBlended&&holdingCharge)sharedSpearPose.finalizeGuardCharge?.(sharedSpearFrame,mode==='windup'?Math.max(0,.075-phase):.075,dt,pauseKey);
    capabilityHopEntry.apply({enabled:capabilityHop&&dynamicJump,mode,phase});
    guardHandFist?.update(guarding,dt);
    refreshAnchors();threeHeightSpearPose.finalize(thrustGrip);
    const result={sharedSpearFrame,sharedSpearWeight:sharedSpearPose.weight(), name, time: action.time, handBase: pointA, handTip: pointB, thrustGrip, chargeGrip, spearPresentationOwner,chargeDisplayTip:spearPresentationOwner==='hero'?sharedSpearPose.chargeDisplayTip():null, moving, guarding, thrustPresentationFrame:sharedSpearFrame?threeHeightSpearPose.preview():threeHitMotion.preview?.()||null };
    if(guardTransition.active)result.guardTransitionActive=true;
    if(presentationOwner==='hero'&&sharedSpearPose.guardChargeDraw())result.guardChargeDraw=sharedSpearPose.guardChargeDraw();
    if(guardTransition.swordOpacity<1)result.guardSwordOpacity=guardTransition.swordOpacity;
    return result;
  }
  return { sample, refreshAnchors, reset, mixer, actions, preparePresentation, stylizedDashLayer };
}

// Pose-only two-bone correction: keep the held pole beside the body while the
// combat engine owns its tip trajectory. Bone translations and scales stay intact.
function createThrustArmPose(model, hand, charge = false,waistBrace=false) {
  const upper = model.getObjectByName('upperarm_R');
  const forearm = model.getObjectByName('forearm_R');
  if (!upper || !forearm) throw new Error('Missing right arm bones');
  const baseUpper = new THREE.Quaternion(), baseForearm = new THREE.Quaternion(), baseHand = new THREE.Quaternion();
  const actorRotation = new THREE.Quaternion(), handRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion(), turn = new THREE.Quaternion(), solvedUpper = new THREE.Quaternion(), solvedForearm = new THREE.Quaternion();
  const origin = new THREE.Vector3(), shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), grip = new THREE.Vector3();
  const target = new THREE.Vector3(), direction = new THREE.Vector3(), bend = new THREE.Vector3(), targetElbow = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), palmOffset = new THREE.Vector3();
  let applied = false, socketBlend = 0;
  const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  function restore() {
    socketBlend = 0;
    if (!applied) return;
    upper.quaternion.copy(baseUpper); forearm.quaternion.copy(baseForearm); hand.quaternion.copy(baseHand);
    applied = false;
  }
  function aim(bone, currentDirection, desiredDirection) {
    bone.parent.getWorldQuaternion(parentRotation);
    turn.setFromUnitVectors(currentDirection.normalize(), desiredDirection.normalize());
    turn.premultiply(parentRotation.clone().invert()).multiply(parentRotation);
    bone.quaternion.premultiply(turn);
    model.updateWorldMatrix(true, true);
  }
  function apply(elapsed,legWeight=0,warmStart=0) {
    const weight = (warmStart+(1-warmStart)*smooth(elapsed / .12)) * (1 - (1-legWeight)*smooth((elapsed - .32) / .08));
    socketBlend = weight;
    if (weight <= 0) return;
    baseUpper.copy(upper.quaternion); baseForearm.copy(forearm.quaternion); baseHand.copy(hand.quaternion);
    model.updateWorldMatrix(true, true);
    // The normalization group is centered at the actor origin; its rotation
    // includes actor facing, while its asset-unit scale must not scale game units.
    const frame = model.parent || model;
    frame.getWorldQuaternion(actorRotation); frame.getWorldPosition(origin);
    hand.getWorldQuaternion(handRotation);
    upper.getWorldPosition(shoulder); forearm.getWorldPosition(elbow); hand.getWorldPosition(grip);
    const firstLength = shoulder.distanceTo(elbow), secondLength = elbow.distanceTo(grip);
    if(waistBrace)palmOffset.fromArray(HERO_SPEAR_PALM_SOCKET);else palmOffset.set(-.012, charge ? .042 : .040, -.020);hand.localToWorld(palmOffset).sub(grip);
    const extension = elapsed <= .16 ? 0 : elapsed <= .24 ? (elapsed - .16) / .08
      : elapsed <= .27 ? 1 : THREE.MathUtils.clamp(1 - (elapsed - .27) / .13, 0, 1);
    target.set(charge ? (waistBrace?-.64:-.85) : -1.05, charge ? (waistBrace?1.68:1.80) : 1.65 + .10 * extension, charge ? (waistBrace?.64:.45) : -.30 + .95 * extension).applyQuaternion(actorRotation).add(origin).sub(palmOffset);
    direction.copy(target).sub(shoulder);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(firstLength - secondLength) + .001, firstLength + secondLength - .001);
    direction.normalize(); target.copy(shoulder).addScaledVector(direction, distance);
    bend.set(waistBrace?-.08:-1, waistBrace?-1:1, 0).applyQuaternion(actorRotation).addScaledVector(direction, -bend.dot(direction)).normalize();
    const along = (firstLength * firstLength - secondLength * secondLength + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
    targetElbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height);
    aim(upper, from.copy(elbow).sub(shoulder), to.copy(targetElbow).sub(shoulder));
    forearm.getWorldPosition(elbow); hand.getWorldPosition(grip);
    aim(forearm, from.copy(grip).sub(elbow), to.copy(target).sub(elbow));
    solvedUpper.copy(upper.quaternion); solvedForearm.copy(forearm.quaternion);
    upper.quaternion.copy(baseUpper).slerp(solvedUpper, weight);
    forearm.quaternion.copy(baseForearm).slerp(solvedForearm, weight);
    model.updateWorldMatrix(true, true);
    hand.parent.getWorldQuaternion(parentRotation);
    hand.quaternion.copy(parentRotation.invert().multiply(handRotation));
    applied = true;
  }
  return { restore, apply, socketWeight: () => socketBlend };
}

// Isolated forward-thrust research candidate; not accepted for integration.
function createForwardThrustLegs(model,clips,preserveSoleClearance){
 const names=['hips',...['L','R'].flatMap(s=>['thigh_','shin_','foot_','toe_'].map(n=>n+s))];
 const bones=names.map(n=>model.getObjectByName(n)),spine=model.getObjectByName('spine');
 if(bones.some(b=>!b)||!spine)return null;
 const hips=bones[0], saved=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()})),last=saved.map(b=>({p:b.p.clone(),q:b.q.clone()}));
 const spineQ=new THREE.Quaternion(),upper=new THREE.Quaternion(),inv=new THREE.Quaternion(),q=new THREE.Quaternion(),runQ=new THREE.Quaternion(),v=new THREE.Vector3(),runV=new THREE.Vector3();
 const sets=['walk','run'].map(n=>{const c=clips.find(c=>c.name===n);return{duration:c.duration,tracks:names.map((n,i)=>({p:i===0?c.tracks.find(t=>t.name===n+'.position').createInterpolant():null,q:c.tracks.find(t=>t.name===n+'.quaternion').createInterpolant()}))}});
 let applied=false,eligible=false,wasMode='',lastPhase=1,weight=0,hasLast=false,lastGaitPhase=0,lastWalk=false,gripWarmStart=0,gaitMix=null,modifiedThrust=false,clearanceTail=0,readmitted=false;
 const snap=to=>to.forEach((t,i)=>{t.p.copy(bones[i].position);t.q.copy(bones[i].quaternion)});
 function restore(){if(!applied)return;bones.forEach((b,i)=>{b.position.copy(saved[i].p);b.quaternion.copy(saved[i].q)});spine.quaternion.copy(spineQ);applied=false;}
 function reset(){restore();eligible=false;wasMode='';lastPhase=1;weight=0;hasLast=false;gripWarmStart=0;gaitMix=null;modifiedThrust=false;clearanceTail=0;readmitted=false;}
 function admit(mode,phase,forward,dt){
  if(mode!=='thrust'){
   if(mode==='ready'&&wasMode==='thrust'&&modifiedThrust)clearanceTail=.12;
   if(mode!=='ready'){clearanceTail=0;modifiedThrust=false;}
   eligible=false;readmitted=false;wasMode=mode;lastPhase=phase;return false;
  }
  if(wasMode!=='thrust'||phase>lastPhase+.01){gripWarmStart=forward?weight:0;eligible=forward;readmitted=false;}
  else if(dt>0){if(forward&&!eligible)readmitted=true;eligible=forward;}
  wasMode=mode;lastPhase=phase;return eligible;
 }
 function apply({mode,phase,walking,dt}){
  const step=Math.max(0,dt),target=eligible?1:0,gaitTarget=walking?0:1;
  if(gaitMix===null)gaitMix=gaitTarget;else gaitMix+=THREE.MathUtils.clamp(gaitTarget-gaitMix,-step/.12,step/.12);
  // Apply only to thrust and its normal locomotion return; never to other attacks.
  if(mode!=='thrust'&&mode!=='ready'){weight=0;snap(last);hasLast=true;return 0;}
  if(eligible&&weight===0&&hasLast){const old=sets[lastWalk?0:1],tm=lastGaitPhase*old.duration;let matches=true;for(let i=0;i<bones.length;i++){q.fromArray(old.tracks[i].q.evaluate(tm));if(1-Math.abs(last[i].q.dot(q)/(last[i].q.length()*q.length()))>1e-8)matches=false;if(i===0&&last[0].p.distanceTo(v.fromArray(old.tracks[0].p.evaluate(tm)))>1e-5)matches=false;}if(matches)weight=1;}
  lastGaitPhase=phase;lastWalk=walking;
  clearanceTail=Math.max(0,clearanceTail-step);
  weight=THREE.MathUtils.clamp(weight+(target?step/.10:-step/.16),0,1);
  if(weight<=0){
   // A brief stop can end the leg layer before the attack ends. Still protect
   // the normal attack-to-locomotion crossfade, then release all pose overrides.
   if(clearanceTail>0){snap(saved);spineQ.copy(spine.quaternion);preserveSoleClearance();applied=true;}
   else if(mode==='ready')modifiedThrust=false;
   snap(last);hasLast=true;return 0;
  }
  if(mode==='thrust')modifiedThrust=true;
  snap(saved);spineQ.copy(spine.quaternion);upper.copy(hips.quaternion).multiply(spineQ);
  if(step===0&&hasLast){bones.forEach((b,i)=>{b.position.copy(last[i].p);b.quaternion.copy(last[i].q)});spine.quaternion.copy(inv.copy(hips.quaternion).invert().multiply(upper));applied=true;return weight;}
  const walk=sets[0],run=sets[1],walkTime=phase*walk.duration,runTime=phase*run.duration;
  for(let i=0;i<bones.length;i++){
   const b=bones[i],wt=walk.tracks[i],rt=run.tracks[i];q.fromArray(wt.q.evaluate(walkTime)).slerp(runQ.fromArray(rt.q.evaluate(runTime)),gaitMix);
   // Blend complete poses continuously. A per-frame angular limiter here
   // would lag the returning gait, then snap when the layer weight reaches zero.
   b.quaternion.copy(saved[i].q).slerp(q,weight);
   if(i===0){v.fromArray(wt.p.evaluate(walkTime)).lerp(runV.fromArray(rt.p.evaluate(runTime)),gaitMix);b.position.copy(saved[i].p).lerp(v,weight);}
  }
  model.getWorldQuaternion(q);const leaned=Math.abs(q.x)+Math.abs(q.z)>1e-6;
  // Newly admitted cycles can reach full weight at an uncalibrated attack phase.
  if(readmitted||weight<1||leaned||(gaitMix>0&&gaitMix<1))preserveSoleClearance();
  spine.quaternion.copy(inv.copy(hips.quaternion).invert().multiply(upper));
  snap(last);hasLast=true;applied=true;return weight;
 }
 return{restore,reset,admit,apply,warmStart:()=>gripWarmStart};
}

function createMovingThrustReturn(model){
 const bones=['upperarm_R','forearm_R','hand_R'].map(n=>model.getObjectByName(n)),saved=bones.map(b=>b.quaternion.clone()),from=bones.map(b=>b.quaternion.clone());
 let applied=false,tail=0,wasMoving=false;
 function restore(){if(!applied)return;bones.forEach((b,i)=>b.quaternion.copy(saved[i]));applied=false;}
 function reset(){restore();tail=0;wasMoving=false;}
 function apply(mode,weight,dt){
  if(mode==='thrust'){wasMoving=weight>0;tail=0;if(wasMoving)bones.forEach((b,i)=>from[i].copy(b.quaternion));return;}
  if(mode!=='ready'){wasMoving=false;tail=0;return;}
  if(wasMoving){tail=.14;wasMoving=false;}
  if(tail<=0)return;
  tail=Math.max(0,tail-Math.max(0,dt));const t=1-tail/.14,s=t*t*(3-2*t);
  bones.forEach((b,i)=>{saved[i].copy(b.quaternion);b.quaternion.copy(from[i]).slerp(saved[i],s);});applied=true;
 }
 return{restore,reset,apply};
}
