import * as THREE from './vendor/three.module.min.js';

// Presentation profiles are independent of action eligibility and combat rules.
// A future ability definition may select a profile without changing the sampler.
export const GUARD_STANCE_PROFILES = Object.freeze({
  braced: Object.freeze({
    hipsDrop: .110, hipsBack: .030, chestPitch: .27, headPitch: -.14,
    rightHand: [.025, .435, .140], leftHand: [-.025, .445, .230],
    wristFollowForearm: true, protractShoulders: true,
    rightElbow: [-1.2, -1, 0], leftElbow: [1, -1, 0],
  }),
  raised: Object.freeze({
    hipsDrop: .034, hipsBack: .006, chestPitch: .09, headPitch: -.035,
    rightHand: [-.107, .585, .165], leftHand: [.110, .570, .168],
    rightElbow: [-1, -.85, .10], leftElbow: [1, -.85, .10],
  }),
});
const profileByPiece = Object.freeze(Object.fromEntries([
  'king', 'gold', 'silver', 'rook', 'bishop', 'tokin', 'promoted_lance',
  'promoted_knight', 'promoted_silver', 'dragon', 'horse',
].map(piece => [piece, 'raised'])));
export function guardStanceProfile(guard, mode) {
  if (!guard?.active || mode !== 'ready' || guard.alive === false || guard.grounded === false) return null;
  const name = profileByPiece[guard.piece];
  return name && GUARD_STANCE_PROFILES[guard.profile || name] ? (guard.profile || name) : null;
}

// Bake once from the existing rig/idle. No extra model or animation download.
// Only rotations and the hips root offset are changed; limb lengths/scales stay fixed.
export function createGuardStanceClip(model, idleClip, profileName = 'raised') {
  const profile = GUARD_STANCE_PROFILES[profileName];
  const names = ['hips', 'chest', 'head', ...['R', 'L'].flatMap(side =>
    ['clavicle_', 'upperarm_', 'forearm_', 'hand_', 'hand_edge_', 'thigh_', 'shin_', 'foot_'].map(n => n + side))];
  const bones = Object.fromEntries(names.map(name => [name, model.getObjectByName(name)]));
  if (!profile || !idleClip || names.some(name => !bones[name])) return null;
  const original = [];
  model.traverse(node => { if (node.isBone) original.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }); });
  const mixer = new THREE.AnimationMixer(model);
  try {
    const action = mixer.clipAction(idleClip); action.play(); mixer.update(0);
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model), height = bounds.max.y - bounds.min.y;
    const frame = model.parent || model, rotation = frame.getWorldQuaternion(new THREE.Quaternion());
    const origin = frame.getWorldPosition(new THREE.Vector3());
    const worldScale = model.getWorldScale(new THREE.Vector3()).y;
    const point = (xyz) => new THREE.Vector3(...xyz).multiplyScalar(height).applyQuaternion(rotation).add(origin);
    const vector = (xyz) => new THREE.Vector3(...xyz).applyQuaternion(rotation);
    const position = bone => bone.getWorldPosition(new THREE.Vector3());
    const footTargets = Object.fromEntries(['R', 'L'].map(side => [side, {
      p: position(bones['foot_' + side]), q: bones['foot_' + side].getWorldQuaternion(new THREE.Quaternion()),
    }]));
    bones.hips.position.y -= height * profile.hipsDrop / worldScale;
    bones.hips.position.z -= height * profile.hipsBack / worldScale;
    bones.chest.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), profile.chestPitch));
    bones.head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), profile.headPitch));
    model.updateWorldMatrix(true, true);
    function aim(bone, from, to) {
      const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const turn = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
      model.updateWorldMatrix(true, true);
    }
    function solve(upper, lower, tip, target, pole) {
      const shoulder = position(upper), elbow = position(lower), grip = position(tip);
      const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(grip), direction = target.clone().sub(shoulder);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + .0001, a + b - .0001);
      direction.normalize(); target = shoulder.clone().addScaledVector(direction, distance);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (a * a - b * b + distance * distance) / (2 * distance);
      const bend = Math.sqrt(Math.max(0, a * a - along * along));
      const targetElbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
      aim(upper, elbow.clone().sub(shoulder), targetElbow.sub(shoulder));
      aim(lower, position(tip).sub(position(lower)), target.sub(position(lower)));
    }
    for (const side of ['R', 'L']) {
      const foot = bones['foot_' + side], target = footTargets[side];
      solve(bones['thigh_' + side], bones['shin_' + side], foot, target.p, vector([side === 'R' ? -.14 : .14, 0, 1]));
      foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(target.q));
      model.updateWorldMatrix(true, true);
      if (profile.protractShoulders) aim(bones['clavicle_' + side],
        position(bones['upperarm_' + side]).sub(position(bones['clavicle_' + side])), vector([side === 'R' ? -.45 : .45, -.12, 1]));
      const right = side === 'R', hand = bones['hand_' + side], edge = bones['hand_edge_' + side];
      solve(bones['upperarm_' + side], bones['forearm_' + side], hand,
        point(right ? profile.rightHand : profile.leftHand), vector(right ? profile.rightElbow : profile.leftElbow));
      aim(hand, position(edge).sub(position(hand)), profile.wristFollowForearm
        ? position(hand).sub(position(bones['forearm_' + side]))
        : vector((right ? profile.rightPalm : profile.leftPalm) || [0, 1, .55]));
    }
    const tracks = [];
    for (const { node } of original) {
      tracks.push(new THREE.QuaternionKeyframeTrack(node.name + '.quaternion', [0, 1], [...node.quaternion.toArray(), ...node.quaternion.toArray()]));
      tracks.push(new THREE.VectorKeyframeTrack(node.name + '.position', [0, 1], [...node.position.toArray(), ...node.position.toArray()]));
      tracks.push(new THREE.VectorKeyframeTrack(node.name + '.scale', [0, 1], [...node.scale.toArray(), ...node.scale.toArray()]));
    }
    const clip = new THREE.AnimationClip('guard', 1, tracks);
    clip.userData = { presentationOnly: true, profile: profileName };
    return clip;
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    for (const { node, p, q, s } of original) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); }
    model.updateWorldMatrix(true, true);
  }
}

// Guard edges blend from the last displayed skeleton, including an interrupted
// attack or earlier guard edge. Repeated taps cannot restart a 1 -> 0 mixer fade.
export function createGuardStanceTransition(model) {
  const poses = [];
  model.traverse(node => { if (node.isBone) poses.push({ node,
    fromP: node.position.clone(), fromQ: node.quaternion.clone(),
    baseP: node.position.clone(), baseQ: node.quaternion.clone(), baseS: node.scale.clone(),
    displayP: node.position.clone(), displayQ: node.quaternion.clone(), displayS: node.scale.clone() }); });
  const feet = ['R','L'].map(side => ({
    side, upper: model.getObjectByName('thigh_'+side), lower: model.getObjectByName('shin_'+side), tip: model.getObjectByName('foot_'+side),
    fromP: new THREE.Vector3(), fromQ: new THREE.Quaternion(), toP: new THREE.Vector3(), toQ: new THREE.Quaternion(),
  }));
  const armFrame = model.parent || model;
  const arms = ['R', 'L'].map(side => ({side, upper:model.getObjectByName('upperarm_'+side), lower:model.getObjectByName('forearm_'+side), tip:model.getObjectByName('hand_'+side), edge:model.getObjectByName('hand_edge_'+side), fromP:new THREE.Vector3(), fromElbow:new THREE.Vector3(), toP:new THREE.Vector3(), toElbow:new THREE.Vector3()}));
  let armTransition = false, armEntering = false;
  const stepUpper = new Set();
  model.getObjectByName('spine')?.traverse(node => { if (node.isBone) stepUpper.add(node); });
  let stepTakeover = false, stepZeroPending = false;
  let departingGuard = false, departureTime = .11;
  let sampled = false, wasGuard = false, wasMode = '', remaining = 0, applied = false, wasPinned = false, pinTransition = false;
  const at = bone => bone.getWorldPosition(new THREE.Vector3());
  function aim(bone, from, to) {
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
    bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent)); model.updateWorldMatrix(true,true);
  }
  function pinFeet(weight) {
    // Interpolate endpoints, then solve fixed-length legs. Interpolating only
    // local knee angles sinks/slides the soles during a deep planted crouch.
    model.updateWorldMatrix(true,true);
    for (const f of feet) {
      const start=at(f.upper),middle=at(f.lower),end=at(f.tip),target=f.fromP.clone().lerp(f.toP,weight),direction=target.clone().sub(start);
      const a=start.distanceTo(middle),b=middle.distanceTo(end),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(a-b)+.00001,a+b-.00001);
      direction.normalize();target.copy(start).addScaledVector(direction,distance);
      const pole=middle.clone().sub(start);pole.addScaledVector(direction,-pole.dot(direction)).normalize();
      const along=(a*a-b*b+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,a*a-along*along));
      const knee=start.clone().addScaledVector(direction,along).addScaledVector(pole,bend);
      aim(f.upper,middle.clone().sub(start),knee.sub(start));aim(f.lower,at(f.tip).sub(at(f.lower)),target.sub(at(f.lower)));
      const worldQ=f.fromQ.clone().slerp(f.toQ,weight);f.tip.quaternion.copy(f.tip.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ));model.updateWorldMatrix(true,true);
    }
  }
  function restore() {
    if (!applied) return;
    for (const p of poses) { p.node.position.copy(p.baseP); p.node.quaternion.copy(p.baseQ); p.node.scale.copy(p.baseS); }
    applied = false;
  }
  function prepare(guarding, mode, pin = false) {
    for (const p of poses) { p.displayP.copy(p.node.position); p.displayQ.copy(p.node.quaternion); p.displayS.copy(p.node.scale); }
    if (sampled && (guarding !== wasGuard || guarding && pin !== wasPinned || remaining > 0 && mode !== wasMode)) {
      for (const p of poses) { p.fromP.copy(p.node.position); p.fromQ.copy(p.node.quaternion); }
      armTransition = (guarding && pin || wasGuard && wasPinned || armTransition && remaining > 0) && arms.every(a=>a.upper&&a.lower&&a.tip&&a.edge);
      armEntering = guarding;
      if(armTransition){model.updateWorldMatrix(true,true);for(const a of arms){a.fromP.copy(armFrame.worldToLocal(at(a.tip)));a.fromElbow.copy(armFrame.worldToLocal(at(a.lower)));}}
      departingGuard = !guarding && (wasGuard || departingGuard && remaining > 0);
      if (departingGuard) departureTime = 0;
      remaining = .08;
      pinTransition = mode !== 'jump' && (guarding && pin || wasPinned) && feet.every(f=>f.upper&&f.lower&&f.tip);
      if (pinTransition) {model.updateWorldMatrix(true,true);for(const f of feet){f.fromP.copy(at(f.tip));f.tip.getWorldQuaternion(f.fromQ);}}
    }
    // The step's slash wave is active at admission, without a windup. Its
    // source upper body must own the visible blade immediately; retaining the
    // crossed guard wrist would point the sword through the face. Legs retain
    // exactly the existing planted guard transition.
    stepTakeover = mode === 'dragon' && departingGuard;
    restore(); sampled = true; wasGuard = guarding; wasMode = mode; wasPinned = guarding && pin;
  }
  function apply(dt, chargeAdmission = false) {
    if ((stepTakeover || chargeAdmission) && dt <= 0 && departureTime === 0) stepZeroPending = true;
    if (stepZeroPending && dt > 0) {
      // Admission can be drawn before simulation advances. Rebuild only the
      // planted start anchors in the first moving actor frame, exactly as the
      // ordinary guard release did on its first positive sample.
      for (const p of poses) {
        p.baseP.copy(p.node.position); p.baseQ.copy(p.node.quaternion); p.baseS.copy(p.node.scale);
        p.node.position.copy(p.fromP); p.node.quaternion.copy(p.fromQ); p.node.scale.copy(p.displayS);
      }
      model.updateWorldMatrix(true, true);
      if (pinTransition) for (const f of feet) { f.fromP.copy(at(f.tip)); f.tip.getWorldQuaternion(f.fromQ); }
      for (const p of poses) { p.node.position.copy(p.baseP); p.node.quaternion.copy(p.baseQ); p.node.scale.copy(p.baseS); }
      model.updateWorldMatrix(true, true);
      stepZeroPending = false;
    }
    if (departingGuard) departureTime = Math.min(.11, departureTime + Math.max(0, dt));
    if (remaining <= 0) return false;
    remaining = Math.max(0, remaining - Math.max(0, dt));
    const t = 1 - remaining / .08, weight = t * t * (3 - 2 * t);
    if (pinTransition && dt > 0) {model.updateWorldMatrix(true,true);for(const f of feet){f.toP.copy(at(f.tip));f.tip.getWorldQuaternion(f.toQ);}}
    if(armTransition&&dt>0){model.updateWorldMatrix(true,true);for(const a of arms){a.toP.copy(armFrame.worldToLocal(at(a.tip)));a.toElbow.copy(armFrame.worldToLocal(at(a.lower)));}}
    for (const p of poses) {
      p.baseP.copy(p.node.position); p.baseQ.copy(p.node.quaternion); p.baseS.copy(p.node.scale);
      const upperOwned = stepTakeover && stepUpper.has(p.node);
      if (dt <= 0) {
        p.node.position.copy(p.displayP); if (!upperOwned) p.node.quaternion.copy(p.displayQ); p.node.scale.copy(p.displayS);
      } else {
        p.node.position.lerpVectors(p.fromP, p.baseP, weight);
        if (!upperOwned) p.node.quaternion.slerpQuaternions(p.fromQ, p.baseQ, weight);
      }
    }
    if (pinTransition && dt > 0) pinFeet(weight);
    if (armTransition && !stepTakeover && dt > 0 && t < 1) {
      // Guard-specific arm path: advance before crossing, uncross before
      // retracting. Fixed-length IK changes rotations only; feet keep ownership.
      const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
      const early=smooth(t/.55),late=smooth((t-.35)/.65);
      const arcWeight=armEntering?smooth((t-.50)/.15)*(1-smooth((t-.80)/.15)):smooth((t-.08)/.10)*(1-smooth((t-.42)/.18));
      model.updateWorldMatrix(true,true);
      for(const a of arms){
        const uncorrected=[a.upper,a.lower,a.tip].map(b=>b.quaternion.clone());
        const targetLocal=a.fromP.clone().lerp(a.toP,weight);
        targetLocal.x=THREE.MathUtils.lerp(a.fromP.x,a.toP.x,armEntering?late:early);
        targetLocal.z=THREE.MathUtils.lerp(a.fromP.z,a.toP.z,armEntering?early:late);
        if(armEntering)targetLocal.z+=(a.side==='L'?.018:-.012)*Math.sin(Math.PI*t)**2;
        const start=at(a.upper),middle=at(a.lower),end=at(a.tip),target=armFrame.localToWorld(targetLocal),direction=target.clone().sub(start);
        const first=start.distanceTo(middle),second=middle.distanceTo(end),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(first-second)+.0001,first+second-.0001);
        direction.normalize();target.copy(start).addScaledVector(direction,distance);
        const pole=armFrame.localToWorld(a.fromElbow.clone().lerp(a.toElbow,weight)).sub(start);pole.addScaledVector(direction,-pole.dot(direction)).normalize();
        const along=(first*first-second*second+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,first*first-along*along));
        const elbow=start.clone().addScaledVector(direction,along).addScaledVector(pole,height);
        const handRotation=a.tip.getWorldQuaternion(new THREE.Quaternion());
        aim(a.upper,middle.clone().sub(start),elbow.sub(start));aim(a.lower,at(a.tip).sub(at(a.lower)),target.sub(at(a.lower)));
        a.tip.quaternion.copy(a.tip.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handRotation));model.updateWorldMatrix(true,true);
        const before=a.tip.quaternion.clone();aim(a.tip,at(a.edge).sub(at(a.tip)),at(a.tip).sub(at(a.lower)));a.tip.quaternion.slerp(before,1-Math.sin(Math.PI*t));
        [a.upper,a.lower,a.tip].forEach((b,i)=>b.quaternion.slerp(uncorrected[i],1-arcWeight));model.updateWorldMatrix(true,true);
      }
    }
    if (stepTakeover && departureTime < .04) {
      // The retained guard crouch sits below the source step's hip height.
      // Lift the wrist a few degrees until that crouch releases, so the fully
      // visible source blade does not graze the ground on the admission frame.
      const arm = arms[0], direction = at(arm.edge).sub(at(arm.tip)).normalize();
      const lifted = direction.clone();
      lifted.y += .16 * (1 - THREE.MathUtils.smoothstep(departureTime, 0, .04));
      aim(arm.tip, direction, lifted);
    }
    applied = true;
    return true;
  }
  function reset() { restore(); sampled = false; wasGuard = false; wasMode = ''; remaining = 0; wasPinned = false; pinTransition = false; armTransition = false; armEntering = false; departingGuard = false; departureTime = .11; stepTakeover = false; stepZeroPending = false; }
  return { prepare, apply, reset, get active() { return remaining > 0; },
    // Summon the slash blade only once the crossed hands have separated.
    // This 30 ms fade finishes inside the existing 125 ms windup.
    get swordOpacity() { return departingGuard ? THREE.MathUtils.smoothstep(departureTime, .08, .11) : 1; } };
}
