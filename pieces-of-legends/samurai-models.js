import {ORIGINAL_RIG_STYLE,samuraiPresentationOptions} from './samurai-motion-profile.js';
import * as THREE from './vendor/three.module.min.js';
import {bakeNpcGait,createNpcLocomotion,shareEquivalentNpcGeometry} from './npc-locomotion.js';
import {createNpcAnimationPool} from './npc-animation.js';
import {createNpcReadyClips} from './npc-ready-pose.js';
import { createSamuraiActions } from './samurai-actions.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

// The supplied character's design stays intact. Only the separately exported
// mobile LOD and material variants are used here; nearby NPCs reuse the rig.
export async function loadSamuraiModels(scene, count, characterHeight=3.8) {
  const compactPromise=import('./assets/run-compact.js').then(module=>{const data=module.default;if(data.name!=='run'||!Number.isFinite(data.userData?.strideCoefficient)||data.userData.strideCoefficient<=.5||data.userData.strideCoefficient>=3||!data.tracks?.length||data.tracks.some(track=>!track.times?.length||!track.values?.length||[...track.times,...track.values].some(v=>!Number.isFinite(v))))throw Error('Invalid run calibration');const clip=THREE.AnimationClip.parse({...data,userData:JSON.stringify(data.userData)});clip.userData=data.userData;return clip;}).catch(()=>null);
  // Optional paired locomotion contact reconstruction; retain current clips on failure.
  let availableContacts=null;
  const contactPromise=import('./assets/locomotion-contact.js').then(module=>{
    const data=module.default,expected=new Set(['hips.position','hips.quaternion',...['L','R'].flatMap(side=>['thigh_','shin_','foot_','toe_'].map(name=>name+side+'.quaternion'))]);
    if(!Array.isArray(data)||data.length!==2||new Set(data.map(c=>c.name)).size!==2||data.some(c=>!['walk','run'].includes(c.name)||!Number.isFinite(c.userData?.strideCoefficient)||c.userData.strideCoefficient<=.2||c.userData.strideCoefficient>=3||c.tracks?.length!==expected.size||new Set(c.tracks.map(t=>t.name)).size!==expected.size||c.tracks.some(t=>!expected.has(t.name)||!t.times?.length||!t.values?.length||[...t.times,...t.values].some(v=>!Number.isFinite(v)))))throw Error('Invalid contact calibration');
    availableContacts=data.map(c=>{const clip=THREE.AnimationClip.parse({...c,userData:JSON.stringify(c.userData)});clip.userData=c.userData;return clip;});return availableContacts;
  }).catch(()=>null);
  const loader = new GLTFLoader();
  const [heroAsset, woodAsset, stoneAsset] = await Promise.all([
    loader.loadAsync('./assets/hero-actions.glb'),
    loader.loadAsync('./assets/enemy-wood.glb'),
    loader.loadAsync('./assets/enemy-stone.glb'),
  ]);
  let timer;const compact=await Promise.race([compactPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000);})]);clearTimeout(timer);const contacts=availableContacts;if(compact)heroAsset.animations=heroAsset.animations.map(clip=>clip.name==='run'?compact:clip);
  let contactReady=false;
  if(contacts){try{const patched=heroAsset.animations.map(base=>{const override=contacts.find(c=>c.name===base.name);if(!override)return base;if(Math.abs(base.duration-override.duration)>1e-6)throw Error('Contact duration mismatch');const tracks=new Map(override.tracks.map(t=>[t.name,t]));if([...tracks.keys()].some(name=>!base.tracks.some(t=>t.name===name)))throw Error('Contact binding mismatch');const clip=base.clone();clip.tracks=base.tracks.map(t=>tracks.get(t.name)||t);clip.userData=override.userData;return clip;});heroAsset.animations=patched;contactReady=true;}catch(error){console.warn('Contact calibration unavailable; retaining current gait',error);}}
  function normalize(model, height, readyPose) {
    const values=readyPose?.restBounds;
    // Legacy assets or malformed/unknown metadata retain the original safe path.
    const knownReady=(readyPose?.version===1&&readyPose.clip==='idle')||(readyPose?.version===2&&readyPose.clip==='npc-ready');
    const restBounds=knownReady&&readyPose.time===0
      &&Array.isArray(values)&&values.length===6&&values.every(Number.isFinite)
      &&[0,1,2].every(i=>values[i+3]>values[i])?values:null;
    model.updateMatrixWorld(true);
    // Baked ready LODs retain the rig's bind-pose normalization. Re-measuring
    // their crouched/bent silhouette would resize/recenter them at every LOD swap.
    const bounds = restBounds
      ? new THREE.Box3(new THREE.Vector3(...restBounds.slice(0,3)), new THREE.Vector3(...restBounds.slice(3,6)))
      : new THREE.Box3().setFromObject(model);
    const scale = height / (bounds.max.y - bounds.min.y);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid model bounds');
    const center = bounds.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    root.scale.setScalar(scale);
    root.userData.combatReady=!!restBounds;
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;
    root.add(model);
    root.updateMatrixWorld(true);
    return root;
  }
  const hero = new THREE.Group();
  hero.name = 'painted-samurai';
  const figure = normalize(heroAsset.scene, characterHeight);
  hero.add(figure);
  scene.add(hero);
  const groups = [], staticNpcGrips = [];
  let heroTriangles = 0, enemyTriangles = 0;
  hero.traverse(node => {
    if (node.isMesh) heroTriangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
  });
  [woodAsset.scene, stoneAsset.scene].forEach((asset, variant) => {
    const normalized = normalize(asset, characterHeight, asset.userData.combatReady);
    const palm=asset.userData.combatReady?.palm;
    // Socket and vertices share exactly the same rest-scale/center transform.
    staticNpcGrips.push(normalized.userData.combatReady&&Array.isArray(palm)&&palm.length===3&&palm.every(Number.isFinite)
      ? new THREE.Vector3(...palm).applyMatrix4(asset.matrixWorld) : null);
    const capacity = Math.ceil((count - variant) / 2);
    const parts = [];
    normalized.traverse(node => {
      if (!node.isMesh) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      // Neutral base preserves surface maps while allowing a clear faction tint.
      const tintMaterial=m=>{const c=m.clone();c.color.set('#ffffff');return c;};
      const material=Array.isArray(node.material)?node.material.map(tintMaterial):tintMaterial(node.material);
      const inst = new THREE.InstancedMesh(geometry, material, capacity);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      scene.add(inst);
      parts.push(inst);
      enemyTriangles += (geometry.index?.count || geometry.attributes.position.count) / 3 * capacity;
    });
    groups.push(parts);
  });
  shareEquivalentNpcGeometry(groups);
  const controller = createSamuraiActions(heroAsset.scene, heroAsset.animations, {scale:figure.scale.y,presentationOwner:'hero'});
  controller.preparePresentation?.(samuraiPresentationOptions(ORIGINAL_RIG_STYLE));
  const result={hero,figure,groups,staticNpcGrips,heroTriangles,enemyTriangles,rigged:true,controller,runCalibration:contactReady?'contact-v5':compact?'compact-0.75':'original',npcRigState:'loading',npcAnimations:null,npcLocomotion:null};
  // Optional and non-blocking: static instancing remains playable if this load fails.
  result.npcReady=loader.loadAsync('./assets/npc-rig-minimal.glb').then(asset=>{result.npcAnimations=createNpcAnimationPool({scene,template:asset.scene,clips:createNpcReadyClips(heroAsset.animations),materials:groups.map(parts=>parts.map(part=>part.material)),normalize,height:characterHeight,capacity:6,motionStyle:ORIGINAL_RIG_STYLE});result.npcRigState='ready';try{result.npcLocomotion=createNpcLocomotion(groups,bakeNpcGait(result.npcAnimations.pool[0]));}catch(error){console.warn('NPC gait fallback unavailable; retaining static LOD',error);}return result.npcAnimations;}).catch(error=>{result.npcRigState='fallback';console.warn('NPC animation unavailable; retaining static LOD',error);return null;});
  return result;
}
