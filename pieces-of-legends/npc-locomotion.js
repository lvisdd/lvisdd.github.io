import * as THREE from './vendor/three.module.min.js';

export const NPC_GAIT_PHASES=Object.freeze({walk:Object.freeze([0,.08,1/6,.25,1/3,5/12,.5,.58,2/3,.75,5/6,11/12]),run:Object.freeze([0,.1,.2,.3,.38,.44,.5,.6,.7,.8,.88,.94])});
const ORDINARY_INTENTS=new Set(['advance','refill','withdraw','attack_lane','king_advance','escort','maintain_lane','reserve_advance','support_advance','tactic_advance','royal_return','royal_intercept','royal_cover']);

// One existing instanced-morph scalar, derived only from this frame's engine
// attack clock and existing gait weight. No per-actor transition history.
// Only spear attacks need the old waist base; other static actions retain boxing.
const staticReadySmooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
export function npcStaticReadyWeight(e,gaitWeight=0){
 let ready=1;
 if(e.alive&&!(e.stagger>0)&&(e.actionKind==='thrust'||e.actionKind==='charge')){
  if(e.attack==='windup'){const duration=Math.max(.001,e.windupDuration||.75);ready=1-staticReadySmooth((duration-Math.max(0,e.attackTimer||0))/Math.min(.10,duration));}
  else if(e.attack==='recover')ready=1-staticReadySmooth(Math.max(0,e.attackTimer||0)/.12);
  else if(e.attack==='charge')ready=0;
 }
 return ready*(1-THREE.MathUtils.clamp(gaitWeight,0,1));
}

// Wood/stone use different materials, but may share exact mesh data. Never
// merge differing UVs, colors, indices, groups or attribute interpretation.
export function shareEquivalentNpcGeometry(groups){
 const equalArray=(a,b)=>{if(!a||!b)return a===b;if(a.constructor!==b.constructor||a.length!==b.length)return false;const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);return x.every((v,i)=>v===y[i]);};
 const equalAttribute=(a,b)=>!!a&&!!b&&!a.isInterleavedBufferAttribute&&!b.isInterleavedBufferAttribute&&a.count===b.count&&a.usage===b.usage&&a.itemSize===b.itemSize&&a.normalized===b.normalized&&a.gpuType===b.gpuType&&equalArray(a.array,b.array);
 const same=(a,b)=>a.drawRange.start===b.drawRange.start&&a.drawRange.count===b.drawRange.count&&JSON.stringify(a.groups)===JSON.stringify(b.groups)&&a.morphTargetsRelative===b.morphTargetsRelative&&Object.keys(a.morphAttributes).length===0&&Object.keys(b.morphAttributes).length===0&&Object.keys(a.attributes).length===Object.keys(b.attributes).length&&Object.entries(a.attributes).every(([name,v])=>equalAttribute(v,b.attributes[name]))&&(!a.index&&!b.index||equalAttribute(a.index,b.index));
 const unique=[];for(const inst of groups.flat()){const shared=unique.find(g=>same(g,inst.geometry));if(shared&&shared!==inst.geometry){const old=inst.geometry;inst.geometry=shared;old.dispose();}else if(!shared)unique.push(inst.geometry);}return unique.length;
}

// One fixed-size bake during optional model preparation. Runtime uses Three's
// stock instanced morph path, including normals, depth and distance shaders.
// Full ordinary poses match the nearby rig. A single additional ready target
// preserves boxing while spear attacks return to the borrowed old waist base.
export function bakeNpcGait(slot,{samples=12,phaseKnots=samples===12?NPC_GAIT_PHASES:null}={}){
 if(!Number.isInteger(samples)||samples<4||samples>32)throw Error('Invalid NPC gait sample count');
 const {model,root,controller}=slot,bones=[];model.traverse(b=>{if(b.isBone)bones.push(b);});
 const saved=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));
 const restore=()=>bones.forEach((b,i)=>{b.position.copy(saved[i].p);b.quaternion.copy(saved[i].q);b.scale.copy(saved[i].s);});
 const knots=Object.fromEntries(['walk','run'].map(name=>[name,phaseKnots?.[name]||Array.from({length:samples},(_,i)=>i/samples)]));
 for(const values of Object.values(knots))if(values.length!==samples||values[0]!==0||values.some((v,i)=>!Number.isFinite(v)||v<0||v>=1||i>0&&v<=values[i-1]))throw Error('Invalid NPC gait phase knots');
 const frames=slot.meshes.map(()=>({position:[],normal:[]})),strides={};
 const rootInverse=new THREE.Matrix4(),relative=new THREE.Matrix4(),skin=new THREE.Matrix4();
 const p=new THREE.Vector3(),q=new THREE.Vector4(),sum=new THREE.Vector4(),weights=new THREE.Vector4(),indices=new THREE.Vector4();
 controller.reset();const readyPose=controller.sample({mode:'ready',phase:0,cooldown:0,x:0,z:0,dt:0});root.updateMatrixWorld(true);rootInverse.copy(root.matrixWorld).invert();
 const ready=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));
 // Reuse the already-sampled native ready pose exactly once at preparation.
 // Positions include the existing0.7 hand morph; normals include its relative
 // normal delta before skinning. The24 gait snapshots below remain unchanged.
 const readyFrames=[],readyPalm=readyPose.chargeGrip.clone().applyMatrix4(rootInverse);
 try{
  for(const mesh of slot.meshes){
   if(!mesh.isSkinnedMesh)throw Error('NPC ready target requires skin');mesh.skeleton.update();relative.multiplyMatrices(rootInverse,mesh.matrixWorld);
   const geometry=mesh.geometry,count=geometry.attributes.position.count,positions=new Float32Array(count*3),normals=new Float32Array(count*3),morphs=geometry.morphAttributes.normal||[],influences=mesh.morphTargetInfluences||[];
   if(morphs.length&&(!geometry.morphTargetsRelative||morphs.some(m=>m.count!==count)))throw Error('Unsupported NPC ready normal morph');
   for(let i=0;i<count;i++){
    mesh.getVertexPosition(i,p).applyMatrix4(relative).toArray(positions,i*3);
    let nx=geometry.attributes.normal.getX(i),ny=geometry.attributes.normal.getY(i),nz=geometry.attributes.normal.getZ(i);
    morphs.forEach((m,j)=>{const weight=influences[j]||0;nx+=m.getX(i)*weight;ny+=m.getY(i)*weight;nz+=m.getZ(i)*weight;});
    weights.fromBufferAttribute(geometry.attributes.skinWeight,i);indices.fromBufferAttribute(geometry.attributes.skinIndex,i);sum.set(0,0,0,0);
    for(let j=0;j<4;j++){const weight=weights.getComponent(j);if(!weight)continue;skin.fromArray(mesh.skeleton.boneMatrices,indices.getComponent(j)*16);q.set(nx,ny,nz,0).applyMatrix4(mesh.bindMatrix).applyMatrix4(skin).multiplyScalar(weight);sum.add(q);}
    sum.applyMatrix4(mesh.bindMatrixInverse);p.set(sum.x,sum.y,sum.z).transformDirection(relative).toArray(normals,i*3);
   }
   if(positions.some(v=>!Number.isFinite(v))||normals.some(v=>!Number.isFinite(v)))throw Error('Nonfinite NPC ready target');
   readyFrames.push({position:new THREE.BufferAttribute(positions,3),normal:new THREE.BufferAttribute(normals,3)});
  }
  if(![readyPalm.x,readyPalm.y,readyPalm.z].every(Number.isFinite))throw Error('Nonfinite NPC ready palm');
 }catch(error){controller.reset();restore();root.updateMatrixWorld(true);throw error;}
 // Direct gait-track samples must start with the existing hand scalar reset.
 controller.reset();
 try{
  for(const name of ['walk','run']){
   const clip=controller.actions.get(name)?.getClip();if(!clip)throw Error('NPC gait clip missing');
   strides[name]=clip.userData?.strideCoefficient;if(!(strides[name]>.2&&strides[name]<3))throw Error('NPC gait requires paired calibration');
   const tracks=clip.tracks.map(t=>({bone:model.getObjectByName(t.name.split('.')[0]),kind:t.name.split('.')[1],sample:t.createInterpolant()}));
   if(tracks.some(t=>!t.bone||!['position','quaternion','scale'].includes(t.kind)))throw Error('NPC gait binding mismatch');
   for(let frame=0;frame<samples;frame++){
    bones.forEach((b,i)=>{b.position.copy(ready[i].p);b.quaternion.copy(ready[i].q);b.scale.copy(ready[i].s);});
    for(const track of tracks)track.bone[track.kind].fromArray(track.sample.evaluate(clip.duration*knots[name][frame]));
    root.updateMatrixWorld(true);
    slot.meshes.forEach((mesh,part)=>{
     if(!mesh.isSkinnedMesh)throw Error('NPC gait requires skin');mesh.skeleton.update();relative.multiplyMatrices(rootInverse,mesh.matrixWorld);
     const count=mesh.geometry.attributes.position.count,positions=new Float32Array(count*3),normals=new Float32Array(count*3);
     for(let i=0;i<count;i++){
      mesh.getVertexPosition(i,p).applyMatrix4(relative).toArray(positions,i*3);
      weights.fromBufferAttribute(mesh.geometry.attributes.skinWeight,i);indices.fromBufferAttribute(mesh.geometry.attributes.skinIndex,i);sum.set(0,0,0,0);
      for(let j=0;j<4;j++){const weight=weights.getComponent(j);if(!weight)continue;skin.fromArray(mesh.skeleton.boneMatrices,indices.getComponent(j)*16);q.set(mesh.geometry.attributes.normal.getX(i),mesh.geometry.attributes.normal.getY(i),mesh.geometry.attributes.normal.getZ(i),0).applyMatrix4(mesh.bindMatrix).applyMatrix4(skin).multiplyScalar(weight);sum.add(q);}
      sum.applyMatrix4(mesh.bindMatrixInverse);p.set(sum.x,sum.y,sum.z).transformDirection(relative).toArray(normals,i*3);
     }
     if(positions.some(v=>!Number.isFinite(v))||normals.some(v=>!Number.isFinite(v)))throw Error('Nonfinite NPC gait');
     frames[part].position.push(new THREE.BufferAttribute(positions,3));frames[part].normal.push(new THREE.BufferAttribute(normals,3));
    });
   }
  }
 }finally{controller.reset();restore();root.updateMatrixWorld(true);}
 const gaitBytes=frames.reduce((n,part)=>n+[...part.position,...part.normal].reduce((a,b)=>a+b.array.byteLength,0),0),readyBytes=readyFrames.reduce((n,part)=>n+part.position.array.byteLength+part.normal.array.byteLength,0);
 return {samples,frames,readyFrames,readyPalm,strides,phaseKnots:knots,scale:slot.figure.scale.y,gaitBytes,readyBytes,bytes:gaitBytes+readyBytes};
}

export function createNpcLocomotion(groups,bake){
 const {samples,frames,readyFrames,readyPalm,strides,scale,phaseKnots}=bake,total=samples*2,readyIndex=total,influences=new Float32Array(total+1),source={morphTargetInfluences:influences},states=new Map(),grip=new THREE.Vector3();let previous=new WeakMap(),disposed=false;
 influences[readyIndex]=1;
 const instances=groups.flat(),original=instances.map(inst=>({inst,count:inst.count,attributes:inst.geometry.morphAttributes,relative:inst.geometry.morphTargetsRelative}));
 // Validate every mesh before installing any targets.
 for(const parts of groups)parts.forEach((inst,i)=>{if(!frames[i]||!readyFrames?.[i]||frames[i].position.length!==total||frames[i].normal.length!==total||frames[i].position[0].count!==inst.geometry.attributes.position.count||readyFrames[i].position.count!==inst.geometry.attributes.position.count||readyFrames[i].normal.count!==inst.geometry.attributes.normal.count)throw Error('NPC gait/ready topology mismatch');});
 try{for(const parts of groups)parts.forEach((inst,i)=>{
  inst.geometry.morphAttributes={position:[...frames[i].position,readyFrames[i].position],normal:[...frames[i].normal,readyFrames[i].normal]};inst.geometry.morphTargetsRelative=false;
  // setMorphAt allocates using count, which may already be compacted to zero by
  // a frame while the optional rig was loading. Always allocate full capacity.
  const count=inst.count;inst.count=inst.instanceMatrix.count;for(let index=0;index<inst.count;index++)inst.setMorphAt(index,source);inst.count=count;inst.morphTexture.needsUpdate=true;
  for(const material of Array.isArray(inst.material)?inst.material:[inst.material])material.needsUpdate=true;
 });}catch(error){for(const {inst,count,attributes,relative}of original){inst.count=count;inst.morphTexture?.dispose();inst.morphTexture=null;inst.geometry.morphAttributes=attributes;inst.geometry.morphTargetsRelative=relative;}throw error;}
 function update(enemies,dt,{active=true}={}){
  states.clear();if(disposed)return states;
  for(const e of enemies){
   const old=previous.get(e),same=old&&old.alive&&e.alive&&old.team===e.team;
   const grounded=e.alive&&Math.abs(e.y||0)<.001&&!(e.stagger>0),attack=e.attack||'idle';
   const distance=same?Math.hypot(e.x-old.x,e.z-old.z):0;
   // Snapshot boundaries, knockback, jumps and teleports do not count as steps.
   const eligible=active&&dt>0&&same&&grounded&&old.grounded&&!(e.spawnProtection>0)&&attack==='idle'&&distance<=Math.max(.25,dt*12)&&(!e.intent||ORDINARY_INTENTS.has(e.intent));
   const travel=eligible&&distance>1e-5?distance:0,walking=e.equipment==='heavy';
   const phase=((same?old.phase:0)+travel/(strides[walking?'walk':'run']*scale))%1;
   // Keep the existing short gait settle at spear windup admission. The old
   // weight is the only memory; stationary starts remain at zero gait weight.
   const settlingAction=attack==='idle'||attack==='windup'&&(e.actionKind==='thrust'||e.actionKind==='charge');
   const held=dt<=0&&same&&active&&grounded&&settlingAction&&!(e.spawnProtection>0);
   const settling=active&&same&&grounded&&settlingAction&&!(e.spawnProtection>0)&&distance<=Math.max(.25,dt*12);
   const target=travel>0?1:0,prior=same?old.weight:0;
   const weight=held?prior:settling?prior+THREE.MathUtils.clamp(target-prior,-dt/.06,dt/.06):0;
   const state={phase,weight,walking,dx:travel?e.x-old.x:0,dz:travel?e.z-old.z:0,travel,readyWeight:npcStaticReadyWeight(e,weight)};states.set(e.id,state);
   previous.set(e,{x:e.x,z:e.z,team:e.team,alive:e.alive,grounded,phase,weight});
  }
  return states;
 }
 function apply(inst,index,e){
  if(disposed)return;influences.fill(0);const state=states.get(e.id);
  if(state?.weight>0&&e.alive){const knots=phaseKnots[state.walking?'walk':'run'],phase=state.phase;let a=samples-1;for(let i=1;i<samples;i++)if(phase<knots[i]){a=i-1;break;}const next=a+1<samples?knots[a+1]:1,t=(phase-knots[a])/(next-knots[a]),offset=state.walking?0:samples;influences[offset+a]=state.weight*(1-t);influences[offset+(a+1)%samples]=state.weight*t;}
  influences[readyIndex]=state?.readyWeight??1;inst.setMorphAt(index,source);
 }
 // Body and weapon socket use the identical per-frame coefficient. The caller
 // clones this scratch result before applying its existing final instance matrix.
 function palm(e,base){return disposed?base:grip.copy(base).lerp(readyPalm,states.get(e.id)?.readyWeight??1);}
 function finish(){if(!disposed)for(const inst of instances)inst.morphTexture.needsUpdate=true;}
 function reset(){previous=new WeakMap();states.clear();influences.fill(0);influences[readyIndex]=1;if(!disposed)for(const inst of instances){const count=inst.count;inst.count=inst.instanceMatrix.count;for(let i=0;i<inst.count;i++)inst.setMorphAt(i,source);inst.count=count;inst.morphTexture.needsUpdate=true;}}
 function dispose(){if(disposed)return;reset();disposed=true;const released=new Set();for(const {inst,attributes,relative}of original){inst.morphTexture?.dispose();inst.morphTexture=null;inst.geometry.morphAttributes=attributes;inst.geometry.morphTargetsRelative=relative;if(!released.has(inst.geometry)){released.add(inst.geometry);inst.geometry.dispose();}for(const material of Array.isArray(inst.material)?inst.material:[inst.material])material.needsUpdate=true;}}
 return {update,apply,palm,finish,reset,dispose,states,samples,readyIndex,bytes:bake.bytes,capacity:instances.reduce((n,i)=>n+i.instanceMatrix.count,0),bake};
}
