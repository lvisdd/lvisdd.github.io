import * as THREE from './vendor/three.module.min.js';

// Presentation only: one 0.22s recoil begins when a damage event is presented.
// This small render-side clock prevents catch-up frames from skipping the cue.
// A single kick and ease-out, with no new stagger, displacement or animation clip.
export function npcHitStrength(hurtFlash){
 if(!Number.isFinite(hurtFlash)||hurtFlash<=0)return 0;
 const remaining=Math.min(.22,hurtFlash),elapsed=.22-remaining;
 return elapsed<.035?.58+.42*(elapsed/.035):Math.pow(remaining/.185,2);
}
const bracesHeldThrust=e=>e.actionKind==='thrust'&&(e.attack==='windup'||e.attack==='recover');
export function createNpcHitReactions(){
 const hits=new Map(),axis=new THREE.Vector3(),kick=new THREE.Quaternion();
 let game=null,playerId;
 function reset(){hits.clear();game=null;playerId=undefined;}
 function sync(g){
  if(game!==g||playerId!==g.playerId){hits.clear();game=g;playerId=g.playerId;}
  if(!g.active||g.won||g.lost){hits.clear();return;}
  const living=new Map(g.enemies.map(e=>[e.id,e]));
  for(const [id,hit] of hits){const e=living.get(id);if(e!==hit.actor||!e.alive||e.team!==hit.team||e.hp!==hit.hp||e.spawnProtection>0||g.time-hit.presentedAt>=.22)hits.delete(id);}
 }
 function note(g,event){
  sync(g);
  if(event.type!=='npc_damage'||!g.active||g.won||g.lost)return;
  const e=g.enemies.find(e=>e.id===event.id);
  if(!e?.alive||e.team!==event.team||e.spawnProtection>0)return;
  let dx=event.hitDx,dz=event.hitDz,length=Math.hypot(dx,dz);
  if(!Number.isFinite(length)||length<1e-6){
   // Older/replayed events can lack direction metadata. Recoil away from the
   // actor's current attack/facing rather than using a stale previous hit.
   const facing=Math.atan2((e.targetX??g.player?.x??e.x)-e.x,(e.targetZ??g.player?.z??e.z)-e.z);
   dx=-Math.sin(facing);dz=-Math.cos(facing);length=1;
  }
  hits.set(e.id,{actor:e,team:e.team,hp:e.hp,presentedAt:g.time,dx:dx/length,dz:dz/length,bracedThrust:bracesHeldThrust(e)});
 }
 function apply(root,e,{quiet=false,active=true}={}){
  const hit=hits.get(e.id);
  if(!active||!e.alive||hit?.actor!==e||hit.team!==e.team||hit.hp!==e.hp||e.spawnProtection>0)return 0;
  const strength=npcHitStrength(.22-Math.max(0,game.time-hit.presentedAt));if(!strength)return 0;
  // Keep attack preparation, charge and leap silhouettes readable. Quiet mode
  // has only a small lean; faction tint remains the primary low-motion cue.
  // A held thrust still needs support during its recover/contact phase.
  // Keep that brace for this hit's lifetime: leaving recovery must not amplify
  // an already-decaying recoil from .13 to .25 without a new impact.
  hit.bracedThrust ||= bracesHeldThrust(e);
  const attacking=['windup','charge','leap'].includes(e.attack)||hit.bracedThrust;
  const angle=strength*(quiet?.065:attacking?.13:.25);
  axis.set(hit.dz,0,-hit.dx);kick.setFromAxisAngle(axis,angle);
  root.quaternion.premultiply(kick);
  return angle;
 }
 return {note,sync,apply,reset};
}
