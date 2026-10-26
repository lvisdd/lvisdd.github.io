import * as THREE from './vendor/three.module.min.js';
import reference from './assets/wall-braced-spear.js';
// A bounded, reversible corrective for the authored open hands. The rig
// has no finger joints. Only distal hand vertices move; every other action
// retains the exact original mesh. Shared geometry is prepared once.
const prepared=new WeakMap();
// Overhand waist socket: the pole sits below the wrist, with a continuous
// distal palm/finger corrective. NPC geometry and other actions stay original.
export const HERO_SPEAR_PALM_SOCKET=Object.freeze(new THREE.Vector3(-.012,.042,-.020).addScaledVector(new THREE.Vector3(.577486606816,0,.816400151466),.012).toArray());
export function createSpearHandGrip(model){
 const bindings=[],shaft=new THREE.Vector3(...reference.userData.supportedShaftAxis).normalize(),finger=new THREE.Vector3(0,1,0);finger.addScaledVector(shaft,-finger.dot(shaft)).normalize();const normal=new THREE.Vector3().crossVectors(finger,shaft).normalize(),socket=new THREE.Vector3(-.012,.042,-.020),relative=new THREE.Vector3();
 model.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  let index=prepared.get(mesh.geometry);
  if(index===undefined){
   const g=mesh.geometry,hand=mesh.skeleton.bones.findIndex(b=>b.name==='hand_R');
   if(hand<0||Object.keys(g.morphAttributes).length){prepared.set(g,-1);return;}
   const inverse=mesh.skeleton.boneInverses[hand],toMesh=new THREE.Matrix4().copy(inverse).invert().premultiply(new THREE.Matrix4().copy(mesh.bindMatrix).invert()),p=new THREE.Vector3(),q=new THREE.Vector3();
   const delta=new Float32Array(g.attributes.position.count*3),changed=new Set();
   const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
   for(let i=0;i<g.attributes.position.count;i++){
    let weight=0;for(let j=0;j<4;j++)if(g.attributes.skinIndex.array[i*4+j]===hand)weight+=g.attributes.skinWeight.array[i*4+j];if(weight<.95)continue;
    p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse);q.copy(p);
    relative.copy(p).sub(socket);const across=relative.dot(shaft),along=relative.dot(finger),height=relative.dot(normal);let w=across,u=along,h=height;
    if(along<=0)h=Math.min(h,-.013*(1-smooth((-along-.008)/.020)));
    if(along>0){const length=.061-.023*smooth((-across-.020)/.028)-.016*smooth((across-.010)/.018),angle=4.05*Math.min(1,along/length),r=Math.max(.012,-height*(1-.3*smooth(along/.01)));u=r*Math.sin(angle);h=-r*Math.cos(angle);}
    const thumb=smooth((across-.002)/.024)*(1-smooth((along+.003)/.020))*smooth((along+.043)/.013),thumbAngle=1.4*thumb,thumbAcross=across-.008,thumbHeight=height+.026;w=.008+thumbAcross*Math.cos(thumbAngle)-thumbHeight*Math.sin(thumbAngle);h+=thumbAcross*Math.sin(thumbAngle)+thumbHeight*(Math.cos(thumbAngle)-1);u-=.004*thumb;
    q.copy(socket).addScaledVector(shaft,w).addScaledVector(finger,u).addScaledVector(normal,h);
    q.addScaledVector(normal,.012*smooth((p.y-.004)/.035));
    const radial=q.clone().sub(socket).addScaledVector(normal,-.012),ru=radial.dot(finger),rh=radial.dot(normal),rr=Math.hypot(ru,rh);if(rr<.014){const factor=.014/Math.max(rr,1e-9);q.addScaledVector(finger,ru*(factor-1));q.addScaledVector(normal,rh*(factor-1));}
    if(q.distanceToSquared(p)<1e-14)continue;
    p.applyMatrix4(toMesh);q.applyMatrix4(toMesh).sub(p);q.toArray(delta,i*3);changed.add(i);
   }
   if(!changed.size){prepared.set(g,-1);return;}
   // Project the finite triangular palm/finger surface outside the grasp bore.
   // Curling only its vertices can leave a long low-poly edge cutting through
   // the shaft even when both endpoints clear it. This one-time correction
   // preserves topology and every inactive/guard vertex and morph slot.
   const local=new Map(),localOriginal=new Map(),closed=new THREE.Vector3(...HERO_SPEAR_PALM_SOCKET),faces=[];
   for(const i of changed){const value=new THREE.Vector3().fromBufferAttribute(g.attributes.position,i).add(new THREE.Vector3().fromArray(delta,i*3)).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse).sub(closed);local.set(i,[value.dot(shaft),value.dot(finger),value.dot(normal)]);localOriginal.set(i,local.get(i).slice());}
   const surfaceIndex=g.index?.array||Array.from({length:g.attributes.position.count},(_,i)=>i);
   for(let t=0;t<surfaceIndex.length;t+=3){const face=[surfaceIndex[t],surfaceIndex[t+1],surfaceIndex[t+2]];if(face.every(i=>local.has(i)))faces.push(face);}
   const bore=.0115;
   function closest(face){
    const p=face.map(i=>local.get(i));let best=Infinity,result=null;
    for(let e=0;e<3;e++){const a=p[e],b=p[(e+1)%3],dx=b[1]-a[1],dy=b[2]-a[2],t=THREE.MathUtils.clamp(-(a[1]*dx+a[2]*dy)/(dx*dx+dy*dy||1),0,1),x=a[1]+t*dx,y=a[2]+t*dy,d=x*x+y*y;if(d<best){best=d;const weights=[0,0,0];weights[e]=1-t;weights[(e+1)%3]=t;result={x,y,d:Math.sqrt(d),weights};}}
    return result;
   }
   let maxCorrection=0,iterations=0;
   for(;iterations<96;iterations++){
    const corrections=new Map();let deficit=0;
    for(const face of faces){const hit=closest(face);if(hit.d>=bore)continue;const missing=bore-hit.d;deficit=Math.max(deficit,missing);const den=hit.weights.reduce((sum,v)=>sum+v*v,0),nx=hit.x/Math.max(hit.d,1e-12),ny=hit.y/Math.max(hit.d,1e-12);for(let j=0;j<3;j++){if(hit.weights[j]<1e-9)continue;const i=face[j],c=corrections.get(i)||[0,0,0];c[0]+=nx*missing*hit.weights[j]/den;c[1]+=ny*missing*hit.weights[j]/den;c[2]++;corrections.set(i,c);}}
    if(deficit<1e-7)break;
    for(const [i,c] of corrections){const p=local.get(i);p[1]+=c[0]/c[2];p[2]+=c[1]/c[2];}
   }
   for(const [i,value] of local){const before=localOriginal.get(i);maxCorrection=Math.max(maxCorrection,Math.hypot(value[1]-before[1],value[2]-before[2]));const q=closed.clone().addScaledVector(shaft,value[0]).addScaledVector(finger,value[1]).addScaledVector(normal,value[2]).applyMatrix4(toMesh).sub(new THREE.Vector3().fromBufferAttribute(g.attributes.position,i));q.toArray(delta,i*3);}
   // The off-hand stays free: the authored short pole is outside its reach.
   // Fold the free fingers back toward the palm with a bounded physical curl.
   // A separate, short thumb region leaves the index knuckle untouched. Only
   // fully left-hand-owned distal vertices move: wrist, mixed cuff and rig stay exact.
   const leftHand=mesh.skeleton.bones.findIndex(b=>b.name==='hand_L');let leftVertices=0;
   if(leftHand>=0){
    const leftInverse=mesh.skeleton.boneInverses[leftHand],leftToMesh=new THREE.Matrix4().copy(leftInverse).invert().premultiply(new THREE.Matrix4().copy(mesh.bindMatrix).invert());
    const guardShaft=new THREE.Vector3(-.7876330410012757,.26312736375622847,.5571339531440799).normalize(),guardFinger=new THREE.Vector3(0,1,0).addScaledVector(guardShaft,-guardShaft.y).normalize(),guardNormal=new THREE.Vector3().crossVectors(guardFinger,guardShaft).normalize();
    for(let i=0;i<g.attributes.position.count;i++){
     let handWeight=0;for(let j=0;j<4;j++)if(g.attributes.skinIndex.array[i*4+j]===leftHand)handWeight+=g.attributes.skinWeight.array[i*4+j];if(handWeight<.95)continue;
     p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(leftInverse);p.x=-p.x;relative.copy(p).sub(socket);
     const across=relative.dot(guardShaft),along=relative.dot(guardFinger),height=relative.dot(guardNormal);let w=across,u=along,h=height;
     if(along>.006){const hinge=.006,center=-.020,length=.061-.023*smooth((-across-.020)/.028)-.016*smooth((across-.010)/.018),angle=4.35*Math.min(1,(along-hinge)/(length-hinge)),blend=smooth((along-hinge)/.01),radius=THREE.MathUtils.lerp(height-center,THREE.MathUtils.clamp(height-center,.004,.012),blend);u=hinge+radius*Math.sin(angle);h=center+radius*Math.cos(angle);}
     const thumb=smooth((across-.010)/.025)*(1-smooth((along+.016)/.020))*smooth((along+.043)/.013);w*=1-.32*smooth(along/.025);w-=.045*thumb;u+=.025*thumb;h+=.028*thumb;
     q.copy(socket).addScaledVector(guardShaft,w).addScaledVector(guardFinger,u).addScaledVector(guardNormal,h);if(q.distanceToSquared(p)<1e-14)continue;
     p.x=-p.x;q.x=-q.x;p.applyMatrix4(leftToMesh);q.applyMatrix4(leftToMesh).sub(p);q.toArray(delta,i*3);changed.add(i);leftVertices++;
    }
   }
   const corrected=g.clone(),a=corrected.attributes.position;for(const i of changed){a.setXYZ(i,a.getX(i)+delta[i*3],a.getY(i)+delta[i*3+1],a.getZ(i)+delta[i*3+2]);}corrected.computeVertexNormals();
   const normalVertices=new Set(changed),indices=g.index?.array,total=indices?indices.length:g.attributes.position.count;for(let t=0;t<total;t+=3){const a=indices?indices[t]:t,b=indices?indices[t+1]:t+1,c=indices?indices[t+2]:t+2;if(changed.has(a)||changed.has(b)||changed.has(c)){normalVertices.add(a);normalVertices.add(b);normalVertices.add(c);}}
   const normals=new Float32Array(delta.length);for(const i of normalVertices)for(let j=0;j<3;j++)normals[i*3+j]=corrected.attributes.normal.array[i*3+j]-g.attributes.normal.array[i*3+j];corrected.dispose();
   g.morphTargetsRelative=true;g.morphAttributes.position=[new THREE.BufferAttribute(delta,3)];g.morphAttributes.normal=[new THREE.BufferAttribute(normals,3)];g.userData.spearHandGrip={vertices:changed.size,normalVertices:normalVertices.size,palmSocket:[...HERO_SPEAR_PALM_SOCKET],kind:'right-hand-overhand-waist-closed-v3',bore,maxCorrection,iterations,leftVertices,leftKind:'compact-free-fist-v1'};index=0;prepared.set(g,index);
  }
  if(index<0)return;const influences=mesh.morphTargetInfluences?.slice()||[];mesh.updateMorphTargets();influences.forEach((weight,slot)=>{mesh.morphTargetInfluences[slot]=weight;});bindings.push({mesh,index});
 });
 const apply=weight=>{for(const b of bindings)b.mesh.morphTargetInfluences[b.index]=THREE.MathUtils.clamp(weight,0,1);};
 return {apply,reset:()=>apply(0),bindings};
}
