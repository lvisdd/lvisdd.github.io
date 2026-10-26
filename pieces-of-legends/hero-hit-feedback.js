import * as THREE from './vendor/three.module.min.js';

// Presentation only. Start when player_hit reaches the renderer, so a catch-up
// frame cannot consume the cue before it is shown. Simulation time freezes it
// on pause; no actor, attack, collision or authoritative timer is changed.
export function createHeroHitFeedback(){
 let hit=null;
 const warm=new THREE.Color('#ff5941');
 const reset=()=>{hit=null;};
 function valid(g){
  const lethal=hit?.lethal&&g.lost&&g.lossReason==='hero'&&g.hp===0;
  return hit?.game===g&&hit.actor===g.player&&hit.playerId===g.playerId&&hit.hp===g.hp&&
   !g.won&&(!g.lost||lethal)&&(g.active||lethal)&&!(g.player.spawnProtection>0)&&
   Number.isFinite(g.time)&&g.time>=hit.at&&g.time-hit.at<.22;
 }
 function note(g,event){
  if(event.type!=='player_hit'||!g.player||!Number.isFinite(g.time))return false;
  hit={game:g,actor:g.player,playerId:g.playerId,hp:g.hp,at:g.time,lethal:event.hp===0};
  if(!valid(g)){reset();return false;}
  return true;
 }
 function strength(g){
  if(!valid(g)){reset();return 0;}
  return (1-(g.time-hit.at)/.22)**2;
 }
 // Caller resets its root rotation each draw. Apply BEFORE sampling the rig so
 // world-space hand anchors and weapon accents include the same flinch.
 function apply(root,g,{quiet=false}={}){
  const amount=strength(g);
  if(amount)root.rotateX(-amount*(quiet?.035:.20));
  return amount;
 }
 // Call AFTER the existing base + promotion material assignment on every draw.
 // This composes with promotion and lets that assignment restore exact values.
 function tint(material,amount,{quiet=false}={}){
  if(!material?.emissive||!Number.isFinite(amount)||amount<=0)return;
  amount=Math.min(1,amount);
  material.emissive.lerp(warm,amount*(quiet?.45:.8));
  material.emissiveIntensity+=amount*(quiet?.22:.8);
 }
 return {note,strength,apply,tint,reset};
}
