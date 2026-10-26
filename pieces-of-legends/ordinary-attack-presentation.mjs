// A private visual phrase for already accepted native attacks. This module
// never calls an engine action and never writes into the game or its actors.
export const ORDINARY_ATTACK_PRESENTATION='ordinary-attack-phrase-v1';
const countKeys={thrust:'thrusts',sweep:'sweeps',charge:'charges',jump:'jumps',dragon:'steps'};
const ordinaryActions=new Set(['thrust','sweep']);
const finite=value=>Number.isFinite(value);
export function createOrdinaryAttackPresentation(E,{continuitySeconds=1}={}){
 let game=null,actor=null,actorId=null,piece=null,receipt=null,history=null,sequence=0,lastHits=0,lastHp=null,lastCounters={},lastFacing=null;
 let observedCancels=new WeakSet(),contacts=new WeakMap();const waves=new Map();
 const effectivePiece=g=>E.pieceKey(g);
 const eligible=g=>g&&g.scenario==='army'&&!E.isSpectator(g)&&g.player&&Number.isInteger(g.playerId)&&g.hp>0&&!E.battleEnded(g);
 const counters=g=>Object.fromEntries(Object.values(countKeys).map(key=>[key,Number.isInteger(g[key])?g[key]:0]));
 const face=g=>{const f=g.sweepDirection&&['thrust','sweep'].includes(g.mode)?g.sweepDirection:g.player;return f&&finite(f.dx)&&finite(f.dz)?{dx:f.dx,dz:f.dz}:null;};
 const sameFace=(a,b)=>a&&b&&Math.abs(a.dx-b.dx)<1e-8&&Math.abs(a.dz-b.dz)<1e-8;
 function clearHistory(){history=null;}
 function reset(){game=null;actor=null;actorId=null;piece=null;receipt=null;history=null;sequence=0;lastHits=0;lastHp=null;lastCounters={};lastFacing=null;observedCancels=new WeakSet();contacts=new WeakMap();waves.clear();}
 function live(g,r=receipt){return !!(r&&eligible(g)&&g===game&&g.player===actor&&g.playerId===r.actorId&&effectivePiece(g)===r.piece&&g.mode===r.action&&g[countKeys[r.action]]===r.actionCount);}
 function observe(g,{acceptedAction=null}={}){
  if(!eligible(g)){if(g!==game||receipt||history)reset();return;}
  const nextPiece=effectivePiece(g),nextCounters=counters(g),nextFace=face(g);
  if(g!==game){reset();game=g;}
  if(actor!==g.player||actorId!==g.playerId||piece!==nextPiece){receipt=null;history=null;actor=g.player;actorId=g.playerId;piece=nextPiece;lastHits=g.playerHits||0;lastHp=g.hp;lastCounters=nextCounters;lastFacing=nextFace;}
  if((g.playerHits||0)>lastHits||lastHp!==null&&g.hp<lastHp||g.guarding)clearHistory();
  if(history&&lastFacing&&nextFace&&!sameFace(lastFacing,nextFace))clearHistory();
  for(const [action,key]of Object.entries(countKeys))if(action!==acceptedAction&&nextCounters[key]!==lastCounters[key])clearHistory();
  for(const event of g.events||[])if(event.type==='cancel'&&!observedCancels.has(event)){observedCancels.add(event);if(!acceptedAction)clearHistory();}
  if(receipt&&!live(g))receipt=null;
  lastHits=g.playerHits||0;lastHp=g.hp;lastCounters=nextCounters;lastFacing=nextFace;
 }
 function accepted(g,action,{explicit=false}={}){
  observe(g,{acceptedAction:action});
  if(!eligible(g))return null;
  const count=g[countKeys[action]];
  if(explicit||!ordinaryActions.has(action)){clearHistory();receipt=null;return null;}
  if(g.mode!==action||!Number.isInteger(count)||count<1||!finite(g.time)||!E.heroHasAbility(g,action))return null;
  if(receipt&&receipt.action===action&&receipt.actionCount===count&&live(g))return receipt;
  const facing=face(g),continued=history&&history.action===action&&history.actionCount===count-1&&sameFace(history.facing,facing)&&g.time>=history.time&&g.time-history.time<=continuitySeconds+1e-9;
  const stage=continued?history.stage%3+1:1;
  receipt=Object.freeze({version:ORDINARY_ATTACK_PRESENTATION,enabled:true,clock:'native-action-v1',action,stage,actorId:g.playerId,actionCount:count,actionSerial:++sequence,piece:effectivePiece(g),sourceTeam:'ally'});
  history={action,actionCount:count,stage,time:g.time,facing,actionSerial:receipt.actionSerial};lastFacing=facing;return receipt;
 }
 function view(g){return live(g)?receipt:null;}
 function breakChain(actionSerial=null){if(actionSerial!==null&&actionSerial!==history?.actionSerial&&actionSerial!==receipt?.actionSerial)return;clearHistory();}
 function noteFrame(g,acceptedFrame=null){
  if(g!==game){observe(g);return;}
  // Release receipts are captured before processing damage, including a hit
  // produced in the same simulation step. Old travelling waves keep their own
  // source identity even after the hero has started another attack.
  const current=acceptedFrame&&acceptedFrame===receipt?acceptedFrame:view(g);
  for(const event of g.events||[]){
   if(event.type==='attack_release'&&Number.isSafeInteger(event.waveId))waves.delete(event.waveId);
   if(event.type==='attack_release'&&event.personal===true&&current&&event.sourceId===current.actorId&&event.kind===current.action&&Number.isSafeInteger(event.waveId))waves.set(event.waveId,{...current,game:g,sourceId:event.sourceId,engineAction:event.action});
  }
  const damage=(g.events||[]).filter(e=>e.personal===true&&['hit','npc_damage'].includes(e.type));
  for(const event of g.events||[]){const meta=waves.get(event.waveId);if(!meta||event.sourceId!==meta.sourceId||event.action!==meta.engineAction||event.personal!==true||event.team!=='enemy')continue;
   const damaging=['hit','npc_damage'].includes(event.type)||event.type==='thrust_contact'&&!event.blocked&&damage.some(hit=>hit.waveId===event.waveId&&hit.sourceId===event.sourceId&&hit.id===event.targetId);
   if(damaging)contacts.set(event,{game:g,stage:meta.stage,waveId:event.waveId,sourceId:event.sourceId,action:event.action,team:event.team});
  }
  const active=new Set((g.waves||[]).map(w=>w.id));for(const id of waves.keys())if(!active.has(id))waves.delete(id);
  const capturedContacts=contacts;observe(g);if(!eligible(g))contacts=capturedContacts;
 }
 function contactStage(g,event){const c=event&&contacts.get(event);return c?.game===g&&c.waveId===event.waveId&&c.sourceId===event.sourceId&&c.action===event.action&&c.team===event.team&&event.personal===true&&!event.blocked?c.stage:0;}
 return{accepted,view,observe,noteFrame,contactStage,breakChain,reset};
}
