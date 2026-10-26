/** Decorative, dependency-injected THREE assets. No animation, hitboxes, or scene mutation. */
export const HERO_HELD_SPEAR_LENGTH=2.4;
export function createWeaponAccents(THREE,{presentationOwner='npc'}={}) {
  // Immutable ownership profile. One physical length throughout every action.
  const heldHalfLength=(presentationOwner==='hero'?HERO_HELD_SPEAR_LENGTH:3.6)/2;
  const defaults = '#45dfff';
  const swordDirection = new THREE.Vector3(), swordWidth = new THREE.Vector3();
  const swordNormal = new THREE.Vector3(), swordBasis = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0);
  // The blade's authored XY face follows the horizontal cut. A shortest-arc
  // world-X quaternion fixes only its long axis and rolls differently per yaw.
  // Use the real hand axis and world up, never the camera. Numerically vertical
  // axes use the actor's side as a deterministic, yaw-equivariant fallback.
  function placeSword(sword, handBase, handTip, dx = 0, dz = 1) {
    const facingLength = Math.hypot(dx, dz);
    if (facingLength > 1e-8) { dx /= facingLength; dz /= facingLength; }
    else { dx = 0; dz = 1; }
    swordDirection.copy(handTip).sub(handBase);
    if (swordDirection.lengthSq() < 1e-12) swordDirection.set(dx, 0, dz);
    else swordDirection.normalize();
    swordWidth.crossVectors(worldUp, swordDirection);
    if (swordWidth.lengthSq() < 1e-8) swordWidth.set(dz, 0, -dx);
    swordNormal.crossVectors(swordDirection, swordWidth).normalize();
    swordWidth.crossVectors(swordNormal, swordDirection).normalize();
    swordBasis.makeBasis(swordDirection, swordWidth, swordNormal);
    sword.position.copy(handBase).addScaledVector(swordDirection, .8);
    sword.quaternion.setFromRotationMatrix(swordBasis);
    sword.scale.setScalar(1.2);
    return sword;
  }

  const poleDirection=new THREE.Vector3(),poleRight=new THREE.Vector3(),poleUp=new THREE.Vector3(),poleBasis=new THREE.Matrix4();
  // One right-palm attachment for stationary/moving thrust and charge. The
  // ownership-fixed pole ends at the supplied authoritative contact point.
  function placeHeldSpear(pole,grip,tip,dx=0,dz=1) {
    poleDirection.copy(tip).sub(grip).normalize();
    poleRight.crossVectors(worldUp,poleDirection);
    if(poleRight.lengthSq()<1e-10)poleRight.set(dz,0,-dx);
    poleRight.normalize();poleUp.crossVectors(poleDirection,poleRight).normalize();
    poleBasis.makeBasis(poleRight,poleUp,poleDirection);
    pole.position.copy(tip).addScaledVector(poleDirection,-heldHalfLength);
    pole.quaternion.setFromRotationMatrix(poleBasis);pole.scale.set(1,1,heldHalfLength);
    return pole;
  }

  function material(color, opacity, role = 'glow') {
    const m = new THREE.MeshBasicMaterial({color, opacity, transparent: true,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false});
    m.userData.baseOpacity = opacity;
    m.userData.role = role;
    return m;
  }
  function palette(color) {
    const tint = new THREE.Color(color ?? defaults);
    return {glow: material(tint, .32), edge: material(tint, .8, 'edge'),
      core: material(tint.clone().lerp(new THREE.Color('#ffffff'), .72), .95, 'core')};
  }
  function mesh(group, name, geometry, mat) {
    const node = new THREE.Mesh(geometry, mat); node.name = name; group.add(node); return node;
  }
  function shape(points, depth) {
    const s = new THREE.Shape(); s.moveTo(...points[0]);
    for (const p of points.slice(1)) s.lineTo(...p); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth, steps: 1, bevelEnabled: false});
    g.translate(0, 0, -depth / 2); return g;
  }
  function group(kind, plane) {
    const g = new THREE.Group(); g.name = `weapon-accent-${kind}`;
    g.userData = {decorative: true, kind, plane, unitBounds: [-1, 1]}; return g;
  }
  // Pointed axial blade with actual faceted volume, tip at local +Z = 1.
  function diamond() {
    const p = [[0,0,1],[-.19,0,.5],[0,.085,.5],[.19,0,.5],[0,-.085,.5],[0,0,.28]];
    const faces = [[0,1,2],[0,2,3],[0,3,4],[0,4,1],[5,2,1],[5,3,2],[5,4,3],[5,1,4]];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(f=>f.flatMap(i=>p[i])),3));
    geo.computeVertexNormals(); return geo;
  }
  function createSpear(color) {
    const g = group('spear', '+Z'), p = palette(color);
    const shaft = mesh(g, 'shaft', new THREE.CylinderGeometry(.023,.032,1.32,8), p.core);
    shaft.rotation.x = Math.PI/2; shaft.position.z = -.34;
    mesh(g, 'diamond-head', diamond(), p.core);
    const collar = mesh(g,'collar',new THREE.TorusGeometry(.072,.016,5,12),p.edge); collar.position.z=.3;
    const tail = mesh(g,'tail-fin',shape([[-.11,-.95],[0,-.65],[.11,-.95],[0,-.87]],.014),p.edge);
    tail.rotation.x = Math.PI/2;
    // Narrow trailing chevrons keep the thrust direction visually unambiguous.
    for(let i=0;i<3;i++) {
      const z=-.62+i*.29, w=.24-i*.045;
      const geom=shape([[-w,z-.13],[-.034,z+.055],[0,z+.16],[.034,z+.055],[w,z-.13],[0,z+.085]],.01);
      const trail=mesh(g,`wake-${i}`,geom,p.glow); trail.rotation.x=Math.PI/2;
    }
    return g;
  }
  // Reuse the charge spear's faceted head and luminous core/edge palette.
  // Match charge's .532-wide/.323-thick head; cap axial length at .60 so
  // the broad blade/collar clear the chest during preparation and recoil.
  // NPC poles remain 3.6; the explicitly owned hero pole is always 2.4.
  // Both retain their sole point at local +Z=1 and a 0.60-unit physical head.
  // No charge wake, second spear, expanding body or extra contact volume.
  function createHeldSpear(color) {
    const g=group('held-spear','+Z'),p=palette(color),halfLength=heldHalfLength;
    // Additive closed meshes are order-independent: one double-sided pass
    // keeps the original three held-weapon submissions instead of six.
    p.core.forceSinglePass=p.edge.forceSinglePass=true;
    const headDepth=.60/(.72*halfLength),collarZ=1+(.3-1)*headDepth;
    // Preserve the palm/recoil-safe physical shaft; brightness supplies its
    // charge-like readability without widening through the moving forearm.
    // Concentrate the light toward the head. A dark rear haft keeps the
    // fixed-length pole readable without making charge look like a backward club.
    // Added axial subdivisions preserve the identical tapered shaft surface.
    const shaftGeo=new THREE.CylinderGeometry(.036,.04,1.8,10,8),shaftColors=[];
    const shaftPositions=shaftGeo.attributes.position;
    for(let i=0;i<shaftPositions.count;i++){const u=(shaftPositions.getY(i)+.9)/1.8,t=THREE.MathUtils.smoothstep(u,.42,.96),brightness=.07+.93*t;shaftColors.push(brightness,brightness,brightness);}
    shaftGeo.setAttribute('color',new THREE.Float32BufferAttribute(shaftColors,3));
    // MeshBasicMaterial has no default color attribute. Keep the faceted head
    // on its plain core material instead of enabling vertex colors on both.
    const shaftMaterial=p.core.clone();shaftMaterial.vertexColors=true;
    const shaft=mesh(g,'held-shaft',shaftGeo,shaftMaterial);
    shaft.rotation.x=Math.PI/2;shaft.position.z=-.10;
    const head=diamond();head.scale(1.4,1.9,headDepth);head.translate(0,0,1-headDepth);
    mesh(g,'held-head',head,p.core);
    const collar=mesh(g,'held-collar',new THREE.TorusGeometry(.072,.016,5,12),p.edge);
    collar.position.z=collarZ;collar.scale.set(1.4,1.9,1);g.userData.tip=new THREE.Vector3(0,0,1);return g;
  }
  // Blade in local XY, tip toward +X. Inherit the slash group's vertical/horizontal quaternion.
  function createSword(color) {
    const g=group('sword','XY'), p=palette(color);
    mesh(g,'blade',shape([[-.26,-.085],[.59,-.075],[.97,0],[.59,.075],[-.26,.085]],.055),p.edge);
    mesh(g,'blade-ridge',shape([[-.24,-.018],[.66,-.015],[.97,0],[.66,.015],[-.24,.018]],.065),p.core);
    const handle=mesh(g,'grip',new THREE.CylinderGeometry(.042,.042,.42,8),p.core);
    handle.rotation.z=Math.PI/2; handle.position.x=-.58;
    mesh(g,'guard',shape([[-.37,-.25],[-.29,-.23],[-.29,.23],[-.37,.25],[-.42,.18],[-.37,.14],[-.37,-.14],[-.42,-.18]],.09),p.edge);
    const pommel=mesh(g,'pommel',new THREE.OctahedronGeometry(.074),p.core);pommel.position.x=-.84;
    mesh(g,'blade-halo',shape([[-.2,-.14],[.58,-.13],[.99,0],[.58,.13],[-.2,.14]],.014),p.glow);
    return g;
  }
  function createLanding(color) {
    const g=group('landing','XZ'), p=palette(color);
    function ring(name,inner,outer,start=0,length=Math.PI*2) {
      const m=mesh(g,name,new THREE.RingGeometry(inner,outer,64,1,start,length),p.edge);
      m.rotation.x=-Math.PI/2; return m;
    }
    ring('shock-rim',.958,.982); ring('inner-shock',.49,.515);
    for(let i=0;i<8;i++) ring(`broken-rim-${i}`,.79,.811,i*Math.PI/4+.05,.49);
    const vertices=[];
    function ribbon(a,b,width) {
      const dx=b[0]-a[0], dz=b[1]-a[1], len=Math.hypot(dx,dz), x=-dz/len*width/2,z=dx/len*width/2;
      const pts=[[a[0]+x,0,a[1]+z],[a[0]-x,0,a[1]-z],[b[0]+x,0,b[1]+z],[b[0]-x,0,b[1]-z]];
      vertices.push(...pts[0],...pts[1],...pts[2],...pts[2],...pts[1],...pts[3]);
    }
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6+.06*Math.sin(i*2.1), points=[];
      for(let j=0;j<5;j++) {const r=.16+j*.195, t=a+(j%2 ? .066 : -.045);points.push([Math.cos(t)*r,Math.sin(t)*r]);}
      for(let j=0;j<4;j++) ribbon(points[j],points[j+1],.018-j*.003);
      const branch=points[2], t=a+(i%2?-.24:.24);
      ribbon(branch,[Math.cos(t)*.71,Math.sin(t)*.71],.008);
    }
    const cracks=new THREE.BufferGeometry();cracks.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));cracks.computeVertexNormals();
    mesh(g,'radial-cracks',cracks,p.core);
    // Coplanar by contract: caller lifts whole group slightly above ground to avoid z-fighting.
    return g;
  }
  return {createSpear,createHeldSpear,createSword,createLanding,placeSword,placeHeldSpear};
}
