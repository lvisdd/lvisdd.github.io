import * as THREE from './vendor/three.module.min.js';

// The authored hero hand has no finger joints. This relative corrective curls
// only distal, fully hand-weighted vertices. It owns one appended morph index;
// existing spear corrections, geometry, normals and influence slots stay intact.
const prepared = new WeakMap();
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
export function createGuardHandFist(model) {
  const bindings = [];
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const g = mesh.geometry;
    let info = prepared.get(g), index = info?.index;
    if (index === undefined) {
      const existing = g.morphAttributes.position || [];
      // Do not reinterpret absolute targets or incomplete external morph sets.
      if (existing.length && (!g.morphTargetsRelative || (g.morphAttributes.normal || []).length !== existing.length)) { prepared.set(g, {index: -1, occupiedIndices: []}); return; }
      const delta = new Float32Array(g.attributes.position.count * 3), changed = new Set(), counts = {};
      for (const side of ['R', 'L']) {
        const hand = mesh.skeleton.bones.findIndex(b => b.name === 'hand_' + side);
        if (hand < 0) continue;
        const mirror = side === 'R' ? 1 : -1;
        const inverse = mesh.skeleton.boneInverses[hand];
        const toMesh = new THREE.Matrix4().copy(inverse).invert().premultiply(new THREE.Matrix4().copy(mesh.bindMatrix).invert());
        const shaft = new THREE.Vector3(-.7876330410012757, .26312736375622847, .5571339531440799).normalize();
        const finger = new THREE.Vector3(0, 1, 0).addScaledVector(shaft, -shaft.y).normalize();
        const normal = new THREE.Vector3().crossVectors(finger, shaft).normalize(), socket = new THREE.Vector3(-.012, .042, -.020);
        const p = new THREE.Vector3(), q = new THREE.Vector3(), relative = new THREE.Vector3();
        counts[side] = 0;
        for (let i = 0; i < g.attributes.position.count; i++) {
          let weight = 0;
          for (let j = 0; j < 4; j++) if (g.attributes.skinIndex.array[i * 4 + j] === hand) weight += g.attributes.skinWeight.array[i * 4 + j];
          if (weight < .95) continue;
          p.fromBufferAttribute(g.attributes.position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse);p.x *= mirror;
          relative.copy(p).sub(socket);
          const across = relative.dot(shaft), along = relative.dot(finger), height = relative.dot(normal);
          let w = across, u = along, h = height;
          if (along > 0) {
            const radius = .012 - .006 * smooth((-across - .014) / .030), angle = Math.min(4.6, along / radius), center = -.042;
            u = (height - center) * Math.sin(angle);h = center + (height - center) * Math.cos(angle);
          }
          const thumb = smooth((across - .010) / .025) * (1 - smooth((along + .003) / .027)) * smooth((along + .043) / .013);
          w *= 1 - .32 * smooth(along / .025);
          w -= .055 * thumb;u += .025 * thumb;h -= .014 * thumb;
          q.copy(socket).addScaledVector(shaft, w).addScaledVector(finger, u).addScaledVector(normal, h);
          if (q.distanceToSquared(p) < 1e-14) continue;
          p.x *= mirror;q.x *= mirror;
          p.applyMatrix4(toMesh);q.applyMatrix4(toMesh).sub(p);q.toArray(delta, i * 3);changed.add(i);counts[side]++;
        }
      }
      if (!changed.size) { prepared.set(g, {index: -1, occupiedIndices: []}); return; }
      const corrected = g.clone(), a = corrected.attributes.position;
      for (const i of changed) a.setXYZ(i, a.getX(i) + delta[i * 3], a.getY(i) + delta[i * 3 + 1], a.getZ(i) + delta[i * 3 + 2]);
      corrected.computeVertexNormals();
      const normalVertices = new Set(changed), indices = g.index?.array, total = indices ? indices.length : a.count;
      for (let t = 0; t < total; t += 3) {
        const triangle = indices ? [indices[t], indices[t + 1], indices[t + 2]] : [t, t + 1, t + 2];
        if (triangle.some(i => changed.has(i))) for (const i of triangle) normalVertices.add(i);
      }
      const normals = new Float32Array(delta.length);
      for (const i of normalVertices) for (let j = 0; j < 3; j++) normals[i * 3 + j] = corrected.attributes.normal.array[i * 3 + j] - g.attributes.normal.array[i * 3 + j];
      corrected.dispose();
      index = existing.length;
      const positionTarget = new THREE.BufferAttribute(delta, 3), normalTarget = new THREE.BufferAttribute(normals, 3);
      positionTarget.name = normalTarget.name = 'guard-closed-fists';
      g.morphTargetsRelative = true;
      g.morphAttributes.position = [...existing, positionTarget];
      g.morphAttributes.normal = [...(g.morphAttributes.normal || []), normalTarget];
      g.userData.guardHandFist = { kind: 'hero-guard-closed-fists-v1', index, vertices: changed.size, normalVertices: normalVertices.size, hands: counts };
      const right = mesh.skeleton.bones.findIndex(b => b.name === 'hand_R');
      const occupiedIndices = existing.flatMap((target, slot) => {
        for (const i of changed) {
          let rightWeight = 0;
          for (let k = 0; k < 4; k++) if (g.attributes.skinIndex.array[i * 4 + k] === right) rightWeight += g.attributes.skinWeight.array[i * 4 + k];
          if (rightWeight >= .95 && (Math.abs(target.getX(i)) + Math.abs(target.getY(i)) + Math.abs(target.getZ(i))) > 1e-12) return [slot];
        }
        return [];
      });
      info = {index, occupiedIndices};
      prepared.set(g, info);
    }
    if (index < 0) return;
    const influences = mesh.morphTargetInfluences?.slice() || [];
    mesh.updateMorphTargets();
    influences.forEach((weight, i) => { mesh.morphTargetInfluences[i] = weight; });
    bindings.push({ mesh, index, occupiedIndices: info.occupiedIndices });
  });
  let active = false, from = 0, elapsed = .08, weight = 0;
  const set = (value, occupiedWeight = 0) => {
    for (const b of bindings) {
      const occupied = b.occupiedIndices.reduce((sum, slot) => sum + Math.max(0, b.mesh.morphTargetInfluences[slot] || 0), 0);
      b.mesh.morphTargetInfluences[b.index] = Math.min(value, 1 - THREE.MathUtils.clamp(Math.max(occupiedWeight, occupied), 0, 1));
    }
  };
  function update(guarding, dt, occupiedWeight = 0) {
    if (active !== guarding) { from = weight;elapsed = 0;active = guarding; }
    elapsed = Math.min(.08, elapsed + Math.max(0, dt));
    // Close before the forearms cross; keep the existing 80 ms release.
    const progress = active ? elapsed / .05 : elapsed / .08;
    weight = THREE.MathUtils.lerp(from, active ? 1 : 0, smooth(progress));
    // Convex composition with an independently owned spear-hand corrective.
    set(weight, occupiedWeight);
  }
  function reset() { active = false;from = weight = 0;elapsed = .08;set(0); }
  return { update, reset, bindings, weight: () => bindings[0]?.mesh.morphTargetInfluences[bindings[0].index] || 0 };
}
