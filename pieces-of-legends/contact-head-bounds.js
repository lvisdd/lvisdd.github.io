import * as THREE from './vendor/three.module.min.js';

// Asset preparation only: all vertices with any positive head-bone influence
// participate, including hair and mixed neck vertices. A mixed vertex is a
// convex blend of its influencing-bone positions, so the union of those bone
// boxes encloses it without a pose sample or runtime vertex scan.
const skinCache=new WeakMap(),staticCache=new WeakMap();
const finiteMatrix=m=>m?.elements?.length===16&&m.elements.every(Number.isFinite);
const finiteBox=b=>!b.isEmpty()&&Number.isFinite(b.min.x)&&Number.isFinite(b.min.y)&&Number.isFinite(b.min.z)&&Number.isFinite(b.max.x)&&Number.isFinite(b.max.y)&&Number.isFinite(b.max.z);
const sameValues=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const geometryCurrent=r=>r.geometry.attributes.position===r.position&&r.position.version===r.positionVersion&&r.geometry.index===r.index&&(!r.index||r.index.version===r.indexVersion)&&(r.geometry.morphAttributes.position||null)===r.morphSource&&r.geometry.morphTargetsRelative===r.morphRelative&&r.morphAttributes.every((m,i)=>r.morphSource[i]===m&&m.version===r.morphVersions[i])&&(!r.morphSource||r.morphSource.length===r.morphLength);
function geometryStamp(geometry){const morphSource=geometry.morphAttributes.position||null,morphAttributes=morphSource?.slice()||[];return {positionVersion:geometry.attributes.position.version,index:geometry.index,indexVersion:geometry.index?.version,morphSource,morphAttributes,morphVersions:morphAttributes.map(m=>m.version),morphLength:morphAttributes.length,morphRelative:geometry.morphTargetsRelative};}
const sameIndex=(a,b)=>!!a===!!b&&(!a||a.count===b.count&&Array.from(a.array).every((v,i)=>v===b.array[i]));
function skinRecord(mesh,stats){
 const geometry=mesh.geometry,skeleton=mesh.skeleton,head=skeleton?.bones.findIndex(b=>b.name==='head');
 if(!(head>=0)||!finiteMatrix(mesh.bindMatrix)||skeleton.boneInverses.length!==skeleton.bones.length||skeleton.boneInverses.some(m=>!finiteMatrix(m)))throw Error('Missing valid head rig');
 const signature=JSON.stringify([mesh.bindMatrix.elements,skeleton.bones.map(b=>b.name),skeleton.boneInverses.map(m=>m.elements)]);
 let records=skinCache.get(geometry);if(records?.has(signature)){const cached=records.get(signature);if(!geometryCurrent(cached)||cached.skinIndex.version!==cached.skinIndexVersion||cached.skinWeight.version!==cached.skinWeightVersion)throw Error('Cached head geometry changed');stats.cacheHits++;return cached;}
 const p=geometry.attributes.position,si=geometry.attributes.skinIndex,sw=geometry.attributes.skinWeight,morphs=geometry.morphAttributes.position||[];
 if(!p||!si||!sw||p.count!==si.count||p.count!==sw.count||morphs.some(m=>m.count!==p.count))throw Error('Unknown skin topology');
 const selected=[],boxes=new Map(),v=new THREE.Vector3(),lo=new THREE.Vector3(),hi=new THREE.Vector3(),transform=new THREE.Matrix4();let maxWeightError=0;
 for(let i=0;i<p.count;i++){
  let selectedVertex=false,sum=0;for(let j=0;j<4;j++){const w=sw.getComponent(i,j),bone=si.getComponent(i,j);if(!Number.isFinite(w)||w<0||!Number.isInteger(bone)||!skeleton.bones[bone])throw Error('Invalid skin influence');sum+=w;if(bone===head&&w>0)selectedVertex=true;}
  if(!selectedVertex)continue;if(Math.abs(sum-1)>1e-5)throw Error('Unnormalized head skin weights');maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));selected.push(i);
  lo.fromBufferAttribute(p,i);hi.copy(lo);
  // Morph coefficients in [0,1]: interval sum is conservative even when more
  // than one relative/absolute shape is simultaneously active.
  for(const m of morphs)for(let axis=0;axis<3;axis++){const delta=m.getComponent(i,axis)-(geometry.morphTargetsRelative?0:p.getComponent(i,axis));lo.setComponent(axis,lo.getComponent(axis)+Math.min(0,delta));hi.setComponent(axis,hi.getComponent(axis)+Math.max(0,delta));}
  if(![...lo,...hi].every(Number.isFinite))throw Error('Nonfinite head vertex');
  for(let j=0;j<4;j++)if(sw.getComponent(i,j)>0){const bone=si.getComponent(i,j);let box=boxes.get(bone);if(!box){box=new THREE.Box3();boxes.set(bone,box);}transform.multiplyMatrices(skeleton.boneInverses[bone],mesh.bindMatrix);
   for(let c=0;c<8;c++)box.expandByPoint(v.set(c&1?hi.x:lo.x,c&2?hi.y:lo.y,c&4?hi.z:lo.z).applyMatrix4(transform));
  }
 }
 if(!selected.length||[...boxes.values()].some(b=>!finiteBox(b)))throw Error('Empty or nonfinite head mask');stats.skinVertexScans+=p.count;stats.skinGeometries++;
 const record={geometry,position:p,...geometryStamp(geometry),skinIndex:si,skinWeight:sw,skinIndexVersion:si.version,skinWeightVersion:sw.version,selected,boxes:[...boxes].map(([bone,box])=>({bone,box})),maxWeightError};
 if(!records){records=new Map();skinCache.set(geometry,records);}records.set(signature,record);return record;
}
function staticRecord(geometry,rig,stats){
 const cached=staticCache.get(geometry);if(cached&&cached.rig===rig){if(!geometryCurrent(cached))throw Error('Cached static head geometry changed');stats.cacheHits++;return cached;}
 const p=geometry.attributes.position,morphs=geometry.morphAttributes.position||[];
 if(!p||p.count!==rig.position.count||!sameIndex(geometry.index,rig.geometry.index)||morphs.some(m=>m.count!==p.count)||morphs.length&&geometry.morphTargetsRelative)throw Error('Static/head topology or gait metadata mismatch');
 const box=new THREE.Box3(),v=new THREE.Vector3();
 // Production NPC gait uses nonnegative two-frame weights whose sum <= 1;
 // the base and absolute morph-position union encloses every interpolation.
 for(const i of rig.selected)for(const attr of [p,...morphs]){v.fromBufferAttribute(attr,i);if(![...v].every(Number.isFinite))throw Error('Nonfinite static head');box.expandByPoint(v);}
 stats.staticVertexScans+=rig.selected.length*(1+morphs.length);stats.staticGeometries++;
 const record={geometry,rig,position:p,...geometryStamp(geometry),box};staticCache.set(geometry,record);return record;
}
export function createContactHeadBounds(models){
 const entries=Array.from({length:41},()=>({id:null,box:new THREE.Box3()}));let count=0,active=false,initialized=false,frameReady=false,failure=null;
 const counters={skinVertexScans:0,staticVertexScans:0,skinGeometries:0,staticGeometries:0,cacheHits:0,activeFrames:0,inactiveFrames:0,rigHeads:0,staticHeads:0,boneBoxes:0,runtimeVertexScans:0};
 const bindSkin=mesh=>({mesh,record:skinRecord(mesh,counters),skeleton:mesh.skeleton,boneArray:mesh.skeleton.bones,bones:mesh.skeleton.bones.slice(),inverseArray:mesh.skeleton.boneInverses,inverses:mesh.skeleton.boneInverses.slice(),inverseValues:mesh.skeleton.boneInverses.map(m=>m.elements.slice()),bindMatrix:mesh.bindMatrix,bindValues:mesh.bindMatrix.elements.slice()});
 const hero=[],heroRoot=models?.hero,slots=new WeakMap(),statics=[],staticParts=[],staticGroups=models?.groups;const work=new THREE.Box3(),matrix=new THREE.Matrix4(),prefix=new THREE.Matrix4();
 const fail=error=>{frameReady=false;failure=String(error?.message||error);};
 function prepare(){
  if(initialized||failure)return;
  try{
   if(!models?.hero||!models.npcAnimations?.pool?.length||!models.groups?.length)throw Error('Head assets unavailable');
   models.hero.traverse(m=>{if(m.isSkinnedMesh)hero.push(bindSkin(m));});if(!hero.length)throw Error('Hero skin unavailable');
   for(const slot of models.npcAnimations.pool){if(!slot.meshes?.length)throw Error('Empty NPC head meshes');const records=slot.meshes.map(mesh=>{if(!mesh.isSkinnedMesh)throw Error('Unknown NPC head mesh');return bindSkin(mesh);});slots.set(slot,records);}
   const rig=slots.get(models.npcAnimations.pool[0]);
   for(const parts of models.groups){if(!parts.length||parts.length!==rig.length)throw Error('Static head part mismatch');staticParts.push(parts);statics.push(parts.map((inst,i)=>({inst,record:staticRecord(inst.geometry,rig[i].record,counters)})));}
   initialized=true;failure=null;
  }catch(error){fail(error);}
 }
 // Optional asynchronous asset loading initializes once after its gait bake.
 if(models?.npcAnimations)prepare();else if(models?.npcReady)models.npcReady.then(prepare,fail);
 function claim(id){if(!Number.isInteger(id)||count>=entries.length){fail('Invalid head identity/capacity');return null;}for(let i=0;i<count;i++)if(entries[i].id===id){fail('Duplicate head identity');return null;}const entry=entries[count++];entry.id=id;entry.box.makeEmpty();return entry.box;}
 function rigBounds(root,records,box){
  root.updateMatrixWorld(true);
  for(const prepared of records){const {mesh,record:r}=prepared;if(mesh.geometry!==r.geometry||!geometryCurrent(r)||mesh.geometry.attributes.skinIndex!==r.skinIndex||mesh.geometry.attributes.skinWeight!==r.skinWeight||r.skinIndex.version!==r.skinIndexVersion||r.skinWeight.version!==r.skinWeightVersion)throw Error('Head geometry replaced');
   const skeleton=mesh.skeleton;if(skeleton!==prepared.skeleton||skeleton.bones!==prepared.boneArray||skeleton.boneInverses!==prepared.inverseArray||skeleton.bones.length!==prepared.bones.length||skeleton.boneInverses.length!==prepared.inverses.length||mesh.bindMatrix!==prepared.bindMatrix||!sameValues(mesh.bindMatrix.elements,prepared.bindValues))throw Error('Head skeleton binding replaced');
   for(let i=0;i<prepared.bones.length;i++)if(skeleton.bones[i]!==prepared.bones[i]||skeleton.boneInverses[i]!==prepared.inverses[i]||!sameValues(skeleton.boneInverses[i].elements,prepared.inverseValues[i]))throw Error('Head bone binding replaced');
   if(mesh.morphTargetInfluences?.some(w=>!Number.isFinite(w)||w<0||w>1))throw Error('Unsupported head morph weight');
   if(!finiteMatrix(mesh.matrixWorld)||!finiteMatrix(mesh.bindMatrixInverse))throw Error('Invalid head skin matrix');prefix.multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse);
   for(const b of r.boxes){const bone=mesh.skeleton.bones[b.bone];if(!finiteMatrix(bone?.matrixWorld))throw Error('Invalid head bone matrix');matrix.multiplyMatrices(prefix,bone.matrixWorld);work.copy(b.box).applyMatrix4(matrix);box.union(work);counters.boneBoxes++;}
   // Float32 skin weights differ slightly from one. Include their bounded
   // normalization error plus roundoff; mixed neck weights are not discarded.
   const extent=Math.max(...box.min.toArray().map(Math.abs),...box.max.toArray().map(Math.abs));box.expandByScalar(1e-5+(extent+1)*r.maxWeightError);
  }
  if(!finiteBox(box))throw Error('Invalid rig head world bound');counters.rigHeads++;
 }
 function begin(on,heroId,heroVisible){count=0;active=!!on;frameReady=initialized;if(!active){counters.inactiveFrames++;return;}counters.activeFrames++;if(!initialized)return;
  try{if(heroVisible){if(models.hero!==heroRoot)throw Error('Hero head root replaced');const box=claim(heroId);if(box)rigBounds(models.hero,hero,box);}}catch(error){fail(error);}
 }
 function addNpc(actor,finalRootMatrix,slot){
  if(!active||!frameReady)return;if(actor?.alive===false&&actor.age>2.4)return;
  try{const box=claim(actor?.id);if(!box)return;
   if(slot?.root?.visible){const records=slots.get(slot);if(!records||slot.id!==actor.id)throw Error('Unbound animated head');rigBounds(slot.root,records,box);}
   else{if(!finiteMatrix(finalRootMatrix))throw Error('Invalid static head matrix');const variant=actor.id%statics.length,records=statics[variant];if(!records||models.groups!==staticGroups||models.groups[variant]!==staticParts[variant]||models.groups[variant].length!==records.length)throw Error('Unknown static head variant');for(let i=0;i<records.length;i++){const {inst,record:r}=records[i];if(models.groups[variant][i]!==inst||inst.geometry!==r.geometry||!geometryCurrent(r))throw Error('Static head geometry replaced');work.copy(r.box).applyMatrix4(finalRootMatrix);box.union(work);}box.expandByScalar(1e-5);counters.staticHeads++;}
   if(!finiteBox(box))throw Error('Invalid head world bound');
  }catch(error){fail(error);}
 }
 return {begin,addNpc,entries,get count(){return count;},get ready(){return !active||frameReady;},stats:()=>({...counters,initialized,active,count,ready:!active||frameReady,failure})};
}
