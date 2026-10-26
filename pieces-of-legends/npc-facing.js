// Read the army selector's last authoritative identity, never its route point.
// Null means no combat facing owner. Generic no-strategy fixtures keep their
// existing target-coordinate contract and do not opt into this army adapter.
export function npcCombatFacingTargets(g){
 if(!g.strategies)return null;
 const roster=new Map(g.enemies.map(e=>[e.id,e])),targets=new Map();
 for(const e of g.enemies){
  const t=e.intentTargetId==='hero'?g.player:roster.get(e.intentTargetId);
  const current=e.alive&&!e.trainingGuard&&!(e.stagger>0)&&!(e.spawnProtection>0);
  const hostile=t&&t!==e&&(t.team||'enemy')!==(e.team||'enemy');
  const alive=t===g.player?g.hp>0&&t.alive!==false:t?.alive&&(t.hp??1)>0;
  targets.set(e.id,current&&hostile&&alive&&Number.isFinite(t.x)&&Number.isFinite(t.z)?{x:t.x,z:t.z}:null);
 }
 return targets;
}

// Render-only headings. Observe every NPC, including the distant instance LOD,
// so a newly assigned skeleton starts with the same heading as its last frame.
export function createNpcFacing(){
 let previous=new WeakMap();
 const headings=new Map(),committed=e=>['windup','charge','recover','leap'].includes(e.attack);
 const direction=(x,z,fallback)=>Math.hypot(x,z)>1e-5?Math.atan2(x,z):fallback;
 function update(enemies,player,dt,{active=true,combatTargets=null}={}){
  headings.clear();
  for(const e of enemies){
   const old=previous.get(e),same=old&&old.team===e.team&&old.alive&&e.alive;
   const home=e.team==='ally'?Math.PI:0;
   const combatOwned=combatTargets?.has(e.id),liveTarget=combatOwned?combatTargets.get(e.id):null;
   const initial=combatOwned&&!Object.hasOwn(e,'intentTargetId')?home:direction(e.aimDx||0,e.aimDz||0,home);
   const fallback=same?old.yaw:initial;
   const target=combatOwned?(liveTarget?direction(liveTarget.x-e.x,liveTarget.z-e.z,fallback):fallback):direction((e.targetX??player.x)-e.x,(e.targetZ??player.z)-e.z,fallback);
   const grounded=e.alive&&Math.abs(e.y||0)<.001&&!(e.stagger>0);
   let yaw=target;
   if(!active)yaw=home;
   else if(committed(e))yaw=direction(e.aimDx||0,e.aimDz??1,fallback);
   else if(same&&dt<=0)yaw=old.yaw;
   else if(same&&grounded&&old.grounded&&!(e.spawnProtection>0)&&dt>0)yaw=direction(e.x-old.x,e.z-old.z,target);
   headings.set(e.id,yaw);
   // Zero-time redraws update anchors without inventing travel on resume.
   previous.set(e,{x:e.x,z:e.z,team:e.team,alive:e.alive,grounded,yaw});
  }
  return headings;
 }
 function reset(){previous=new WeakMap();headings.clear();}
 return {update,reset};
}
