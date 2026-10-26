import * as THREE from './vendor/three.module.min.js';

// Presentation-only, fixed-length pose bake. The engine still owns the root arc,
// crossing clearance and landing impact. Hero .14/.76 takeoff/grounding and the
// NPC phase adapter both use this unchanged .9-second clip clock.
export function createDynamicJumpClip(model, idleClip) {
  const names = ['hips', 'chest', 'head', ...['R', 'L'].flatMap(side =>
    ['upperarm_', 'forearm_', 'hand_', 'hand_edge_', 'thigh_', 'shin_', 'foot_'].map(n => n + side))];
  const bones = Object.fromEntries(names.map(name => [name, model.getObjectByName(name)]));
  if (!idleClip || names.some(name => !bones[name])) return null;
  const original = [];
  model.traverse(node => { if (node.isBone) original.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }); });
  const mixer = new THREE.AnimationMixer(model);
  try {
    mixer.clipAction(idleClip).play(); mixer.update(0); model.updateWorldMatrix(true, true);
    const idle = original.map(({ node }) => ({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
    const bounds = new THREE.Box3().setFromObject(model), height = bounds.max.y - bounds.min.y;
    const frame = model.parent || model, rotation = frame.getWorldQuaternion(new THREE.Quaternion());
    const origin = frame.getWorldPosition(new THREE.Vector3()), worldScale = model.getWorldScale(new THREE.Vector3()).y;
    const point = xyz => new THREE.Vector3(...xyz).multiplyScalar(height).applyQuaternion(rotation).add(origin);
    const vector = xyz => new THREE.Vector3(...xyz).applyQuaternion(rotation);
    const position = bone => bone.getWorldPosition(new THREE.Vector3());
    const feet = Object.fromEntries(['R', 'L'].map(side => [side, { p: position(bones['foot_' + side]), q: bones['foot_' + side].getWorldQuaternion(new THREE.Quaternion()) }]));
    const idlePoles = Object.fromEntries(['R','L'].map(side => [side, {
      leg: position(bones['shin_'+side]).sub(position(bones['thigh_'+side])),
      arm: position(bones['forearm_'+side]).sub(position(bones['upperarm_'+side])),
    }]));
    const idleHands = Object.fromEntries(['R', 'L'].map(side => [side, position(bones['hand_' + side]).sub(origin).applyQuaternion(rotation.clone().invert()).divideScalar(height).toArray()]));
    // time, hip compression, backward shift, chest pitch, foot up, foot forward,
    // hand width, hand height, hand forward. Ground phases always pin both soles.
    const keys = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [.080, .090, .022, .31, 0, 0, .145, .325, .175],
      [.140, .012, 0, -.06, 0, 0, .140, .430, .220],
      [.260, .008, 0, .08, .150, .095, .070, .500, .155],
      [.450, .014, 0, .16, .185, .075, .070, .505, .160],
      [.630, .012, 0, .16, .095, .035, .075, .500, .180],
      [.760, .030, .004, .24, 0, 0, .145, .350, .225],
      [.805, .110, .023, .38, 0, 0, .145, .245, .240],
      [.900, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const times = [], tracks = idle.map(({node}) => ({ node, q: [], p: [] }));
    function aim(bone, from, to) {
      const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const turn = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent)); model.updateWorldMatrix(true, true);
    }
    function solve(upper, lower, tip, target, pole) {
      const start = position(upper), middle = position(lower), end = position(tip);
      const a = start.distanceTo(middle), b = middle.distanceTo(end), direction = target.clone().sub(start);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + .00001, a + b - .00001);
      direction.normalize(); target = start.clone().addScaledVector(direction, distance);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (a * a - b * b + distance * distance) / (2 * distance), bend = Math.sqrt(Math.max(0, a * a - along * along));
      const targetMiddle = start.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
      aim(upper, middle.clone().sub(start), targetMiddle.sub(start));
      aim(lower, position(tip).sub(position(lower)), target.sub(position(lower)));
    }
    // Dense fixed-time bake keeps grounded feet pinned through interpolation.
    // No per-frame IK and no bone length/scale changes are needed in the sampler.
    for (let f = 0; f <= 216; f++) {
      const t = f / 240; times.push(t);
      for (const {node,p,q,s} of idle) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); }
      let j = 1; while (j < keys.length - 1 && t > keys[j][0]) j++;
      const a = keys[j - 1], b = keys[j], u = THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1), w = u * u * (3 - 2 * u);
      const k = a.map((v,i) => v + (b[i] - v) * w), edgeWeight = t < .080 ? w : t > .805 ? 1 - w : 1;
      bones.hips.position.y -= height * k[1] / worldScale;
      bones.hips.position.z -= height * k[2] / worldScale;
      bones.chest.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),k[3]));
      bones.head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-k[3]*.55));
      model.updateWorldMatrix(true, true);
      for (const side of ['R','L']) {
        const right = side === 'R', foot = bones['foot_'+side], ft = feet[side];
        // Tuck leg asymmetry reads as a leap from the high rear game camera.
        const target = ft.p.clone().add(vector([right ? -.014*k[4] : .014*k[4], k[4]*(right?1:.66), k[5]*(right?1:-.65)]).multiplyScalar(height));
        solve(bones['thigh_'+side],bones['shin_'+side],foot,target,idlePoles[side].leg.clone().normalize().lerp(vector([right?-.22:.22,0,1]),edgeWeight));
        foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(ft.q)); model.updateWorldMatrix(true,true);
        const hand = bones['hand_'+side], edge = bones['hand_edge_'+side], start = idleHands[side];
        // Knight-specific compact hammer-like gathering, never a wide V.
        // The hands drive down with the torso as the legs absorb landing.
        const smooth=v=>{const x=THREE.MathUtils.clamp(v,0,1);return x*x*(3-2*x);};
        const gather=smooth((t-.14)/.12)*(1-smooth((t-.76)/.14));
        const desired=[right?-k[6]:k[6]*1.22,k[7]-(right?0:.035-.023*gather),k[8]+(right?0:-.070+.082*gather)];
        const handTarget = start.map((v,i)=>v+(desired[i]-v)*edgeWeight);
        solve(bones['upperarm_'+side],bones['forearm_'+side],hand,point(handTarget),idlePoles[side].arm.clone().normalize().lerp(vector([right?-.8:.8,-1.35,-.25]),edgeWeight));
        const handBefore = hand.quaternion.clone(), drive = THREE.MathUtils.clamp((t-.63)/.13,0,1);
        aim(hand,position(edge).sub(position(hand)),vector([right?0:-.12,-.22-.55*drive,1]));
        hand.quaternion.slerpQuaternions(handBefore,hand.quaternion.clone(),edgeWeight);
      }
      // Match the original idle exactly at the clip seams, including palm twist.
      if (f === 0 || f === 216) for (const {node,p,q} of idle) {node.position.copy(p);node.quaternion.copy(q);}
      for (const track of tracks) {track.q.push(...track.node.quaternion.toArray());track.p.push(...track.node.position.toArray());}
    }
    const output = [];
    for (const track of tracks) {
      output.push(new THREE.QuaternionKeyframeTrack(track.node.name+'.quaternion',times,track.q));
      // Non-root local translations are unmodified constants; preserve all tracks
      // so an interrupted attack cannot leak its previous authored pose.
      output.push(new THREE.VectorKeyframeTrack(track.node.name+'.position',times,track.p));
      output.push(new THREE.VectorKeyframeTrack(track.node.name+'.scale',[0,.9],[...track.node.scale.toArray(),...track.node.scale.toArray()]));
    }
    const clip = new THREE.AnimationClip('jump_dynamic',.9,output);
    clip.userData = {presentationOnly:true, takeoff:.14, grounded:.76, heroImpact:.8};
    return clip;
  } finally {
    mixer.stopAllAction();mixer.uncacheRoot(model);
    for (const {node,p,q,s} of original) {node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);}
    model.updateWorldMatrix(true,true);
  }
}
