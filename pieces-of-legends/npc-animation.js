import {samuraiMotionProfile,ORIGINAL_RIG_STYLE,samuraiPresentationOptions} from './samurai-motion-profile.js';
import {createNpcFacing} from './npc-facing.js';
import {npcBodyColor} from './npc-body-color.js';
import * as THREE from './vendor/three.module.min.js';
import {createSamuraiActions} from './samurai-actions.js';

// Independent skeletons share geometry, clip data and existing material textures.
export function cloneRig(source){const clone=source.clone(true),lookup=new Map(),a=[],b=[];source.traverse(n=>a.push(n));clone.traverse(n=>b.push(n));a.forEach((n,i)=>lookup.set(n,b[i]));source.traverse(n=>{if(!n.isSkinnedMesh)return;const mesh=lookup.get(n),bones=n.skeleton.bones.map(bone=>lookup.get(bone));if(bones.some(bone=>!bone))throw Error('Incomplete NPC skeleton');mesh.skeleton=new THREE.Skeleton(bones,n.skeleton.boneInverses.map(m=>m.clone()));mesh.bind(mesh.skeleton,n.bindMatrix.clone());mesh.frustumCulled=false;});return clone;}
export function npcPose(e,style=ORIGINAL_RIG_STYLE){const phase=Math.max(0,e.attackTimer||0),kind=e.actionKind;let mode='ready',remaining=0,cooldown=0;
 if(e.attack==='windup'){const t=1-Math.min(1,phase/(e.windupDuration||.75));if(kind==='sweep'){mode='sweep';remaining=.46-.19*t;}else if(kind==='thrust'){mode='thrust';remaining=.4-.16*t;}else if(kind==='jump'){mode='jump';remaining=.9-.14*t;}else{mode='windup';remaining=.075*(1-t);}}
 else if(e.attack==='charge'){mode='charge';remaining=phase;}
 else if(e.attack==='leap'){mode='jump';remaining=.9-(.14+.62*(1-Math.min(1,phase/.75)));}
 else if(e.attack==='recover'){if(kind==='sweep'){mode='sweep';remaining=.27*Math.min(1,phase/.35);}else if(kind==='thrust'){mode='thrust';remaining=.24*Math.min(1,phase/.35);}else if(kind==='jump'){mode='jump';remaining=.14*Math.min(1,phase/.35);}else if(kind==='charge'){mode='charge_recover';cooldown=.2*Math.min(1,phase/.45);}}
 return {...samuraiMotionProfile(e.piece,style),mode,phase:remaining,cooldown,x:e.x,z:e.z,walking:e.equipment==='heavy'};
}
export function createNpcAnimationPool({scene,template,clips,materials,normalize,height=3.8,capacity=6,motionStyle=ORIGINAL_RIG_STYLE}){
 const attached=[];let pool;try{pool=Array.from({length:capacity},(_,i)=>{const model=cloneRig(template),root=new THREE.Group();root.name='animated-npc-'+i;const figure=normalize(model,height);root.add(figure);root.visible=false;scene.add(root);attached.push(root);const meshes=[];model.traverse(n=>{if(n.isSkinnedMesh||n.isMesh){meshes.push(n);n.frustumCulled=false;}});if(meshes.length!==materials[0].length||meshes.length!==materials[1].length)throw Error('NPC material/mesh mismatch');const variants=materials.map(list=>list.map(m=>Array.isArray(m)?m.map(x=>x.clone()):m.clone()));const controller=createSamuraiActions(model,clips,{scale:figure.scale.y,spearPresentationOwner:'hero'});controller.preparePresentation?.(samuraiPresentationOptions(motionStyle));return {root,figure,model,meshes,variants,controller,id:null,pose:null};});}catch(error){for(const root of attached)scene.remove(root);throw error;}
 const selected=new Set(),motionFacing=createNpcFacing();
 // A non-damaging shove interrupts the attack but should not replace an owned
 // skin with a different ready mesh. Blend the displayed joints to ready while
 // engine displacement stays on the root; real attack telegraphs still win slots.
 const poseBones=p=>{const bones=[];p.model.traverse(n=>{if(n.isBone)bones.push(n);});return bones;};
 const capture=bones=>bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));
 const restore=(bones,pose)=>bones.forEach((b,i)=>{b.position.copy(pose[i].p);b.quaternion.copy(pose[i].q);b.scale.copy(pose[i].s);});
 function sample(p,e,dt,active,locomotion,chargeCamera,thrustTip){
  const old=p.shove,shoved=e.stagger>0,continuing=old&&old.actor===e&&old.team===e.team&&(shoved||e.attack==='recover');
  const restarting=shoved&&active&&(!continuing||e.stagger>old.lastStagger+1e-6);
  if(restarting){const bones=poseBones(p),from=capture(bones);p.controller.reset();p.shove={actor:e,team:e.team,bones,from,elapsed:0,lastStagger:e.stagger,target:null};}
  else if(!continuing){if(old?.target)restore(old.bones,old.target);p.shove=null;}
  const transition=p.shove,step=active?Math.max(0,dt):0;
  if(transition){
   if(transition.target)restore(transition.bones,transition.target);
   p.pose=p.controller.sample({...npcPose(e,motionStyle),mode:'ready',phase:0,cooldown:0,stationary:true,dt:step});
   if(!restarting)transition.elapsed+=step;
   const t=Math.min(1,transition.elapsed/.14),weight=t*t*(3-2*t);
   if(t<1){transition.target=capture(transition.bones);transition.bones.forEach((bone,i)=>{const a=transition.from[i],b=transition.target[i];bone.position.lerpVectors(a.p,b.p,weight);bone.quaternion.slerpQuaternions(a.q,b.q,weight);bone.scale.lerpVectors(a.s,b.s,weight);});}
   else{transition.target=null;transition.from=null;}
   transition.lastStagger=e.stagger||0;p.controller.refreshAnchors();
  }else if(dt>0||!p.pose||chargeCamera&&['windup','charge'].includes(e.attack)&&e.actionKind==='charge')p.pose=p.controller.sample({...npcPose(e,motionStyle),dt,chargeCamera,authoritativeThrustTip:thrustTip||null,locomotion:e.attack==='idle'?locomotion:undefined});else p.controller.refreshAnchors();
 }
 // Tutorials contain at most four live actors. Keep those in the same six
 // slots even at wide-screen distance; army range and priority stay unchanged.
 function update(enemies,player,dt,{enabled=true,active=true,applyHitReaction=null,headings=null,locomotion=null,chargeCamera=null,thrustTips=null,retainTutorialActors=false}={}){selected.clear();const facing=headings||motionFacing.update(enemies,player,dt,{active});const owned=new Map(pool.map(p=>[p.id,p]));const priority=e=>e.team==='enemy'&&['windup','charge','leap'].includes(e.attack)?0:e.stagger>0||owned.get(e.id)?.shove?1.5:e.team==='enemy'&&e.attack==='recover'?1:2,imminence=e=>e.attack==='charge'?0:Math.max(0,e.attackTimer||0);const candidates=enabled?enemies.filter(e=>e.alive&&(!(e.stagger>0)||owned.has(e.id))&&(retainTutorialActors||Math.hypot(e.x-player.x,e.z-player.z)<(owned.has(e.id)?22:18))).sort((a,b)=>priority(a)-priority(b)||(priority(a)===0?imminence(a)-imminence(b):0)||(Math.hypot(a.x-player.x,a.z-player.z)-(owned.has(a.id)?2:0))-(Math.hypot(b.x-player.x,b.z-player.z)-(owned.has(b.id)?2:0))||a.id-b.id).slice(0,capacity):[];const chosen=new Set(candidates.map(e=>e.id));for(const p of pool)if(!chosen.has(p.id)){p.root.visible=false;p.id=null;p.shove=null;}
  for(const e of candidates){let p=pool.find(p=>p.id===e.id);if(!p){p=pool.find(p=>p.id===null);p.id=e.id;p.pose=null;p.shove=null;p.controller.reset();}p.root.visible=true;p.root.userData.npcId=e.id;p.root.position.set(e.x,e.y||0,e.z);p.root.rotation.set(0,facing.get(e.id),0);applyHitReaction?.(p.root,e);p.meshes.forEach((mesh,i)=>{mesh.material=p.variants[e.id%2][i];for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])npcBodyColor(m.color,e.team,active?e.hurtFlash:0);});sample(p,e,dt,active,locomotion?.get(e.id),chargeCamera,thrustTips?.get(e.id));selected.add(e.id);}
  return selected;
 }
 function reset(){selected.clear();motionFacing.reset();for(const p of pool){p.id=null;p.pose=null;p.shove=null;p.root.visible=false;p.controller.reset();}}
 return {update,reset,pool,capacity,selected};
}
