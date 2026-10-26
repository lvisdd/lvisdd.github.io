// Paused 2D overview controls. State comes from the engine; no combat writes here.
import {tacticalMapLayout} from './tactical-map.mjs';
export function createTacticalControlMap(root,E,activate,doc){
 let signature='',buttons=[];
 function update(g,map,canUse){
  const entries=g.enemies.filter(e=>e.alive).map(e=>({id:e.id,piece:e.piece,team:e.team||'enemy',hp:e.hp,maxHp:e.maxHp,x:e.x,z:e.z,reason:canUse?E.switchControlReason(g,e.id):'unavailable'}));
  if(g.player)entries.push({id:g.playerId,piece:g.piece,team:'player',hp:g.hp,maxHp:g.maxHp,x:g.player.x,z:g.player.z,reason:'player'});
  const next=JSON.stringify([g.gameId,map.arena,canUse,entries]);if(next===signature)return;signature=next;
  const focused=buttons.find(b=>b===doc.activeElement)?.dataset.actorId;root.replaceChildren();buttons=[];const {point}=tacticalMapLayout(map,120,144);
  for(const e of entries){const allowed=e.team==='ally'&&!e.reason,button=doc.createElement(allowed?'button':'span'),q=point(e.x,e.z),piece=E.PIECES[e.piece]||{glyph:'?',name:'駒'};
   button.className='tactical-unit tactical-unit-'+e.team;button.style.left=(q.x/120*100)+'%';button.style.top=(q.y/144*100)+'%';button.dataset.actorId=String(e.id);button.textContent=piece.glyph+' '+e.hp;button.title=(e.team==='player'?'操作中':e.team==='ally'?'味方':'敵')+' '+piece.name+' 体力 '+e.hp+'/'+e.maxHp+(e.reason&&e.team==='ally'?'（'+({'protected-king':'護衛対象の王','hero-busy':'操作中の駒が動作中','target-busy':'味方が動作中'}[e.reason]||'交代不可')+'）':'');
   if(allowed){button.type='button';button.setAttribute('aria-label',piece.name+' 体力 '+e.hp+'/'+e.maxHp+' に交代');button.onclick=event=>{event.preventDefault();event.stopPropagation();activate(e.id);};buttons.push(button);}else button.setAttribute('aria-label',button.title);
   root.appendChild(button);
  }
  buttons.find(b=>b.dataset.actorId===focused)?.focus({preventScroll:true});
 }
 return {update,focusable(){return buttons;}};
}
