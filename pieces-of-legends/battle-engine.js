/* Original deterministic action simulation. x = screen right, -z = screen up. */
(function(root){'use strict';
const CAP=root.PieceCapabilities||(typeof require==='function'?require('./capability-runtime.js'):null);
// Optional authored-board center bounds. Missing options retain the historical
// game shape and every default clamp. A board renderer should read this same
// rectangle, adding only its decorative/body-radius lip outside it.
const DEFAULT_ARENA=Object.freeze({minX:-19,maxX:19,minZ:-24,maxZ:34});
// Formation-aware army play rotates around (0,15). Keep the legacy authoring
// envelope for generic diagnostics, but give every actual army a square board.
const STANDARD_ARMY_ARENA=Object.freeze({minX:-19,maxX:19,minZ:-4,maxZ:34});
const ARMY_ARENA_RULESET='standard-square-army-v1';
// Spectators have no controlled body. Every combatant belongs to the NPC roster.
function isSpectator(g){return g?.controlMode==='spectator';}
function battleEnded(g){return !!(g?.won||g?.lost||g?.draw);}
function isStandardArmyArena(g){return g?.scenario==='army'&&g.formationHero===true&&g.armyArenaRuleset===ARMY_ARENA_RULESET&&g.arena&&Object.keys(STANDARD_ARMY_ARENA).every(k=>g.arena[k]===STANDARD_ARMY_ARENA[k]);}
function arenaBounds(g){return g?.arena||DEFAULT_ARENA;}
function terrainLayout(g){return {...Terrain.LAYOUT,arena:arenaBounds(g)};}
function arenaContains(g,p,eps=0){const a=arenaBounds(g);return Number.isFinite(p?.x)&&Number.isFinite(p?.z)&&p.x>=a.minX-eps&&p.x<=a.maxX+eps&&p.z>=a.minZ-eps&&p.z<=a.maxZ+eps;}
function arenaClip(g,a,b){
 if(!arenaContains(g,a,1e-7)||!Number.isFinite(b?.x)||!Number.isFinite(b?.z))return {point:{x:a.x,z:a.z},t:0,blocked:true,reason:'invalid-start'};
 const r=arenaBounds(g);let t=1;
 for(const [key,min,max] of [['x',r.minX,r.maxX],['z',r.minZ,r.maxZ]]){const d=b[key]-a[key],u=b[key]<min?(min-a[key])/d:b[key]>max?(max-a[key])/d:1;t=Math.min(t,Math.max(0,u));}
 return {point:{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},t,blocked:t<1,reason:t<1?'arena':null};
}
function validateArena(value){
 const keys=['minX','maxX','minZ','maxZ'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==4||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(value,k);return !d||!Object.prototype.hasOwnProperty.call(d,'value')||!Number.isFinite(d.value);}))throw new TypeError('Arena requires four finite numeric bounds');
 const a=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(value,k).value]));
 if(a.minX<DEFAULT_ARENA.minX||a.maxX>DEFAULT_ARENA.maxX||a.minZ<DEFAULT_ARENA.minZ||a.maxZ>DEFAULT_ARENA.maxZ||a.maxX-a.minX<6||a.maxZ-a.minZ<6)throw new RangeError('Arena must fit the default arena and span at least six units on both axes');
 return Object.freeze(a);
}
function installArena(g,value){
 // Author deployment first, then seal one rectangle before play. This is not
 // a mid-match resize API, nor a way to silently clamp authored spawns.
 if(!g||g.time!==0||g.active||g.mode!=='ready'||battleEnded(g)||g.score||g.waves.length||['charges','sweeps','steps','thrusts','jumps'].some(k=>g[k])||Object.prototype.hasOwnProperty.call(g,'arena'))throw new Error('Arena can only be installed once on a pristine inactive game');
 const arena=validateArena(value),view={arena},actors=[...(g.player?[g.player]:[]),...g.enemies.filter(e=>e.alive)];
 for(const p of actors){if(!arenaContains(view,p)||!arenaContains(view,{x:p.homeX,z:p.homeZ}))throw new RangeError('Arena excludes an authored actor or home');}
 if(g.scenario==='army'){
  const slots=new Set(g.enemies.filter(e=>e.piece!=='king'&&!e.trainingGuard).map(e=>e.slotKey));if(g.piece!=='king'&&g.player?.slotKey!=null)slots.add(g.player.slotKey);
  for(const slotKey of slots)for(const team of ['ally','enemy']){const slot=g.formationSlots.find(s=>s.slotKey===slotKey&&s.team===team);if(!slot||!arenaContains(view,slot))throw new RangeError('Arena excludes a canonical conversion destination');}
 }
 Object.defineProperty(g,'arena',{value:arena,enumerable:true,writable:false,configurable:false});return g;
}
const Terrain=(()=>{
// Shared river/bridge geometry. Actor centers select walking speed; bodies
// retain their ordinary collision radii and all water remains passable.
const BRIDGES=Object.freeze([[-12.4,-8],[-2.2,2.2],[8,12.4]].map(Object.freeze));
const WATER=Object.freeze([[-19,-12.4],[-8,-2.2],[2.2,8],[12.4,19]].map(([l,r])=>Object.freeze({l,r,b:10,t:20})));
const EPS=1e-10,valid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z);
const inArena=p=>valid(p)&&p.x>=-19-EPS&&p.x<=19+EPS&&p.z>=-24-EPS&&p.z<=34+EPS;
const waterPoint=p=>valid(p)&&p.z>10&&p.z<20&&!BRIDGES.some(([l,r])=>p.x>=l&&p.x<=r);
function dryBody(p,r=.6,mode='plain'){
 if(!valid(p)||!Number.isFinite(r)||r<0)return false;if(mode==='plain')return true;if(mode!=='river')throw Error('Unknown terrain');
 return inArena(p)&&WATER.every(q=>r===0?!(p.x>q.l&&p.x<q.r&&p.z>q.b&&p.z<q.t):Math.max(q.l-p.x,0,p.x-q.r)**2+Math.max(q.b-p.z,0,p.z-q.t)**2>=r*r-EPS);
}
function passable(p,mode='plain'){if(mode==='plain')return valid(p);if(mode!=='river')throw Error('Unknown terrain');return inArena(p);}
function clipSegment(a,b,r=.6,mode='plain'){
 if(!valid(a)||!valid(b)||!Number.isFinite(r)||r<0)throw Error('Invalid geometry');
 if(mode==='plain')return {point:{...b},t:1,blocked:false};
 if(!passable(a,mode))return {point:{...a},t:0,blocked:true,reason:'invalid-start'};
 let t=1;for(const [key,min,max] of [['x',-19,19],['z',-24,34]]){const d=b[key]-a[key],u=b[key]<min?(min-a[key])/d:b[key]>max?(max-a[key])/d:1;t=Math.min(t,Math.max(0,u));}
 return {point:{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},t,blocked:t<1,reason:t<1?'arena':null};
}
const passableSegment=(a,b,r=.6,mode='plain')=>passable(a,mode)&&passable(b,mode);
// Dry remains an informational geometric predicate, never a movement gate.
function drySegment(a,b,r=.6,mode='plain'){
 if(mode==='plain')return valid(a)&&valid(b);if(!dryBody(a,r,mode)||!dryBody(b,r,mode))return false;
 // Exact segment-to-rectangle distance is attained at a segment endpoint or
 // rectangle vertex, unless the segment enters the rectangle itself.
 const vx=b.x-a.x,vz=b.z-a.z,L=vx*vx+vz*vz;
 for(const q of WATER){let lo=0,hi=1;for(const [s,d,min,max] of [[a.x,vx,q.l,q.r],[a.z,vz,q.b,q.t]]){if(!d){if(s<=min||s>=max){lo=1;hi=0;break;}}else{let x=(min-s)/d,y=(max-s)/d;if(x>y)[x,y]=[y,x];lo=Math.max(lo,x);hi=Math.min(hi,y);}}
  if(lo<hi&&hi>0&&lo<1)return false;
  if(r>0)for(const x of [q.l,q.r])for(const z of [q.b,q.t]){const u=L?Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/L)):0;if((a.x+vx*u-x)**2+(a.z+vz*u-z)**2<r*r-EPS)return false;}
 }return true;
}
function segments(a,b){
 const dx=b.x-a.x,dz=b.z-a.z,ts=[0,1];
 for(const [s,d,edges] of [[a.x,dx,BRIDGES.flat()],[a.z,dz,[10,20]]])if(d)for(const edge of edges){const t=(edge-s)/d;if(t>0&&t<1)ts.push(t);}
 ts.sort((a,b)=>a-b);const out=[];
 for(let i=1;i<ts.length;i++){const from=ts[i-1],to=ts[i];if(to<=from)continue;const mid=(from+to)/2;out.push({from,to,speed:waterPoint({x:a.x+dx*mid,z:a.z+dz*mid})?.5:1});}return out;
}
// Budget is dry-equivalent distance (speed * elapsed time). Partition at every
// exact bank/bridge crossing and spend twice the budget on water distance.
function advance(a,b,budget){
 if(!valid(a)||!valid(b)||!Number.isFinite(budget)||budget<0)throw Error('Invalid movement');
 const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(!length||!budget)return {x:a.x,z:a.z};
 let t=0,left=budget;for(const part of segments(a,b)){const cost=(part.to-part.from)*length/part.speed;if(left<cost){t=part.from+left*part.speed/length;left=0;break;}left-=cost;t=part.to;}
 return {x:a.x+dx*t,z:a.z+dz*t};
}
function motion(start,end,speed,delay=0){
 const dx=end.x-start.x,dz=end.z-start.z,length=Math.hypot(dx,dz),timeline=[{x:start.x,z:start.z,t:0}];let t=0;
 if(length&&speed>0)for(const part of segments(start,end)){t+=(part.to-part.from)*length/(speed*part.speed);timeline.push({x:start.x+dx*part.to,z:start.z+dz*part.to,t});}
 return {start,end,moveDt:t,delay,timeline};
}
function legalLeg(a,b,dirs,team='ally'){const x=b.x-a.x,z=b.z-a.z,s=team==='enemy'?-1:1;if(Math.hypot(x,z)<1e-10)return true;return dirs.some(([u,v])=>Math.abs(x*v-z*u)<=64*Number.EPSILON*Math.max(1,Math.hypot(x,z))&&(x*u+z*v)*s>0);}
function validateJump(a,b,{knight=false,team='ally',radius=.6,mode='plain'}={}){if(knight&&(Math.abs(Math.abs(b.x-a.x)-3)>1e-9||Math.abs(b.z-a.z-(team==='ally'?-6:6))>1e-9))return false;return passableSegment(a,b,radius,mode);}
// Water no longer forces detours. Retain the pure legal-route API for callers.
function planRoute(a,b,dirs,team='ally',r=.6,mode='plain'){
 if(!passableSegment(a,b,r,mode))return null;if(legalLeg(a,b,dirs,team))return[a,b];
 const s=team==='enemy'?-1:1,d=dirs.map(([x,z])=>[x*s,z*s]),out=[];
 for(const [ux,uz] of d)for(const [vx,vz] of d){const det=ux*vz-uz*vx;if(!det)continue;const dx=b.x-a.x,dz=b.z-a.z,t=(dx*vz-dz*vx)/det,u=(ux*dz-uz*dx)/det;if(t>1e-9&&u>1e-9){const q={x:a.x+ux*t,z:a.z+uz*t};if(passable(q,mode))out.push([a,q,b]);}}
 return out.sort((a,b)=>Math.hypot(a[1].x-a[0].x,a[1].z-a[0].z)+Math.hypot(a[2].x-a[1].x,a[2].z-a[1].z)-Math.hypot(b[1].x-b[0].x,b[1].z-b[0].z)-Math.hypot(b[2].x-b[1].x,b[2].z-b[1].z))[0]||null;
}
return {BRIDGES,WATER,LAYOUT:Object.freeze({key:'three_bridges',river:Object.freeze({minZ:10,maxZ:20}),arena:Object.freeze({minX:-19,maxX:19,minZ:-24,maxZ:34}),bridges:BRIDGES,bodyRadius:.6,waterSpeed:.5}),dryBody,drySegment,passable,passableSegment,waterPoint,segments,advance,motion,clipSegment,validateJump,planRoute,legalLeg};})();
const WALK_SPEED=5.5,RUN_SPEED=7.2,CHARGE_SPEED=18,FILE_SPACING=3.4,RANK_SPACING=3.8;
const MAX_NPCS=40,RESPAWN_DELAY=3.5;
// OFF-only authority. Public metadata is descriptive; copied worlds/bodies never
// acquire tickets. ON worlds allocate no state and retain their original shape.
const CAPTURED_RETURN_POLICY=Object.freeze({version:'held-ally-v1',ally:'manual-type',enemy:'automatic-v124'});
const capturedReturnStates=new WeakMap();let nextCapturedReturnGameId=0;
const CAPTURED_RETURN_PIECES=Object.freeze(['pawn','lance','knight','silver','gold','bishop','rook']);
function automaticAllyReturnOption(options){
 if(options===null||(typeof options!=='object'&&typeof options!=='function'))throw new TypeError('Battle options must be an object');
 // Inspect descriptors before the mission option spread could invoke a getter.
 let owner=options,field;while(owner&&!field){field=Object.getOwnPropertyDescriptor(owner,'automaticAllyReturn');owner=Object.getPrototypeOf(owner);}
 if(field&&!Object.prototype.hasOwnProperty.call(field,'value'))throw new TypeError('automaticAllyReturn must be a data option');
 const value=field?.value;if(value!==undefined&&value!==true&&value!==false)throw new TypeError('automaticAllyReturn must be boolean');
 return value!==false;
}
function installCapturedReturn(g){
 Object.defineProperty(g,'capturedReturnPolicy',{value:CAPTURED_RETURN_POLICY,enumerable:true,writable:false,configurable:false});
 capturedReturnStates.set(g,{gameId:++nextCapturedReturnGameId,revision:0,sequence:0,tickets:new Map(),lives:new WeakMap(),selectedToken:null,terminated:false});
}
function capturedReturnBase(e){if(typeof e?.piece!=='string'||!Object.hasOwn(PIECES,e.piece))return null;return Object.keys(PIECES).find(key=>PIECES[key].promote===e.piece)||e.piece;}
function capturedReturnIdentity(g,e,id=e.id,slotKey=e.slotKey){
 return Array.isArray(g.enemies)&&g.enemies.filter(unit=>unit===e).length===1&&g.enemies.filter(unit=>unit.id===id).length===1&&g.playerId!==id&&g.player!==e&&Number.isSafeInteger(id)&&id>=0&&Number.isInteger(slotKey)&&slotKey>=0&&slotKey<20&&e.id===id&&e.slotKey===slotKey;
}
function capturedReturnTicketValid(g,state,ticket){
 const e=ticket.actor,selected=state.selectedToken===ticket.token;
 return state.tickets.get(ticket.token)===ticket&&state.lives.get(e)===ticket.life&&capturedReturnIdentity(g,e,ticket.id,ticket.slotKey)&&e.alive===false&&e.hp===0&&e.team===ticket.captureTeam&&ticket.captureTeam==='enemy'&&ticket.owner==='ally'&&CAPTURED_RETURN_PIECES.includes(ticket.piece)&&capturedReturnBase(e)===ticket.piece&&e.piece===ticket.form&&(e.basePiece==null||e.basePiece===ticket.piece)&&Number.isFinite(ticket.capturedAt)&&ticket.readyAt===ticket.capturedAt+RESPAWN_DELAY&&(selected?e.pendingTeam==='ally'&&e.respawnAt===ticket.readyAt:e.pendingTeam===null&&e.respawnAt===null);
}
function capturedReturnHome(g,ticket){
 const homes=g.formationSlots?.filter(slot=>slot.team===ticket.owner&&slot.slotKey===ticket.slotKey);
 return homes?.length===1&&terrainDry(g,homes[0])?homes[0]:null;
}
function capturedReturnHomeLegal(g,ticket){
 const pos=capturedReturnHome(g,ticket);if(!pos||g.player&&Math.hypot(pos.x-g.player.x,pos.z-g.player.z)<2.3)return false;
 // Native v124 revival checks actual bodies, not moving refill reservations.
 return !g.enemies.some(e=>e!==ticket.actor&&e.alive&&Math.hypot(e.x-pos.x,e.z-pos.z)<1.5);
}
function capturedReturnSummary(g){
 const state=capturedReturnStates.get(g);if(!state)return {enabled:false};
 return {enabled:true,gameId:state.gameId,revision:state.revision,selectedToken:state.selectedToken,tickets:[...state.tickets.values()].map(t=>({token:t.token,id:t.id,slotKey:t.slotKey,piece:t.piece,captureTeam:t.captureTeam,owner:t.owner,capturedAt:t.capturedAt,readyAt:t.readyAt,status:state.selectedToken===t.token?'selected':'held'}))};
}
function capturedReturnResult(state,accepted,reason){return {accepted,reason,gameId:state?.gameId??null,revision:state?.revision??null};}
function capturedReturnRequestReason(g,state,expected){
 if(!state)return 'disabled';if(state.terminated||battleEnded(g))return 'battle-ended';if(!g.active)return 'inactive';
 if(!expected||typeof expected!=='object'||Array.isArray(expected)||Reflect.ownKeys(expected).length!==2)return 'invalid-expected';
 const gameId=Object.getOwnPropertyDescriptor(expected,'gameId'),revision=Object.getOwnPropertyDescriptor(expected,'revision');
 if(!gameId||!revision||!Object.hasOwn(gameId,'value')||!Object.hasOwn(revision,'value')||!Number.isSafeInteger(gameId.value)||!Number.isSafeInteger(revision.value))return 'invalid-expected';
 if(gameId.value!==state.gameId)return 'stale-game';if(revision.value!==state.revision)return 'stale-revision';
 if(g.scenario!=='army'||g.formationHero!==true||isSpectator(g)||!g.player||g.player.alive===false||!(g.hp>0))return 'invalid-state';
 if(state.selectedToken!==null&&!state.tickets.has(state.selectedToken)||[...state.tickets.values()].some(t=>!capturedReturnTicketValid(g,state,t)))return 'invalid-ticket';
 return '';
}
// Only vacancies actually removed because of this selection may be restored.
// Recheck current geometry and all ordinary reservations, without planning AI.
function capturedReturnRestoreIds(g,ticket){
 const ids=[];for(const [id,record] of ticket.suppressed){
  const slot=g.formationSlots.find(s=>s.id===id);
  if(slot!==record||g.formationSlots.filter(s=>s.id===id).length!==1||slot.team!==ticket.owner||slot.slotKey!==ticket.slotKey||!terrainDry(g,slot)||g.vacancies.includes(id)||g.player&&Math.hypot(g.player.x-slot.x,g.player.z-slot.z)<.8)continue;
  if(g.enemies.some(e=>e.alive&&(e.reinforceTarget===id||Math.hypot(e.x-slot.x,e.z-slot.z)<.8)||e!==ticket.actor&&!e.alive&&e.pendingTeam===slot.team&&e.slotKey===slot.slotKey))continue;
  ids.push(id);
 }return ids;
}
function requestCapturedReturn(g,piece,expected){
 const state=capturedReturnStates.get(g),reason=capturedReturnRequestReason(g,state,expected);if(reason)return capturedReturnResult(state,false,reason);
 if(!CAPTURED_RETURN_PIECES.includes(piece))return capturedReturnResult(state,false,'invalid-piece');
 const old=state.tickets.get(state.selectedToken);if(old?.piece===piece)return capturedReturnResult(state,false,'already-selected');
 const rank=t=>g.time<t.readyAt?2:capturedReturnHomeLegal(g,t)?0:1;
 const candidates=[...state.tickets.values()].filter(t=>t.piece===piece).sort((a,b)=>rank(a)-rank(b)||a.readyAt-b.readyAt||a.id-b.id||a.life-b.life),ticket=candidates[0];
 if(!ticket)return capturedReturnResult(state,false,'empty-stock');
 const restore=[],carry=[];if(old)for(const id of capturedReturnRestoreIds(g,old)){const slot=old.suppressed.get(id);if(slot.team===ticket.owner&&slot.slotKey===ticket.slotKey)carry.push([id,slot]);else restore.push(id);}
 // All validation and choice finish before the first mutation.
 if(old){old.actor.pendingTeam=null;old.actor.respawnAt=null;old.suppressed.clear();}
 ticket.actor.pendingTeam=ticket.owner;ticket.actor.respawnAt=ticket.readyAt;state.selectedToken=ticket.token;
 // Same-home replacement keeps the provenance of an already suppressed ID.
 for(const [id,slot] of carry)ticket.suppressed.set(id,slot);
 for(const id of restore)g.vacancies.push(id);state.revision++;return capturedReturnResult(state,true,old?'replaced':'selected');
}
function cancelCapturedReturn(g,expected){
 const state=capturedReturnStates.get(g),reason=capturedReturnRequestReason(g,state,expected);if(reason)return capturedReturnResult(state,false,reason);
 const ticket=state.tickets.get(state.selectedToken);if(!ticket)return capturedReturnResult(state,false,'no-selection');
 const restore=capturedReturnRestoreIds(g,ticket);
 ticket.actor.pendingTeam=null;ticket.actor.respawnAt=null;state.selectedToken=null;ticket.suppressed.clear();
 for(const id of restore)g.vacancies.push(id);state.revision++;return capturedReturnResult(state,true,'cancelled');
}
function holdCapturedReturn(g,e){
 const state=capturedReturnStates.get(g);if(!state||e.team!=='enemy')return false;
 const piece=capturedReturnBase(e);
 // An invalid OFF body must never fall through into automatic ally revival.
 if(state.terminated||battleEnded(g)||!capturedReturnIdentity(g,e)||e.alive!==false||e.hp!==0||!CAPTURED_RETURN_PIECES.includes(piece)||(e.basePiece!=null&&e.basePiece!==piece)||!Number.isFinite(g.time))return true;
 const life=++state.sequence,token=`${state.gameId}:${life}`;
 for(const [key,prior] of state.tickets)if(prior.actor===e||prior.id===e.id){state.tickets.delete(key);if(state.selectedToken===key)state.selectedToken=null;}
 e.pendingTeam=null;e.respawnAt=null;state.lives.set(e,life);
 state.tickets.set(token,{token,life,actor:e,id:e.id,slotKey:e.slotKey,piece,form:e.piece,captureTeam:e.team,owner:'ally',capturedAt:g.time,readyAt:g.time+RESPAWN_DELAY,suppressed:new Map()});state.revision++;return true;
}
function capturedReturnBeforeRespawn(g,e){
 const state=capturedReturnStates.get(g);if(!state)return null;
 const ticket=state.tickets.get(state.selectedToken),owned=[...state.tickets.values()].some(t=>t.actor===e||t.id===e.id);
 if(e.pendingTeam!=='ally'&&!owned)return null;
 if(state.terminated||battleEnded(g)||!g.active||!ticket||ticket.actor!==e||!capturedReturnTicketValid(g,state,ticket)||g.time<ticket.readyAt||!capturedReturnHomeLegal(g,ticket))return false;
 return ticket;
}
function consumeCapturedReturn(g,ticket){
 if(!ticket)return;const state=capturedReturnStates.get(g),e=ticket.actor;
 if(!state||state.tickets.get(ticket.token)!==ticket||state.selectedToken!==ticket.token||state.lives.get(e)!==ticket.life||!capturedReturnIdentity(g,e,ticket.id,ticket.slotKey)||!e.alive||e.team!==ticket.owner||e.piece!==ticket.piece)throw new Error('Captured return success identity mismatch');
 state.tickets.delete(ticket.token);state.selectedToken=null;state.revision++;
}
function rememberCapturedReturnVacancy(g,id,slot,reserved){
 const state=capturedReturnStates.get(g),ticket=state?.tickets.get(state.selectedToken);
 if(!ticket||!slot||!capturedReturnTicketValid(g,state,ticket)||slot.team!==ticket.owner||slot.slotKey!==ticket.slotKey||reserved.has(id)||g.player&&Math.hypot(g.player.x-slot.x,g.player.z-slot.z)<.8)return;
 if(g.enemies.some(e=>e!==ticket.actor&&!e.alive&&e.pendingTeam===slot.team&&e.slotKey===slot.slotKey)||g.enemies.some(e=>e.alive&&!(e.stagger>0)&&Math.hypot(e.x-slot.x,e.z-slot.z)<.8))return;
 ticket.suppressed.set(id,slot);
}
function finishCapturedReturn(g){const state=capturedReturnStates.get(g);if(!state||state.terminated)return;state.tickets.clear();state.selectedToken=null;state.terminated=true;state.revision++;}

const AGILITY={slow:.8,normal:1,fast:1.2};
function normalizeTeamStats(value){const out={};for(const team of ['ally','enemy']){const v=value?.[team]||{};out[team]={hp:[1,2,3,5].includes(v.hp)?v.hp:3,equipment:v.equipment==='heavy'?'heavy':'light',agility:Object.prototype.hasOwnProperty.call(AGILITY,v.agility)?v.agility:'normal'};}return out;}
// App equipment presets own HP and agility; generic engine fixtures may still use normalizeTeamStats.
function equipmentTeamStats(value){const out={};for(const team of ['ally','enemy']){const heavy=value?.[team]?.equipment==='heavy';out[team]={hp:heavy?3:2,equipment:heavy?'heavy':'light',agility:heavy?'slow':'normal'};}return out;}
function movementSpeed(g,team='ally',run=true){const v=g.teamStats?.[team];return (run&&v?.equipment!=='heavy'?RUN_SPEED:WALK_SPEED)*(AGILITY[v?.agility]||1);}
const DIFFICULTIES={easy:{name:'やさしい',hp:7,engage:7.2,windup:.95,attackers:2,reload:2.9},normal:{name:'標準',hp:5,engage:8,windup:.75,attackers:3,reload:2.4},hard:{name:'手ごわい',hp:4,engage:9,windup:.6,attackers:4,reload:2.0}};
// Explicit army equipment cadence. Keep the controlled hero on its authored clock.
// Tutorials and unconfigured legacy fixtures retain their previous behavior.
// The attack warning is never below .45 s. Recovery and active geometry are
// retained; the reload timer includes recovery rather than adding to it.
const EQUIPMENT_CADENCE_RULESET='light-hp2-cadence-v1';
const LIGHT_ATTACK_CADENCE=Object.freeze({windupScale:.8,reloadScale:.425,warningFloor:.45});
function npcEquipmentTiming(g,e){
 const difficulty=DIFFICULTIES[g.difficulty||'normal'];
 const windup=g.scenario==='army'&&g.difficulty==='normal'?.6:difficulty.windup;
 const light=g.equipmentCadenceRuleset===EQUIPMENT_CADENCE_RULESET&&e.equipment==='light';
 return {windup:light?Math.max(LIGHT_ATTACK_CADENCE.warningFloor,windup*LIGHT_ATTACK_CADENCE.windupScale):windup,reloadScale:light?LIGHT_ATTACK_CADENCE.reloadScale:1};
}
function npcEquipmentReload(g,e,seconds){return Math.max(.45,seconds*npcEquipmentTiming(g,e).reloadScale);}
// Initial roster staggering remains; stable actor IDs do not change sustained DPS.
function npcOrdinaryReload(g,e){const base=DIFFICULTIES[g.difficulty||'normal'].reload,variation=g.equipmentCadenceRuleset===EQUIPMENT_CADENCE_RULESET?0:(e.id%4)*.17;return npcEquipmentReload(g,e,base+variation);}
const SLASH_LIFE=.39,SLASH_OPEN_DELAY=.05,SLASH_TRAVEL=8*(SLASH_LIFE-.035),SLASH_SPEED=SLASH_TRAVEL/(SLASH_LIFE-.035-SLASH_OPEN_DELAY);
const COUNT=20,STEP_DISTANCE=3,SWEEP_DURATION=.46,SWEEP_WINDUP=.125,SWEEP_HIT_START=.19,SWEEP_HIT_END=.276,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const C=[[0,-1],[1,0],[0,1],[-1,0]],D=[[-1,-1],[1,-1],[-1,1],[1,1]],G=[[0,-1],[-1,-1],[1,-1],[-1,0],[1,0],[0,1]],S=[[0,-1],...D];
const PIECES={pawn:{name:'歩兵',glyph:'歩',dirs:[[0,-1]],promote:'tokin'},lance:{name:'香車',glyph:'香',dirs:[[0,-1]],promote:'promoted_lance'},knight:{name:'桂馬',glyph:'桂',dirs:[],promote:'promoted_knight'},silver:{name:'銀将',glyph:'銀',dirs:S,promote:'promoted_silver'},gold:{name:'金将',glyph:'金',dirs:G},bishop:{name:'角行',glyph:'角',dirs:D,promote:'horse'},rook:{name:'飛車',glyph:'飛',dirs:C,promote:'dragon'},king:{name:'王将',glyph:'王',dirs:[...C,...D]},tokin:{name:'成金',glyph:'成',dirs:G},promoted_lance:{name:'成金',glyph:'成',dirs:G},promoted_knight:{name:'成金',glyph:'成',dirs:G},promoted_silver:{name:'成金',glyph:'成',dirs:G},horse:{name:'馬',glyph:'馬',dirs:[...C,...D]},dragon:{name:'龍王',glyph:'龍',dirs:[...C,...D]}};
const ACTIONS={pawn:['thrust'],lance:['charge'],knight:['jump'],silver:['sweep'],gold:['sweep'],bishop:['charge'],rook:['charge'],king:['sweep'],tokin:['sweep'],promoted_lance:['sweep'],promoted_knight:['sweep'],promoted_silver:['sweep'],horse:['sweep','charge'],dragon:['sweep','charge']};
const LANCE_ACTION_RULESET='lance-charge-only-v1';
const ENEMY_ZONE_Z=7;
// The two camps mirror around z=15. Entry is observed in the simulation, never
// in a render/query. A pending entry belongs to this actor, faction and form;
// it survives a control swap but not capture, conversion, reset or termination.
const AUTOMATIC_AWAKENING_RULESET='automatic-enemy-camp-v1';
const AWAKENING_ZONE_MIRROR_Z=30;
function automaticAwakening(g){return g?.automaticAwakeningRuleset===AUTOMATIC_AWAKENING_RULESET&&(g.scenario==='army'||g.scenario==='awaken_trial'&&g.piece==='pawn');}
function inAwakeningZone(g,actor=g?.player){return !!actor&&Number.isFinite(actor.z)&&(actor.team==='enemy'?actor.z>=AWAKENING_ZONE_MIRROR_Z-ENEMY_ZONE_Z:actor.team==='ally'&&actor.z<=ENEMY_ZONE_Z);}
function awakeningForm(g,actor){return actor===g.player?pieceKey(g):actor?.piece;}
function awakeningEligible(g,actor){return automaticAwakening(g)&&!!actor&&actor.alive!==false&&(actor===g.player?g.hp>0:actor.alive&&actor.hp>0)&&!actor.trainingGuard&&['ally','enemy'].includes(actor.team)&&!!PIECES[awakeningForm(g,actor)]?.promote;}
function pendingAwakening(g,actor=g?.player){const entry=actor?.awakeningEntry;return !!entry&&awakeningEligible(g,actor)&&entry.id===actor.id&&entry.team===actor.team&&entry.piece===awakeningForm(g,actor);}
function observeAwakeningEntry(g,actor){
 if(!actor)return;
 if(!awakeningEligible(g,actor)){delete actor.awakeningEntry;return;}
 // A promoted body revived inside an authored enemy-zone slot must first
 // leave that zone. The new life cannot inherit promotion merely by spawning.
 if(actor.awakeningReentryRequired){delete actor.awakeningEntry;if(inAwakeningZone(g,actor))return;delete actor.awakeningReentryRequired;}
 if(actor.awakeningEntry&&!pendingAwakening(g,actor))delete actor.awakeningEntry;
 if(!actor.awakeningEntry&&inAwakeningZone(g,actor))actor.awakeningEntry=Object.freeze({id:actor.id,team:actor.team,piece:awakeningForm(g,actor)});
}
function observeAwakeningEntries(g){if(!automaticAwakening(g)||!g.active||battleEnded(g))return;if(g.player)observeAwakeningEntry(g,g.player);if(g.scenario==='army')for(const actor of g.enemies)observeAwakeningEntry(g,actor);}
function awakeningReady(g,actor){return pendingAwakening(g,actor)&&Math.abs(actor.y||0)<.001&&!(actor.stagger>0)&&(actor===g.player?g.mode==='ready'&&!g.guarding&&!g.promotionPulse:actor.attack==='idle'&&!actor.guarding);}
function applyAutomaticAwakening(g){
 if(!automaticAwakening(g)||!g.active||battleEnded(g))return;
 const actors=[...(g.player?[g.player]:[]),...(g.scenario==='army'?g.enemies:[])];
 for(const actor of actors){
  if(!awakeningReady(g,actor))continue;
  const hero=actor===g.player,from=awakeningForm(g,actor),piece=PIECES[from].promote;
  if(!hero)npcRememberPromotionPerception(g,actor,from,piece);
  delete actor.awakeningEntry;actor.basePiece=from;actor.piece=actor.effectivePiece=piece;actor.promoted=true;actor.transformUntil=g.time+1.25;
  if(hero){
   g.promoted=true;g.transformUntil=actor.transformUntil;
   if(!allowed(g,actor.dx,actor.dz)){actor.dx=0;actor.dz=-1;}
   // Preserve the existing hero-only, non-damaging awakening shove. Ordinary
   // NPC upgrades do not gain an area attack, immunity or altered statistics.
   g.promotionPulse={x:actor.x,z:actor.z,age:-.08,life:.48,radius:.65,previousRadius:0,halfWidth:.32,height:ENEMY_HEIGHT,hitIds:[]};
  }else{
   const forward=actor.team==='ally'?-1:1;
   if(!PIECES[piece].dirs.some(([x,z])=>x===Math.sign(actor.aimDx)*-forward&&z===Math.sign(actor.aimDz)*-forward)){actor.aimDx=0;actor.aimDz=forward;}
   actor.approachDir=null;actor.intentTargetId=null;actor.intentUntil=0;actor.attackReadySince=null;friendlyRouteLegs.delete(actor);npcResetCastleState(g,actor,true);
  }
  g.events.push({type:hero?'promote':'npc_promote',automatic:true,id:actor.id,team:actor.team,from,piece,x:actor.x,z:actor.z,time:g.time});
 }
}
function actorHasAbility(g,actor,ability,role='npc'){
 const hero=role==='hero',piece=hero?pieceKey(g):actor.piece,id=hero?g.playerId:actor.id;
 if(!CAP){if(g.capabilityLoadout)return false;return ability==='guard'?hero&&!['pawn','lance','knight'].includes(piece):ability==='step_attack'?hero&&['dragon','horse'].includes(piece):!!ACTIONS[piece]?.includes(ability);}
 return CAP.has(g,id,piece,ability,role,{PIECES,ACTIONS});
}
function heroHasAbility(g,ability){return !!g.player&&actorHasAbility(g,g.player,ability,'hero');}
function npcHasAbility(g,e,ability,face=null){
 if(!actorHasAbility(g,e,ability,'npc'))return false;
 if(ability==='charge'&&face&&((e.piece==='dragon'&&face.x&&face.z)||(e.piece==='horse'&&(!face.x||!face.z))))return false;
 return true;
}
function capabilityInfo(g){return {experimental:!!g.capabilityLoadout,forwardHop:!!CAP?.forwardHop(g),abilities:Object.fromEntries((CAP?.IDS||['thrust','sweep','charge','jump','guard','step_attack']).map(id=>[id,heroHasAbility(g,id)]))};}

function canGuard(g){return !battleEnded(g)&&g.mode==='ready'&&heroHasAbility(g,'guard');}
function setGuard(g,on){if(!on){g.guarding=false;return true;}if(!canGuard(g))return false;g.guarding=true;g.active=true;return true;}
// Compatibility queries are pure. Manual activation was removed; only a
// positive simulation step observes entry and applies the automatic upgrade.
function canAwaken(g){return !battleEnded(g)&&!!g.player&&awakeningReady(g,g.player);}
function awaken(g){return false;}
function canAction(g,action){const k=pieceKey(g);return !g.guarding&&heroHasAbility(g,action)&&(action!=='charge'||!isStepDirection(g,g.player.dx,g.player.dz));}
// Representative legal castle/rook arrangements, not an opening-playing AI.
// Squares below are Black coordinates, rotated180 degrees for the enemy.
const HANDICAPS={solo:{name:'単騎',solo:true,remove:[]},even:{name:'平手',remove:[]},lance:{name:'香落ち',remove:[8]},bishop:{name:'角落ち',remove:[10]},rook:{name:'飛車落ち',remove:[9]},rook_lance:{name:'飛車香落ち',remove:[9,8]},two:{name:'２枚落ち',remove:[9,10]},four:{name:'４枚落ち',remove:[9,10,0,8]},six:{name:'６枚落ち',remove:[9,10,0,8,1,7]},eight:{name:'８枚落ち',remove:[9,10,0,8,1,7,2,6]},ten:{name:'10枚落ち',remove:[9,10,0,8,1,7,2,6,3,5]},nineteen:{name:'19枚落ち',remove:[0,1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]}};
const SLOT_PIECES=['lance','knight','silver','gold','king','gold','silver','knight','lance','rook','bishop',...Array(9).fill('pawn')];
function handicapAllows(handicap,piece){if(!Object.prototype.hasOwnProperty.call(HANDICAPS,handicap)||!Object.prototype.hasOwnProperty.call(PIECES,piece))return false;const base=Object.keys(PIECES).find(k=>PIECES[k].promote===piece)||piece;return SLOT_PIECES.some((p,i)=>p===base&&!HANDICAPS[handicap].remove.includes(i));}
const FORMATIONS={initial:{name:'初期配置'},yagura:{name:'居飛車・矢倉',king:['8h'],rook:['2h'],bishop:['6h'],gold:['7h','6g'],silver:['3i','7g'],lance:['1i','9i']},mino:{name:'四間飛車・美濃',king:['2h'],rook:['6h'],bishop:['7g'],gold:['4i','5h'],silver:['6g','3h'],lance:['1i','9i']},anaguma:{name:'四間飛車・穴熊',king:['1i'],rook:['6h'],bishop:['7g'],gold:['3i','3h'],silver:['6g','2h'],lance:['1h','9i']}};
// Authored army sorties use existing movement, attacks and formation slots.
// Fixed terrain/strategy keeps each short briefing truthful and records comparable.
const BATTLE_SCENARIO_RULESET='piece-scenarios-v3';
const BATTLE_SCENARIOS=Object.freeze(Object.fromEntries([
 {
  "id": "first_sortie",
  "order": 1,
  "name": "飛車、縦横無尽",
  "level": "縦横・突撃",
  "pieces": [
   "rook"
  ],
  "allies": [],
  "enemies": [
   4,
   3,
   5,
   6,
   14,
   16
  ],
  "terrain": "plain",
  "formation": "initial",
  "allyFormation": "initial",
  "allyStrategy": "balanced",
  "enemyStrategy": "defensive",
  "difficulty": "easy",
  "enemyHp": 1,
  "objective": "king",
  "background": "孤立した飛車が、縦横の突撃で前哨を切り崩し、敵王の城へ迫る。仲間を増やして守りを崩すか、予告を見て側面へ切り込むか。",
  "hint": "まず突撃の列を合わせ、前哨の歩を突破しよう。城では金銀を先に倒す道と、予告を見て王へ切り込む道がある。敵陣で龍になると斜め移動と斬撃が使える。",
  "heroStart": {
   "x": 10.2,
   "z": 30.6
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 16,
    "x": 10.2,
    "z": 21
   },
   {
    "team": "enemy",
    "slotKey": 14,
    "x": 3.4,
    "z": 12
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": -17,
    "z": 13
   },
   {
    "team": "enemy",
    "slotKey": 6,
    "x": -3.4,
    "z": 4
   },
   {
    "team": "enemy",
    "slotKey": 4,
    "x": -6.8,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 5,
    "x": -10.2,
    "z": -3
   }
  ],
  "enemyHpOverrides": {
   "3": 2,
   "4": 3,
   "5": 2,
   "6": 2
  },
  "enemyEquipmentOverrides": {
   "3": "light",
   "4": "heavy",
   "5": "light",
   "6": "light"
  },
  "enemyTactics": {
   "cellSize": 2,
   "focus": "balanced"
  },
  "royalDefense": true,
  "enemyKingPersonality": "defensive",
  "version": "piece-scenarios-rook-castle-v1"
 },
 {
  "id": "two_raiders",
  "order": 2,
  "name": "銀将、一刀両断",
  "level": "斜め・斬撃",
  "pieces": [
   "silver"
  ],
  "allies": [],
  "allySlots": [],
  "enemies": [
   4,
   2,
   3,
   14,
   15,
   16
  ],
  "terrain": "plain",
  "formation": "mino",
  "allyFormation": "initial",
  "allyStrategy": "aggressive",
  "enemyStrategy": "defensive",
  "difficulty": "easy",
  "enemyHp": 1,
  "objective": "king",
  "background": "孤立した銀が、敵の前哨を切り崩して仲間を増やし、美濃の王城へ迫る。守りを崩すか、防御を織り交ぜて側面を抜くか。",
  "hint": "銀は前と斜めへ進める。前哨を斬ってから攻める道と、左右へ回って王を狙う道がある。城の護衛は短い予告で斬る。急ぐほど迎撃の危険があるので、防御して攻め時を選ぼう。",
  "heroStart": {
   "x": -3.4,
   "z": 29
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 14,
    "x": -3.4,
    "z": 18
   },
   {
    "team": "enemy",
    "slotKey": 15,
    "x": 0,
    "z": 14
   },
   {
    "team": "enemy",
    "slotKey": 16,
    "x": 3.4,
    "z": 18
   },
   {
    "team": "enemy",
    "slotKey": 2,
    "x": 13.6,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": 6.8,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 4,
    "x": 10.2,
    "z": -3
   }
  ],
  "enemyHpOverrides": {
   "2": 2,
   "3": 2,
   "4": 3
  },
  "enemyEquipmentOverrides": {
   "2": "light",
   "3": "light",
   "4": "heavy"
  },
  "enemyTactics": {
   "cellSize": 2,
   "focus": "balanced"
  },
  "royalDefense": true,
  "enemyKingPersonality": "defensive",
  "version": "piece-scenarios-early-castles-v1"
 },
 {
  "id": "lance_line",
  "order": 3,
  "name": "香車、猪突猛進",
  "level": "直進・突撃",
  "pieces": [
   "lance"
  ],
  "allies": [
   "pawn"
  ],
  "allySlots": [
   16
  ],
  "enemies": [
   4,
   2,
   14,
   15,
   16,
   3,
   6,
   7
  ],
  "terrain": "three_bridges",
  "formation": "initial",
  "allyFormation": "initial",
  "allyStrategy": "aggressive",
  "enemyStrategy": "defensive",
  "difficulty": "easy",
  "enemyHp": 2,
  "objective": "king",
  "background": "香車と歩の二人小隊が、敵の前哨を切り崩して王城へ迫る。前への突撃で仲間を増やし、覚醒後は迎撃を読みながら城の守りを崩そう。",
  "hint": "覚醒前は前への突撃。橋の歩と北岸の金を崩したら、成金の横移動で左奥へ進もう。前衛を先に倒して仲間を増やす道と、迎撃の危険を負って王へ急ぐ道がある。覚醒後は銀や王の予告に防御。",
  "heroStart": {
   "x": 0,
   "z": 30.6
  },
  "enemyTactics": {
   "cellSize": 2,
   "focus": "balanced"
  },
  "enemyHpOverrides": {
   "2": 2,
   "4": 3,
   "6": 1,
   "7": 1,
   "14": 2,
   "15": 1,
   "16": 2
  },
  "enemyEquipmentOverrides": {
   "2": "heavy",
   "3": "heavy",
   "4": "heavy",
   "6": "heavy",
   "7": "heavy",
   "15": "heavy"
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 15,
    "x": 0,
    "z": 19
   },
   {
    "team": "enemy",
    "slotKey": 14,
    "x": -10.2,
    "z": 15
   },
   {
    "team": "enemy",
    "slotKey": 16,
    "x": 10.2,
    "z": 15
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": 0,
    "z": 7.6
   },
   {
    "team": "enemy",
    "slotKey": 7,
    "x": 3,
    "z": 9
   },
   {
    "team": "enemy",
    "slotKey": 2,
    "x": -3.4,
    "z": 10.5
   },
   {
    "team": "enemy",
    "slotKey": 6,
    "x": -8,
    "z": 1.4
   },
   {
    "team": "enemy",
    "slotKey": 4,
    "x": -11.2,
    "z": -2
   },
   {
    "team": "ally",
    "slotKey": 16,
    "x": -10.2,
    "z": 26.8
   }
  ],
  "enemyKingPersonality": "defensive",
  "version": "piece-scenarios-castles-v1",
  "royalDefense": true
 },
 {
  "id": "three_bridges",
  "order": 4,
  "name": "桂馬、疾風迅雷",
  "level": "跳躍・着地",
  "pieces": [
   "knight"
  ],
  "allies": [],
  "allySlots": [],
  "enemies": [
   4,
   3,
   2,
   13,
   14,
   15,
   16,
   17
  ],
  "terrain": "three_bridges",
  "formation": "mino",
  "allyFormation": "initial",
  "allyStrategy": "aggressive",
  "enemyStrategy": "balanced",
  "difficulty": "normal",
  "enemyHp": 1,
  "objective": "king",
  "background": "桂が前線を跳び越え、敵の王城に挑む。捕らえた駒と攻めるか、近衛の予告を読んで自ら突破するか。",
  "hint": "桂は歩行できず、左右のL字跳躍で進む。前衛を越えながら着地で歩を倒し、仲間を得よう。敵陣で覚醒したら、残る守りを抜けて美濃の王へ回り込む。",
  "heroStart": {
   "x": 1.3,
   "z": 29
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 13,
    "x": -3.4,
    "z": 18
   },
   {
    "team": "enemy",
    "slotKey": 14,
    "x": 0,
    "z": 18
   },
   {
    "team": "enemy",
    "slotKey": 15,
    "x": -6.8,
    "z": 7
   },
   {
    "team": "enemy",
    "slotKey": 16,
    "x": 3.4,
    "z": 12
   },
   {
    "team": "enemy",
    "slotKey": 17,
    "x": 6.8,
    "z": 12
   },
   {
    "team": "enemy",
    "slotKey": 4,
    "x": -10.2,
    "z": -4
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": -10.2,
    "z": 0
   },
   {
    "team": "enemy",
    "slotKey": 2,
    "x": -6.8,
    "z": -2.2
   }
  ],
  "enemyKingPersonality": "defensive",
  "version": "piece-scenarios-knight-castle-v1",
  "enemyHpOverrides": {
   "2": 1,
   "3": 1,
   "4": 2
  }
 },
 {
  "id": "lone_legend",
  "order": 5,
  "name": "角行、変幻自在",
  "level": "斜め・突撃",
  "pieces": [
   "bishop"
  ],
  "allies": [],
  "allySlots": [],
  "enemies": [
   4,
   9,
   2,
   3,
   11,
   12,
   13,
   14,
   15,
   16
  ],
  "terrain": "plain",
  "formation": "yagura",
  "allyFormation": "initial",
  "allyStrategy": "aggressive",
  "enemyStrategy": "balanced",
  "difficulty": "normal",
  "enemyHp": 1,
  "objective": "king",
  "background": "孤立した角が、斜めの突撃で前線を切り崩し、敵の王城へ迫る。金銀が王前を固め、城の右側の飛車が持ち場を守る。",
  "hint": "角は斜めに進む。前衛を倒して仲間を増やし、敵陣で馬になれば縦横にも動ける。城では金銀と飛車の予告を見て、防御を交えながら王へ迫ろう。",
  "heroStart": {
   "x": -10.2,
   "z": 28.4
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 4,
    "x": 10.2,
    "z": -4
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": 6.8,
    "z": -1.8
   },
   {
    "team": "enemy",
    "slotKey": 2,
    "x": 10.2,
    "z": -1.8
   },
   {
    "team": "enemy",
    "slotKey": 9,
    "x": 13.6,
    "z": 1.6
   }
  ],
  "enemyKingPersonality": "defensive",
  "enemyHpOverrides": {
   "2": 2,
   "3": 2,
   "4": 5
  },
  "enemyEquipmentOverrides": {
   "2": "light",
   "3": "light",
   "4": "light"
  },
  "version": "piece-scenarios-bishop-castle-duty-v1",
  "castleDefense": [{"team":"enemy","slotKey":9}],
  "royalDefense": true
 },
 {
  "id": "royal_guard",
  "order": 6,
  "name": "金将、金城鉄壁",
  "level": "護衛・迎撃",
  "pieces": [
   "gold"
  ],
  "allies": [
   "king"
  ],
  "allySlots": [
   4
  ],
  "enemies": [
   2,
   4,
   9,
   15,
   0,
   1,
   3,
   5,
   6,
   7,
   8,
   10
  ],
  "terrain": "three_bridges",
  "formation": "initial",
  "allyFormation": "yagura",
  "allyStrategy": "aggressive",
  "enemyStrategy": "aggressive",
  "difficulty": "normal",
  "enemyHp": 1,
  "objective": "protect",
  "background": "金と左の矢倉王の2人へ、動きの重い12人が進軍。左筋の銀・飛車・歩を先に迎え、右後方の金銀・角・桂香が続く。後方の金は橋へ出て前衛を味方に変え、次の攻勢に備える。",
  "hint": "初期位置で防御しても王は守れない。王の近くで待たず、橋へ出て前衛を迎撃しよう。斬撃で仲間を増やし、敵の予兆には防御。30秒守るか、敵を全て退ければ達成。",
  "heroStart": {
   "x": -6.8,
   "z": 30.6
  },
  "duration": 30,
  "enemyEquipment": "heavy",
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 9,
    "x": -10.2,
    "z": 7
   },
   {
    "team": "enemy",
    "slotKey": 0,
    "x": 3.4,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 1,
    "x": 6.8,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 3,
    "x": 10.2,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 5,
    "x": 13.6,
    "z": -3
   },
   {
    "team": "enemy",
    "slotKey": 6,
    "x": 3.4,
    "z": 0.7999999999999998
   },
   {
    "team": "enemy",
    "slotKey": 7,
    "x": 6.8,
    "z": 0.7999999999999998
   },
   {
    "team": "enemy",
    "slotKey": 8,
    "x": 10.2,
    "z": 0.7999999999999998
   },
   {
    "team": "enemy",
    "slotKey": 10,
    "x": 13.6,
    "z": 0.7999999999999998
   }
  ]
 },
 {
  "id": "king_command",
  "order": 7,
  "name": "王将、勇往邁進",
  "level": "八方向・進出判断",
  "pieces": [
   "king"
  ],
  "allies": [
   "silver"
  ],
  "allySlots": [
   2
  ],
  "enemies": [
   1,
   2,
   3,
   4,
   5,
   6,
   7,
   9,
   10,
   11,
   12,
   13,
   14,
   15,
   16,
   18
  ],
  "terrain": "plain",
  "formation": "initial",
  "allyFormation": "initial",
  "allyStrategy": "defensive",
  "enemyStrategy": "defensive",
  "difficulty": "normal",
  "enemyHp": 2,
  "objective": "king",
  "background": "王と本陣を守る銀の2人で、16人の守備陣を攻める。王は右後方から、歩・大駒・金銀の囲いへ。8方向の足運びで攻撃の筋を外し、倒した兵とともに敵王へ進む。",
  "hint": "銀だけに任せず、王自身が斬撃と防御で前線を切りひらこう。敵が集まったら安全な方向へ動き、味方の合流を待つ。戦況図で銀へ切り替えても、味方の王が倒れると敗北。",
  "deployment": [],
  "allyKingPersonality": "midgame",
  "heroStart": {
   "x": 10.2,
   "z": 26.8
  }
 },
 {
  "id": "pawn_rebellion",
  "order": 8,
  "name": "歩兵、一発逆転",
  "level": "最上級・単騎",
  "pieces": [
   "pawn"
  ],
  "allies": [],
  "enemies": [
   0,
   1,
   2,
   3,
   4,
   5,
   6,
   7,
   8,
   9,
   10,
   11,
   12,
   13,
   14,
   15,
   16,
   17,
   18,
   19
  ],
  "terrain": "three_bridges",
  "formation": "anaguma",
  "allyFormation": "initial",
  "allyStrategy": "aggressive",
  "enemyStrategy": "defensive",
  "difficulty": "hard",
  "enemyHp": 2,
  "objective": "king",
  "background": "歩兵1人で、中央の歩と桂の前哨を抜け、北岸の飛車と奥の穴熊に挑む。敵は計20人。前哨は体力1で、先頭の歩は重装備の遅い予告。防御も後退もできない一歩から、仲間を増やして端の王を目指す。",
  "hint": "覚醒前は前哨の予告を見て、突きの間合いを選ぼう。桂の跳躍と飛車の直進には注意。自動覚醒で横移動・防御・斬撃が使える。覚醒後も穴熊の金銀は体力2。仲間の到着を見て守りを崩そう。",
  "heroStart": {
   "x": 0,
   "z": 30.6
  },
  "deployment": [
   {
    "team": "enemy",
    "slotKey": 15,
    "x": 0,
    "z": 21
   },
   {
    "team": "enemy",
    "slotKey": 7,
    "x": 0,
    "z": 16
   },
   {
    "team": "enemy",
    "slotKey": 9,
    "x": -6.8,
    "z": 9
   }
  ],
  "enemyHpOverrides": {
   "7": 1,
   "9": 1,
   "15": 1
  },
  "enemyEquipmentOverrides": {
   "15": "heavy"
  },
  "version": "piece-scenarios-pawn-bank-rook-v1"
 }
,
{
 "id": "final_siege",
 "order": 9,
 "version": "final-siege-bogin-file2-v1",
 "name": "決戦、難攻不落",
 "level": "最終決戦・連携",
 "pieces": [
  "king"
 ],
 "allies": [
  "pawn",
  "silver",
  "rook",
  "knight",
  "lance",
  "pawn",
  "pawn"
 ],
 "enemies": [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19
 ],
 "terrain": "plain",
 "formation": "anaguma",
 "allyFormation": "initial",
 "allyStrategy": "balanced",
 "enemyStrategy": "defensive",
 "difficulty": "normal",
 "enemyHp": 3,
 "objective": "king",
 "background": "王と歩3枚・銀・飛・桂・香の8人で、体力3の敵20人が守る穴熊に挑む。2筋に歩・銀・飛・桂を並べた棒銀の配置から、一点突破を狙う。",
 "hint": "歩2五・銀2六・飛2八・桂2九。桂の両隣は王3九・香1九、脇の歩は1七・3七。敵の穴熊と通常の攻撃ルールは変わらず、突破や攻撃順を保証する配置ではない。難度は標準固定。",
 "allySlots": [
  12,
  2,
  9,
  1,
  0,
  11,
  13
 ],
 "allyTactics": {
  "cellSize": 3,
  "focus": "balanced"
 },
 "deployment": [
  {
   "team": "ally",
   "slotKey": 12,
   "x": 10.2,
   "z": 15.4
  },
  {
   "team": "ally",
   "slotKey": 2,
   "x": 10.2,
   "z": 19.2
  },
  {
   "team": "ally",
   "slotKey": 9,
   "x": 10.2,
   "z": 26.8
  },
  {
   "team": "ally",
   "slotKey": 1,
   "x": 10.2,
   "z": 30.6
  },
  {
   "team": "ally",
   "slotKey": 0,
   "x": 13.6,
   "z": 30.6
  },
  {
   "team": "ally",
   "slotKey": 11,
   "x": 13.6,
   "z": 23.0
  },
  {
   "team": "ally",
   "slotKey": 13,
   "x": 6.8,
   "z": 23.0
  }
 ],
 "heroStart": {
  "x": 6.8,
  "z": 30.6
 }
}
].map(raw=>[raw.id,Object.freeze({...raw,pieces:Object.freeze(raw.pieces),allies:Object.freeze(raw.allies),enemies:Object.freeze(raw.enemies),...(raw.allySlots?{allySlots:Object.freeze(raw.allySlots)}:{}),...(raw.deployment?{deployment:Object.freeze(raw.deployment.map(p=>Object.freeze(p)))}:{}),...(raw.heroStart?{heroStart:Object.freeze(raw.heroStart)}:{}),...(raw.enemyHpOverrides?{enemyHpOverrides:Object.freeze(raw.enemyHpOverrides)}:{}),...(raw.enemyEquipmentOverrides?{enemyEquipmentOverrides:Object.freeze(raw.enemyEquipmentOverrides)}:{}),...(raw.allyTactics?{allyTactics:Object.freeze(raw.allyTactics)}:{}),...(raw.enemyTactics?{enemyTactics:Object.freeze(raw.enemyTactics)}:{}),...(raw.castleDefense?{castleDefense:Object.freeze(raw.castleDefense.map(p=>Object.freeze(p)))}:{})})])));
function battleScenarioDefinition(id){return typeof id==='string'&&Object.prototype.hasOwnProperty.call(BATTLE_SCENARIOS,id)?BATTLE_SCENARIOS[id]:null;}
function battleScenarioOptions(m,options){return {...options,scenario:'army',formationHero:true,controlMode:'manual',handicap:'even',allyFormation:m.allyFormation,terrain:m.terrain,difficulty:m.difficulty,heroHp:3,strategies:{ally:m.allyStrategy,enemy:m.enemyStrategy},teamStats:{ally:{hp:2,equipment:'light',agility:'normal'},enemy:{hp:m.enemyHp,equipment:m.enemyEquipment||'light',agility:m.enemyEquipment==='heavy'?'slow':'normal'}},teamTactics:normalizeTeamTactics({ally:m.allyTactics,enemy:m.enemyTactics}),kingPersonalities:{ally:m.allyKingPersonality||'defensive',enemy:m.enemyKingPersonality||'defensive'},npcSensing:true,invasionScoring:true,capabilities:undefined};}
// Scenario home HP is team+slot data. Captures use the destination team's home;
// an enemy's authored HP never leaks into its recruited ally body.
function npcHomeHp(g,team,slotKey){const slot=g.battleScenario&&g.formationSlots?.find(s=>s.team===team&&s.slotKey===slotKey);return slot?.scenarioHp??(g.teamStats?.[team].hp||1);}
function npcHomeEquipment(g,team,slotKey){const slot=g.battleScenario&&g.formationSlots?.find(s=>s.team===team&&s.slotKey===slotKey);return slot?.scenarioEquipment??(g.teamStats?.[team].equipment||'light');}
function installBattleScenario(g,m){
 const chosen=new Set(),companions=[];
 for(const [index,role] of m.allies.entries()){const piece=role==='guard'?(g.piece==='gold'?'silver':'gold'):role;const unit=g.enemies.filter(e=>e.team==='ally'&&e.piece===piece&&!chosen.has(e.id)&&(m.allySlots?.[index]==null||e.slotKey===m.allySlots[index])).sort((a,b)=>Math.abs(a.x-g.player.x)-Math.abs(b.x-g.player.x)||a.slotKey-b.slotKey)[0];if(!unit)throw new Error('Scenario companion missing');chosen.add(unit.id);companions.push(unit);}
 g.enemies=g.enemies.filter(e=>e.team==='enemy'?m.enemies.includes(e.slotKey):chosen.has(e.id));g.allyCount=companions.length;g.handicap=null;if(m.heroStart){if(!arenaContains(g,m.heroStart))throw new Error('Scenario hero outside arena');Object.assign(g.player,{x:m.heroStart.x,z:m.heroStart.z,homeX:m.heroStart.x,homeZ:m.heroStart.z});const home=g.formationSlots.find(s=>s.team==='ally'&&s.slotKey===g.heroSlotKey);Object.assign(home,m.heroStart);}
 // Authored support positions move the matching revival home as well. Both
 // preview and sortie are generated here; no visual-only layout is maintained.
 for(const point of m.deployment||[]){const actor=g.enemies.find(e=>e.team===point.team&&e.slotKey===point.slotKey),slot=g.formationSlots.find(s=>s.team===point.team&&s.slotKey===point.slotKey);if(!actor||!slot||!arenaContains(g,point))throw new Error('Invalid scenario deployment');Object.assign(actor,{x:point.x,z:point.z,homeX:point.x,homeZ:point.z});Object.assign(slot,{x:point.x,z:point.z});}
 // Persistent defensive duties belong to a scenario faction/home slot.
 // Promotion changes a body's form, not this authored home assignment.
 for(const duty of m.castleDefense||[]){const actor=g.enemies.find(e=>e.team===duty.team&&e.slotKey===duty.slotKey),slot=g.formationSlots.find(s=>s.team===duty.team&&s.slotKey===duty.slotKey);if(!actor||!slot)throw new Error('Invalid scenario castle duty');slot.castleDefenseScenario=m.id;}
 // Optional authored enemy HP overrides use the same homes for preview,
 // initial sortie and later recapture. Existing scenarios keep uniform team HP.
 for(const [key,hp] of Object.entries(m.enemyHpOverrides||{})){const slotKey=Number(key),actor=g.enemies.find(e=>e.team==='enemy'&&e.slotKey===slotKey),slot=g.formationSlots.find(s=>s.team==='enemy'&&s.slotKey===slotKey);if(String(slotKey)!==key||!actor||!slot||![1,2,3,5].includes(hp))throw new Error('Invalid scenario enemy HP');actor.hp=actor.maxHp=hp;slot.scenarioHp=hp;}
 // Per-home equipment uses existing individual NPC warning/reload timing.
 // Team movement/agility remain their separately authored team settings.
 for(const [key,equipment] of Object.entries(m.enemyEquipmentOverrides||{})){const slotKey=Number(key),actor=g.enemies.find(e=>e.team==='enemy'&&e.slotKey===slotKey),slot=g.formationSlots.find(s=>s.team==='enemy'&&s.slotKey===slotKey);if(String(slotKey)!==key||!actor||!slot||!['light','heavy'].includes(equipment))throw new Error('Invalid scenario enemy equipment');actor.equipment=equipment;slot.scenarioEquipment=equipment;}
 // Preserve every canonical slot, including currently empty recruitment homes.
 // Stable IDs are retained; initial counts never pretend to cap later allies.
 const king=companions.find(e=>e.piece==='king');
 Object.defineProperty(g,'battleScenario',{value:Object.freeze({version:m.version||BATTLE_SCENARIO_RULESET,id:m.id,objective:m.objective,duration:m.duration||0,protectedId:king?.id??null,initialAllies:companions.length+1,initialEnemies:m.enemies.length}),enumerable:true});
 g.kingPlan=KingPersonality.initialPlan(g);if(g.invasion)g.invasion=Invasion.createInvasion(g);
}
function protectedScenarioKing(g){const m=g.battleScenario;if(m?.objective!=='protect')return null;return g.playerId===m.protectedId?{...g.player,piece:g.piece,hp:g.hp,maxHp:g.maxHp}:g.enemies.find(e=>e.id===m.protectedId);}
function updateBattleScenario(g){
 const m=g.battleScenario;if(m?.objective!=='protect'||!g.active||battleEnded(g))return;
 const king=protectedScenarioKing(g);if(!king||!king.alive||king.team!=='ally'||king.piece!=='king'||king.hp<=0){finishBattle(g,false,'king');return;}
 const cleared=!g.enemies.some(e=>e.alive&&e.team==='enemy'||!e.alive&&e.pendingTeam==='enemy');
 if(g.time+1e-9>=m.duration||cleared)finishBattle(g,true,cleared?'royal-clear':'royal-survived');
}
const FORMATION_PAWNS=['1g','2g','3g','4g','5g','6f','7f','8g','9g'];
function pieceKey(g){return g.promoted&&PIECES[g.piece].promote?PIECES[g.piece].promote:g.piece;}
function pieceInfo(g){return PIECES[pieceKey(g)];}
function allowed(g,x,z){return pieceInfo(g).dirs.some(([a,b])=>a===Math.sign(x)&&b===Math.sign(z));}
/**
 * Return the first segment of a shortest obstacle-free path composed of at
 * most two legal, normalized directions. Inputs and returned distances are in
 * world units. The directions are the piece's unmirrored PIECES[piece].dirs.
 *
 * null means either within arrivalEpsilon of the destination or unreachable.
 * The caller can distinguish those cases with Math.hypot(dx, dz).
 * Never snap the body to its destination: move at most segment.distance along
 * {x, z}, apply body clipping, and re-evaluate from the actual resulting point.
 *
 * This is a displacement solver, not obstacle avoidance or knight planning.
 */
function nextLegalSegment(pieceDirs, team, dx, dz, arrivalEpsilon = 1e-7) {
  if (!Array.isArray(pieceDirs) || !['ally', 'enemy'].includes(team)
      || !Number.isFinite(dx) || !Number.isFinite(dz)
      || !Number.isFinite(arrivalEpsilon) || arrivalEpsilon <= 0) return null;
  const remaining = Math.hypot(dx, dz);
  if (!Number.isFinite(remaining) || remaining <= arrivalEpsilon) return null;

  // Numerical tolerance is much smaller than the gameplay arrival tolerance.
  // A small but real sideways displacement must not make a pawn seem capable
  // of arriving: it is not silently discarded as arrivalEpsilon-sized noise.
  const roundoff = 64 * Number.EPSILON * Math.max(1, remaining);
  const sign = team === 'ally' ? 1 : -1;
  const dirs = [];
  for (const raw of pieceDirs) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const [x, z] = raw;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const length = Math.hypot(x, z);
    if (!Number.isFinite(length) || length === 0) continue;
    dirs.push({ x: sign * x / length, z: sign * z / length });
  }
  let best = null;
  function consider(a, distanceA, b = null, distanceB = 0) {
    if (!Number.isFinite(distanceA) || !Number.isFinite(distanceB)
        || distanceA < -roundoff || distanceB < -roundoff) return;
    distanceA = Math.max(0, distanceA);
    distanceB = Math.max(0, distanceB);
    const rx = a.x * distanceA + (b ? b.x * distanceB : 0);
    const rz = a.z * distanceA + (b ? b.z * distanceB : 0);
    if (Math.hypot(rx - dx, rz - dz) > roundoff) return;
    const total = distanceA + distanceB;
    if (!Number.isFinite(total)) return;
    const first = distanceA > roundoff
      ? { x: a.x, z: a.z, distance: distanceA }
      : b && distanceB > roundoff
        ? { x: b.x, z: b.z, distance: distanceB } : null;
    if (!first) return;
    // Singles are examined before pairs, then the piece table's stable order.
    // Retain the first candidate on numerical ties. Do not sort by distance
    // from the current position, which can reverse segment order mid-leg.
    if (!best || total < best.total - roundoff) best = { total, first };
  }
  for (const a of dirs) consider(a, a.x * dx + a.z * dz);
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const a = dirs[i], b = dirs[j];
      const det = a.x * b.z - a.z * b.x;
      // PIECES directions have determinant 0, +-sqrt(1/2), or +-1.
      if (Math.abs(det) < 1e-12) continue;
      const distanceA = (dx * b.z - dz * b.x) / det;
      const distanceB = (a.x * dz - a.z * dx) / det;
      consider(a, distanceA, b, distanceB);
    }
  }
  return best ? best.first : null;
}


function terrainOn(g){return g?.terrain==='three_bridges';}
// Historical helper names now mean a legal ground placement/path. Water is
// legal; Terrain.dryBody/drySegment remain available for physical inspection.
function terrainDry(g,p){return (!g?.arena||arenaContains(g,p))&&(!terrainOn(g)||Terrain.passable(p,'river'));}
function terrainPath(g,a,b){return (!g?.arena||arenaContains(g,a,1e-7)&&arenaContains(g,b,1e-7))&&(!terrainOn(g)||Terrain.passableSegment(a,b,.6,'river'));}
function terrainMove(g,body,x,z){const end=g?.arena?arenaClip(g,body,{x,z}).point:{x,z},p=terrainOn(g)?Terrain.clipSegment(body,end,.6,'river').point:end;body.x=p.x;body.z=p.z;}
function terrainJump(g,a,b,team,knight=true){return (!g?.arena||arenaContains(g,a)&&arenaContains(g,b)&&(!knight||Math.abs(Math.abs(b.x-a.x)-3)<1e-9&&Math.abs(b.z-a.z-(team==='ally'?-6:6))<1e-9))&&(!terrainOn(g)||Terrain.validateJump(a,b,{team,knight,radius:.6,mode:'river'}));}
function terrainGroundDistance(g,p,dx,dz,budget,limit=budget){
 const distance=Math.min(budget,limit);if(!terrainOn(g)||distance<=0)return distance;
 const end=Terrain.advance(p,{x:p.x+dx*distance,z:p.z+dz*distance},budget);return Math.hypot(end.x-p.x,end.z-p.z);
}
function bodyMotionAt(motion,t){
 const {start,end,moveDt,delay=0,timeline}=motion,u=moveDt>0?clamp((t-delay)/moveDt,0,1):1;
 if(!timeline)return {...start,x:start.x+(end.x-start.x)*u,z:start.z+(end.z-start.z)*u};
 const time=Math.max(0,t-delay);for(let i=1;i<timeline.length;i++){const a=timeline[i-1],b=timeline[i];if(time<=b.t){const f=(time-a.t)/(b.t-a.t);return {...start,x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};}}
 return {...end};
}
function bodyMotionTimes(motion){return motion.timeline?motion.timeline.map(p=>p.t+(motion.delay||0)):[];}

const STRATEGIES={balanced:{name:'均衡'},aggressive:{name:'攻勢'},defensive:{name:'守備'}};
function normalizeStrategies(value){return {ally:Object.prototype.hasOwnProperty.call(STRATEGIES,value?.ally)?value.ally:'balanced',enemy:Object.prototype.hasOwnProperty.call(STRATEGIES,value?.enemy)?value.enemy:'defensive'};}
function npcRoute(e,x,z,g=null){
 const dirs=e.piece==='dragon'?C:e.piece==='horse'?D:PIECES[e.piece]?.dirs||[],team=e.team||'enemy',dx=x-e.x,dz=z-e.z;
 // A corner below the movement consumer's arrival tolerance cannot be
 // consumed; sensing-enabled NPCs try the opposite legal ordering.
 for(const order of [dirs,[...dirs].reverse()]){const step=nextLegalSegment(order,team,dx,dz);if(!step||g?.npcSensing===true&&step.distance<=1e-7)continue;const wx=e.x+step.x*step.distance,wz=e.z+step.z*step.distance;if(arenaContains(g,{x:wx,z:wz},1e-7))return step;}
 return null;
}
function moveNPC(g,e,x,z,dt,slashMotions=null){if(!KingPersonality.spendMovement(g,e))return false;const from={x:e.x,z:e.z};try{const move=npcRoute(e,x,z,g);if(!move)return false;const travel=terrainGroundDistance(g,e,move.x,move.z,movementSpeed(g,e.team||'enemy',true)*dt,move.distance);const ox=e.x,oz=e.z,nx=ox+move.x*travel,nz=oz+move.z*travel,p=g.player;if(!npcCastleStepAllowed(g,e,{x:nx,z:nz}))return false;if(p&&(p.y||0)<=1.5&&distanceSegment(p.x,p.z,ox,oz,nx,nz)<=1.6&&!((ox-p.x)*(nx-ox)+(oz-p.z)*(nz-oz)>=0&&Math.hypot(ox-p.x,oz-p.z)<1.6))return false;clipRush(g,e,nx,nz,e,true,1.4);const distance=Math.hypot(e.x-ox,e.z-oz);if(slashMotions&&distance>1e-9){const record=slashMotions.get(e);if(record&&Math.abs(record.start.x-ox)<1e-9&&Math.abs(record.start.z-oz)<1e-9&&Math.abs(e.y||0)<1e-9)record.motion=terrainOn(g)?Terrain.motion(record.start,{...record.start,x:e.x,z:e.z},movementSpeed(g,e.team||'enemy',true)):{start:record.start,end:{...record.start,x:e.x,z:e.z},moveDt:distance/movementSpeed(g,e.team||'enemy',true),delay:0};}return distance>1e-9;}finally{KingPersonality.finishMovement(g,e,from,Math.hypot(e.x-from.x,e.z-from.z)>1e-9);}}
// Silver keeps its royal role after awakening; routes still use its current gold directions.
function npcRoyalGuardPiece(g,piece){return piece==='gold'||piece==='silver'||piece==='promoted_silver'&&g?.scenario==='army'&&g.formationHero===true&&!!g.kingPersonalities;}
// Only equally close aggressive guards use the selected lane as a tie-break.
// Keep the opposite wing protected without replacing a clearly nearer guard.
function npcGuardCompare(g,team,slot,a,b){
 const distance=Math.hypot(a.homeX-slot.x,a.homeZ-slot.z)-Math.hypot(b.homeX-slot.x,b.homeZ-slot.z);
 if(g.npcSensing!==true||Math.abs(distance)>1e-7)return distance||a.id-b.id;
 const focus=g.npcSensing===true&&g.strategies?.[team]==='aggressive'?g.teamTactics?.[team]?.focus:null;
 const side=focus==='left'?1:focus==='right'?-1:0,mirror=team==='ally'?1:-1;
 return side*(b.homeX-a.homeX)*mirror||a.id-b.id;
}
function npcGuardRole(g,e){
 if(!g.strategies||e.piece==='king')return false;const team=e.team||'enemy',style=g.strategies[team],slot=g.formationSlots.find(s=>s.team===team&&s.slotKey===4);if(!slot||!KingPersonality.liveKing(g,team))return false;
 const observed=g.npcSensing===true?sensingFrames.get(g):null,stamp=observed?.locked?observed:g,key=g.npcSensing===true?[g.strategies[team],g.teamTactics?.[team]?.focus,stamp.playerId,stamp.npcCaptures,stamp.reinforcements].join(':'):null,cache=g.guardCache?.[team];if(!cache||g.time>=cache.until||key!==null&&key!==cache.key){g.guardCache||={};const count=style==='aggressive'?1:2;g.guardCache[team]={...(key===null?{}:{key}),until:g.time+.3,ids:g.enemies.filter(n=>n.alive&&n.team===team&&npcRoyalGuardPiece(g,n.piece)&&Math.hypot(n.homeX-slot.x,n.homeZ-slot.z)<9).sort((a,b)=>npcGuardCompare(g,team,slot,a,b)).slice(0,count).map(n=>n.id)};}
 return g.guardCache[team].ids.includes(e.id);
}
// The existing balanced home budget also bounds an explicitly authored duty.
const NPC_BALANCED_HOME_RADIUS=9,npcCastleLives=new WeakMap(),npcCastleActions=new WeakMap();
function npcCastleHome(g,team,slotKey){
 const slot=g.battleScenario&&g.formationSlots?.find(s=>s.team===team&&s.slotKey===slotKey&&s.castleDefenseScenario===g.battleScenario.id);
 return slot?{x:slot.x,z:slot.z,radius:NPC_BALANCED_HOME_RADIUS}:null;
}
function npcCastleDuty(g,e){return e.alive&&(e.hp??1)>0&&e.id!==g.playerId&&!e.trainingGuard?npcCastleHome(g,e.team||'enemy',e.slotKey):null;}
function npcCastleLife(g,e){
 const post=npcCastleDuty(g,e);if(!post)return null;
 const key=[g.battleScenario.id,e.team,e.slotKey,post.x,post.z].join(':');let life=npcCastleLives.get(e);
 if(!life||life.key!==key){life={key};npcCastleLives.set(e,life);npcCastleActions.delete(e);}return life;
}
function npcResetCastleState(g,e,keepLife=false){
 if(!npcCastleLives.has(e)&&!npcCastleActions.has(e)&&!npcCastleHome(g,e.team||'enemy',e.slotKey)&&!npcCastleHome(g,e.pendingTeam,e.slotKey))return;
 if(!keepLife)npcCastleLives.delete(e);npcCastleActions.delete(e);delete e.actionPost;delete e.actionKind;
 friendlyRouteLegs.delete(e);npcAttackLaneRoutes.delete(e);npcAttackLaneSearches.delete(e);assaultReturnSearches.delete(e);npcKnightAdvanceChecks.delete(e);const frame=sensingFrames.get(g);if(frame){frame.states.delete(e.id);if(!frame.locked)frame.key=null;}
}
function npcCastleCommitPost(g,e,post){const life=npcCastleLife(g,e);if(life)npcCastleActions.set(e,{life,post:{...post}});else npcCastleActions.delete(e);}
function npcCastleStepAllowed(g,e,point){
 const post=npcCastleDuty(g,e);if(!post)return true;
 const before=Math.hypot(e.x-post.x,e.z-post.z),after=Math.hypot(point.x-post.x,point.z-post.z);
 return before<=post.radius+1e-7?after<=post.radius+1e-7:after<before-1e-9;
}
// Check only the ordinary cardinal approach, at most two existing legal legs.
// This is a conservative service proof, not a new route or a move reservation.
function npcCastleCanServe(g,e,target){
 const post=npcCastleDuty(g,e);if(!post)return true;
 if(tacticAttack(g,e,target))return true;
 if(Math.hypot(e.x-post.x,e.z-post.z)>post.radius+1e-7)return false;
 let stance={...e,attack:'idle',actionPost:null};
 for(let leg=0;leg<2;leg++){
  const move=npcRoute(stance,target.x,target.z,g);if(!move)return false;
  const x=stance.x-post.x,z=stance.z-post.z,b=x*move.x+z*move.z,c=x*x+z*z-post.radius*post.radius,disc=b*b-c;
  if(disc<0)return false;
  const last=Math.hypot(stance.x+move.x*move.distance-target.x,stance.z+move.z*move.distance-target.z)<1e-7;
  const distance=Math.min(Math.max(0,move.distance-(last?2.4:0)),Math.max(0,-b+Math.sqrt(disc)));
  if(distance<=1e-7)return false;
  const end={x:stance.x+move.x*distance,z:stance.z+move.z*distance},probe={x:stance.x,z:stance.z};
  if(!terrainPath(g,stance,end))return false;
  clipRush(g,probe,end.x,end.z,e,true,1.4);if(Math.hypot(probe.x-end.x,probe.z-end.z)>1e-7)return false;
  stance={...stance,...end};if(tacticAttack(g,stance,target))return true;
  if(distance<move.distance-1e-7)return false;
 }
 return false;
}
function npcCastleReturnTarget(g,e,state){
 const post=npcCastleDuty(g,e);if(!post||!state||state.mode==='combat'&&!state.contacts.size||Math.hypot(e.x-post.x,e.z-post.z)<=.15)return null;
 return {x:post.x,z:post.z,tacticalMarch:true,role:'castle-defense',castleReturn:true};
}
function npcBasePursuitLimit(g,e){if(!g.strategies)return (e.team||'enemy')==='ally'?Infinity:0;if(g.strategies[e.team||'enemy']==='defensive')return 0;if(e.recruitedTeam===(e.team||'enemy'))return Infinity;return npcGuardRole(g,e)?6:g.strategies[e.team||'enemy']==='balanced'?NPC_BALANCED_HOME_RADIUS:Infinity;}
// Autonomous royal marching is a faction order, not a king-only waypoint.
// Read the live king each time so capture/control changes cannot lend an old
// life its march. Home coordinates remain immutable formation/recruit slots.
function npcRoyalMarch(g,team){
 if(g?.scenario!=='army'||g.formationHero!==true||g.npcSensing!==true||!g.active||battleEnded(g)||!g.kingPersonalities||!KingPersonality.stageReady(g,g.kingPersonalities[team]))return null;
 const king=KingPersonality.liveKing(g,team),slot=g.formationSlots.find(s=>s.team===team&&s.slotKey===4);
 if(!king||king.id===g.playerId||!slot)return null;
 const forward=team==='ally'?-1:1,kingProgress=Math.max(0,(king.z-slot.z)*forward),progress=Math.max(kingProgress,KingPersonality.armyMarchProgress(g,king));
 return {king,slot,forward,progress,kingProgress};
}
function npcRoyalFollower(g,e){return !npcCastleDuty(g,e)&&!!npcRoyalMarch(g,e.team||'enemy')&&e.alive&&e.id!==g.playerId&&e.piece!=='king'&&!e.trainingGuard&&!npcGuardRole(g,e);}
function npcPost(g,e,kind='pursuit'){
 const duty=npcCastleDuty(g,e);if(duty){const life=npcCastleLife(g,e),action=npcCastleActions.get(e);return kind==='action'&&e.actionKind==='charge'&&['windup','charge'].includes(e.attack)&&action?.life===life?action.post:duty;}
 if(g.npcSensing===true&&kind==='action'&&e.actionPost&&e.actionKind==='charge'&&['windup','charge'].includes(e.attack))return e.actionPost;
 const style=g.strategies?.[e.team||'enemy'],march=npcRoyalFollower(g,e)&&npcRoyalMarch(g,e.team||'enemy');
 if(march){const radius=style==='defensive'?(kind==='action'?8:kind==='retreat'?5:RANK_SPACING):style==='balanced'?NPC_SENSING.postRadius:npcBasePursuitLimit(g,e);const x=['pawn','lance'].includes(e.piece)?e.x:e.homeX,z=clamp(e.homeZ+march.forward*march.progress,arenaBounds(g).minZ,arenaBounds(g).maxZ);return {x,z,radius:Math.max(radius,Math.hypot(e.x-x,e.z-z))};}
 if(style==='balanced'&&g.npcSensing===true){const state=npcSensingFrame(g)?.states.get(e.id);if(state?.post)return state.post;}
 const radius=style==='defensive'?(kind==='action'?8:kind==='retreat'?5:0):npcBasePursuitLimit(g,e);
 return {x:e.homeX,z:e.homeZ,radius};
}
function npcPursuitLimit(g,e){return npcPost(g,e).radius;}
// A conservative envelope of the real attack geometry, not the preparation
// radius. It can admit a near miss, but cannot widen damage or reject a body
// solely because the slash's growing curved profile has not unfolded yet.
function npcAttackFacing(e, target) {
 const dx=target.x-e.x,dz=target.z-e.z,forward=e.team==='ally'?-1:1;
 return e.piece==='knight'&&dz*forward>0?{x:(dx<0?-1:1)/Math.sqrt(5),z:forward*2/Math.sqrt(5)}:enemyDirection(e,dx,dz);
}
function npcAttackKind(e,face,len,g=null) {
 const preferred=e.piece==='knight'?'jump':e.piece==='dragon'&&face&&(!face.x||!face.z)&&len>3?'charge':e.piece==='horse'&&face&&face.x&&face.z&&len>3?'charge':ACTIONS[e.piece].includes('thrust')?'thrust':ACTIONS[e.piece].includes('sweep')?'sweep':'charge';
 if(!g?.capabilityLoadout)return preferred;
 if(npcHasAbility(g,e,preferred,face))return preferred;
 return ACTIONS[e.piece].find(id=>npcHasAbility(g,e,id,face))||null;
}
function npcActionMayReach(g,e,target,face,kind) {
 if(!face||(g.capabilityLoadout&&!npcHasAbility(g,e,kind,face)))return false;
 const body={x:target.x,y:target.y||0,z:target.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS};
 if(kind==='jump') {
  const w={kind:'burst',x:clamp(e.x+Math.sign(face.x)*3,arenaBounds(g).minX,arenaBounds(g).maxX),y:.65,z:clamp(e.z+(e.team==='ally'?-6:6),arenaBounds(g).minZ,arenaBounds(g).maxZ),dx:0,dz:1,rx:2.8,ry:.65,rz:2.8};
  return waveHitsBody(w,body);
 }
 if(kind==='thrust'){const a=thrustPoint(e,face.x,face.z,THRUST.release),b=thrustPoint(e,face.x,face.z,THRUST.extendEnd),w={kind:'thrust',...b,rx:THRUST.radius,ry:THRUST.radius,rz:THRUST.radius};return sweptWaveHitsBody(w,body,a.x,a.z);}
 const charge=kind==='charge',slash=kind==='sweep';
 const travel=charge?terrainGroundDistance(g,e,face.x,face.z,npcChargeTravel(g,e,face)):slash?waveTravelDistance({kind:'slash',speed:SLASH_SPEED,life:SLASH_LIFE},0,SLASH_LIFE):8.5*(.72-.035);
 const fromX=e.x+face.x*.55,fromZ=e.z+face.z*.55;
 const toX=fromX+face.x*travel,toZ=fromZ+face.z*travel,y=(e.y||0)+ENEMY_HEIGHT/2;
 if(slash) {
  // Every growing profile fits the radius-1.9 horizontal disk. Preserve the
  // real slash's flat vertical slab; an ellipsoid would wrongly reject some
  // airborne bodies that the visible curved slash can actually touch.
  const low=body.y+Math.min(body.radius,body.height/2),high=body.y+body.height-Math.min(body.radius,body.height/2);
  const vertical=Math.max(0,Math.abs(clamp(y,low,high)-y)-.22);
  const horizontal=Math.max(0,distanceSegment(body.x,body.z,fromX,fromZ,toX,toZ)-1.9);
  return horizontal*horizontal+vertical*vertical<=body.radius*body.radius;
 }
 const w={kind:charge?'charge':'thrust',x:toX,y,z:toZ,dx:face.x,dz:face.z,rx:charge?1.4:1.25,ry:1.9,rz:charge?1.15:.6};
 return sweptWaveHitsBody(w,body,fromX,fromZ);
}
// Optional local target cooperation. This planner never starts or delays an
// action: admission, cooldowns, movement and collision remain authoritative.
const TACTIC_FOCUS=['balanced','center','left','right'];
function normalizeTeamTactics(value){const out={};for(const team of ['ally','enemy']){const v=value?.[team]||{};out[team]={cellSize:[1,2,3].includes(v.cellSize)?v.cellSize:1,focus:TACTIC_FOCUS.includes(v.focus)?v.focus:'balanced'};}return out;}
const tacticPlans=new WeakMap(),TACTIC_PERIOD=.3,TACTIC_RADIUS=5.2,TACTIC_TARGET_RADIUS=13;
function tacticEnabled(g,team){const t=g.teamTactics?.[team];return g.scenario==='army'&&t&&(t.cellSize>1||t.focus!=='balanced');}
function tacticEligible(g,e){
 const team=e.team||'enemy';return e.alive&&(e.hp??1)>0&&e.id!==g.playerId&&e.piece!=='king'&&!e.trainingGuard&&!(e.spawnProtection>0)&&!(e.invulnerable>0)&&e.reinforceTarget==null&&Math.abs(e.y||0)<.001&&!(e.stagger>0)&&!npcGuardRole(g,e)&&!KingPersonality.mobileEscort(g,e)&&!g.royalDefense?.[team]?.goals?.some(q=>q.id===e.id);
}
function tacticFoe(g,e,t){return t===g.player?(e.team||'enemy')==='enemy'&&g.hp>0: t.alive&&(t.hp??1)>0&&(t.team||'enemy')!==(e.team||'enemy');}
function tacticAttack(g,e,t){
 const len=Math.hypot(t.x-e.x,t.z-e.z),face=npcAttackFacing(e,t),kind=npcAttackKind(e,face,len,g);if(!face||len>=DIFFICULTIES[g.difficulty||'normal'].engage||!npcActionWithinPost(g,e,kind,face,len)||!npcActionMayReach(g,e,t,face,kind))return false;
 if(kind==='jump'){const end={x:e.x+Math.sign(face.x)*3,z:e.z+(e.team==='ally'?-6:6)};if(!arenaContains(g,end))return false;}
 if(kind==='charge'){const travel=Math.min(npcChargeTravel(g,e,face),Math.max(0,len-1.4));if(!terrainPath(g,e,{x:e.x+face.x*travel,z:e.z+face.z*travel}))return false;}
 return true;
}
function tacticOption(g,e,t){
 if(!tacticFoe(g,e,t)||t.trainingGuard||t.spawnProtection>0||!terrainDry(g,e)||!terrainDry(g,t))return null;
 const len=Math.hypot(t.x-e.x,t.z-e.z);if(len>TACTIC_TARGET_RADIUS)return null;
 const attack=tacticAttack(g,e,t);
 if(attack)return {target:t,distance:len,attack:true};
 // Knights cooperate only on an already legal fixed landing attack. Their
 // existing independent forward advance is never redirected by a cell.
 if(e.piece==='knight')return null;
 const limit=npcPursuitLimit(g,e);if(!(limit>0))return null;
 // Local cooperation deliberately avoids invoking the global bridge router
 // for every possible opponent. Prove a short legal dry approach instead;
 // the ordinary movement layer still owns its actual route and body checks.
 const move=npcApproachSegment(e,t);if(!move)return null;
 // Verify a legal dry attack stance on the existing first approach leg.
 // No sideways pawn/lance moves and no global or speculative routes.
 const distance=Math.min(move.distance,Math.max(0,len-2.8));if(distance<.05)return null;
 const stance={...e,x:e.x+move.x*distance,z:e.z+move.z*distance};
 const post=npcPost(g,e);if(Math.hypot(stance.x-post.x,stance.z-post.z)>post.radius+1e-7||!terrainPath(g,e,stance))return null;
 return tacticAttack(g,stance,t)?{target:t,distance:len,attack:false}:null;
}
function tacticLaneScore(g,team,t){const focus=g.teamTactics[team].focus;if(focus==='balanced')return 0;const mirror=team==='ally'?1:-1,x=focus==='left'?-12:focus==='right'?12:0;return Math.abs(t.x*mirror-x)*.5;}
function tacticRank(g,e,q){let score=q.distance+tacticLaneScore(g,e.team||'enemy',q.target);if(g.strategies?.[e.team||'enemy']==='aggressive'&&(q.target.piece==='king'||q.target===g.player&&pieceKey(g)==='king'))score-=1;if((q.target===g.player?'hero':q.target.id)===e.intentTargetId)score-=.5;return score;}
function npcTacticsPlan(g,team){
 if(!tacticEnabled(g,team))return null;
 const config=g.teamTactics[team],key=[config.cellSize,config.focus,g.playerId,g.npcCaptures,g.reinforcements,g.strategies?.[team]].join(':');let cache=tacticPlans.get(g);if(!cache){cache={};tacticPlans.set(g,cache);}const old=cache[team];if(old&&old.key===key&&g.time>=old.at&&g.time<old.until)return old;
 const units=g.enemies.filter(e=>(e.team||'enemy')===team&&tacticEligible(g,e)).sort((a,b)=>a.id-b.id),foes=g.enemies.filter(t=>t.alive&&(t.team||'enemy')!==team);if(team==='enemy'&&g.hp>0)foes.push(g.player);
 const lists=new Map();for(const e of units){let choices=foes.map(t=>tacticOption(g,e,t)).filter(Boolean);if(choices.some(q=>q.attack))choices=choices.filter(q=>q.attack);choices.sort((a,b)=>tacticRank(g,e,a)-tacticRank(g,e,b)||(a.target.id??g.playerId)-(b.target.id??g.playerId));lists.set(e.id,choices.slice(0,6));}
 const assignments=new Map(),cells=[],used=new Set(),demand=new Map();
 // Rotate seed order and exact target ties deterministically. A cell
 // persists for this bounded plan; nobody waits for its partners to catch up.
 const epoch=Math.floor(g.time/TACTIC_PERIOD),offset=units.length?epoch%units.length:0,ordered=units.slice(offset).concat(units.slice(0,offset));
 for(const e of ordered){if(used.has(e.id))continue;const choices=lists.get(e.id);let best=null;
  for(const q of choices){const t=q.target,near=units.filter(n=>n!==e&&!used.has(n.id)&&Math.hypot(n.x-e.x,n.z-e.z)<=TACTIC_RADIUS).map(n=>({unit:n,option:lists.get(n.id).find(v=>v.target===t)})).filter(v=>v.option).sort((a,b)=>Math.hypot(a.unit.x-e.x,a.unit.z-e.z)-Math.hypot(b.unit.x-e.x,b.unit.z-e.z)||a.unit.id-b.unit.id);
   const members=[{unit:e,option:q}];for(const next of near){if(members.length>=config.cellSize)break;if(members.every(v=>Math.hypot(v.unit.x-next.unit.x,v.unit.z-next.unit.z)<=TACTIC_RADIUS))members.push(next);}const count=members.length;
   const score=members.reduce((sum,v)=>sum+tacticRank(g,v.unit,v.option),0)/count+Math.max(0,(demand.get(t.id)||0)+count-(t===g.player?g.hp:t.hp??1))*.8;
   const tie=((t.id??g.playerId)-epoch+MAX_NPCS*100)%MAX_NPCS;
   if(!best||count>best.members.length||count===best.members.length&&(score<best.score-1e-7||Math.abs(score-best.score)<1e-7&&tie<best.tie))best={members,target:t,score,tie};
  }
  if(!best)continue;const cell={ids:best.members.map(v=>v.unit.id),targetId:best.target===g.player?'hero':best.target.id};cells.push(cell);for(const {unit,option} of best.members){used.add(unit.id);assignments.set(unit.id,{target:best.target,attack:option.attack,cell});}demand.set(best.target.id,(demand.get(best.target.id)||0)+best.members.length);
 }
 return cache[team]={key,at:g.time,until:g.time+TACTIC_PERIOD,assignments,cells};
}
function npcTacticsTarget(g,e){
 const team=e.team||'enemy';if(!tacticEnabled(g,team)||!tacticEligible(g,e))return null;
 const plan=npcTacticsPlan(g,team),choice=plan?.assignments.get(e.id);if(!choice||!tacticFoe(g,e,choice.target))return null;
 // Membership is advisory and revalidated on use, including capture, control,
 // respawn grace and a moving target that has become legally unreachable.
 const option=tacticOption(g,e,choice.target);if(!option)return null;
 if(!option.attack){const foes=g.enemies.filter(t=>t.alive&&(t.team||'enemy')!==team);if(team==='enemy'&&g.hp>0)foes.push(g.player);if(foes.some(t=>{const f=npcAttackFacing(e,t),d=Math.hypot(t.x-e.x,t.z-e.z),k=npcAttackKind(e,f,d,g);return f&&d<DIFFICULTIES[g.difficulty||'normal'].engage&&npcActionWithinPost(g,e,k,f,d)&&npcActionMayReach(g,e,t,f,k);}))return null;}
 return choice.target;
}

// Optional sensing and marching roles. No hidden future input, stat change,
// shared vision or forced displacement: the existing movement/action layers
// still validate every resulting step, leap and windup admission.
const NPC_SENSING=Object.freeze({enter:13,leave:15.5,lostDwell:.8,minDwell:.6,supportLag:2.4,reserveLag:4.8,progressStep:.75,postRadius:13});
const sensingFrames=new WeakMap();
// A native same-body promotion may hand local perception to the next rebuild.
// Capability identity, routes, attacks, duties and march budgets still reset.
const npcPromotionPerceptionPending=new WeakMap();
function npcPromotionPerceptionEnabled(g){return g.scenario==='army'&&g.npcSensing===true&&automaticAwakening(g);}
function npcPromotionPerceptionIdentity(g,e,piece=e.piece){const team=e.team||'enemy';return [team,e.homeX,e.homeZ,piece,g.playerId,g.teamTactics?.[team]?.focus,g.strategies?.[team]].join(':');}
function npcForgetPromotionPerception(g,actor=null,clearFrame=false){
 const pending=npcPromotionPerceptionPending.get(g);if(actor)pending?.delete(actor);else npcPromotionPerceptionPending.delete(g);
 if(clearFrame&&npcPromotionPerceptionEnabled(g)){if(actor)sensingFrames.get(g)?.states.delete(actor.id);else sensingFrames.delete(g);}
}
function npcRememberPromotionPerception(g,actor,from,to){
 if(!npcPromotionPerceptionEnabled(g)){npcPromotionPerceptionPending.delete(g);return;}
 const sourceFrame=sensingFrames.get(g),prior=sourceFrame?.states.get(actor.id),team=actor.team||'enemy';
 if(actor===g.player||actor.id===g.playerId||!actor.alive||!(actor.hp>0)||PIECES[from]?.promote!==to||actor.piece!==from||prior?.actorRef!==actor||prior.identity!==npcPromotionPerceptionIdentity(g,actor,from))return;
 let pending=npcPromotionPerceptionPending.get(g);if(!pending){pending=new Map();npcPromotionPerceptionPending.set(g,pending);}
 pending.set(actor,{actor,id:actor.id,team,homeX:actor.homeX,homeZ:actor.homeZ,playerId:g.playerId,focus:g.teamTactics?.[team]?.focus,strategy:g.strategies?.[team],from,to,sourceFrame,tracked:new Map(prior.tracked),mode:prior.mode,enteredAt:prior.enteredAt,lastContactAt:prior.lastContactAt,encounter:prior.encounter?{...prior.encounter}:null});
}
function npcPromotionPerceptionMatches(g,e,receipt,old){
 const team=e.team||'enemy';return !!receipt&&receipt.sourceFrame===old&&receipt.actor===e&&receipt.id===e.id&&receipt.team===team&&receipt.homeX===e.homeX&&receipt.homeZ===e.homeZ&&receipt.playerId===g.playerId&&receipt.focus===g.teamTactics?.[team]?.focus&&receipt.strategy===g.strategies?.[team]&&receipt.to===e.piece&&PIECES[receipt.from]?.promote===receipt.to&&e.alive&&e.hp>0;
}
function sensingRole(g,e){
 if(npcCastleDuty(g,e))return 'castle-defense';
 const focus=g.teamTactics?.[e.team||'enemy']?.focus||'balanced',x=e.homeX*(e.team==='ally'?1:-1);
 if(focus==='balanced')return 'assault';
 if(focus==='center')return Math.abs(x)<=5.1?'assault':'reserve';
 const lane=x*(focus==='left'?-1:1);return lane>1.7?'assault':lane< -1.7?'reserve':'support';
}
function sensingEligible(g,e){
 return e.alive&&(e.hp??1)>0&&e.id!==g.playerId&&e.piece!=='king'&&!e.trainingGuard&&e.reinforceTarget==null
  &&!npcGuardRole(g,e)&&!KingPersonality.mobileEscort(g,e)&&!g.royalDefense?.[e.team||'enemy']?.goals?.some(q=>q.id===e.id);
}
function sensingToken(g,t){return t===g.player?'hero':t.id;}
// Preserve a bounded local assault post without trapping a still-visible
// retreating opponent just beyond its original center. Only an otherwise
// executable forward step blocked by the spent post can renew that budget.
function npcRenewedEncounterPost(g,e,state){
 const team=e.team||'enemy',forward=team==='ally'?-1:1;
 if(g.strategies?.[team]!=='balanced'||state.role!=='assault'||state.mode!=='combat'||!state.encounter||!state.contacts.size||!g.active||battleEnded(g)||e.attack!=='idle'||e.stagger>0||e.spawnProtection>0||Math.abs(e.y||0)>=.001||e.piece==='knight')return null;
 const target=e.intentTargetId==='hero'?g.player:g.enemies.find(t=>t.id===e.intentTargetId),post=state.post;
 if(!target||!tacticFoe(g,e,target)||!state.contacts.has(sensingToken(g,target))||(target.z-e.z)*forward<=0||Math.hypot(target.x-post.x,target.z-post.z)<=post.radius+1e-7)return null;
 const move=npcApproachSegment(e,target,g);if(!move||move.z*forward<=0)return null;
 const distance=terrainGroundDistance(g,e,move.x,move.z,movementSpeed(g,team,true)*.05,move.distance),next={x:e.x+move.x*distance,z:e.z+move.z*distance};
 if(!arenaContains(g,next)||Math.hypot(next.x-post.x,next.z-post.z)<=post.radius+1e-7)return null;
 const p=g.player;if(p&&(p.y||0)<=1.5&&distanceSegment(p.x,p.z,e.x,e.z,next.x,next.z)<=1.6&&!((e.x-p.x)*(next.x-e.x)+(e.z-p.z)*(next.z-e.z)>=0&&Math.hypot(e.x-p.x,e.z-p.z)<1.6))return null;
 const probe={x:e.x,z:e.z};clipRush(g,probe,next.x,next.z,e,true,1.4);if(Math.hypot(probe.x-next.x,probe.z-next.z)>1e-7)return null;
 return {x:e.x,z:e.z,radius:NPC_SENSING.postRadius};
}
function npcSensingFrame(g,lock=false){
 const carryEnabled=npcPromotionPerceptionEnabled(g);if(!carryEnabled)npcPromotionPerceptionPending.delete(g);
 if(g.npcSensing!==true||g.scenario!=='army')return null;
 let frame=sensingFrames.get(g);if(frame?.locked&&frame.at===g.time)return frame;
 const key=[g.time,g.playerId,g.npcCaptures,g.reinforcements,g.teamTactics?.ally?.focus,g.teamTactics?.enemy?.focus,g.strategies?.ally,g.strategies?.enemy].join(':');
 if(frame?.key===key&&!lock)return frame;
 const old=frame,states=new Map(),units=g.enemies.filter(e=>sensingEligible(g,e)),pending=carryEnabled?npcPromotionPerceptionPending.get(g):null;
 // Cache hits above preserve the receipt; every actual rebuild consumes it once.
 npcPromotionPerceptionPending.delete(g);
 // All contacts and line progress use the same pre-movement snapshot.
 for(const e of units){
  const team=e.team||'enemy',identity=[team,e.homeX,e.homeZ,e.piece,g.playerId,g.teamTactics?.[team]?.focus,g.strategies?.[team]].join(':'),prior=old?.states.get(e.id);
  const sameOwner=!carryEnabled||prior?.actorRef===e,carry=carryEnabled&&npcPromotionPerceptionMatches(g,e,pending?.get(e),old)?pending.get(e):null;
  const state=prior?.identity===identity&&sameOwner?{...prior,contacts:new Set(),tracked:new Map(prior.tracked)}: {identity,contacts:new Set(),tracked:new Map(),mode:'march',enteredAt:-Infinity,lastContactAt:-Infinity,unlocked:0};
  state.actorRef=e;
  if(carry){state.tracked=new Map(carry.tracked);state.mode=carry.mode;state.enteredAt=carry.enteredAt;state.lastContactAt=carry.lastContactAt;state.encounter=carry.encounter?{...carry.encounter}:null;} // promotion-perception-consumed
  const foes=g.enemies.filter(t=>tacticFoe(g,e,t));if(team==='enemy'&&g.hp>0)foes.push(g.player);
  for(const [id,at] of state.tracked)if(g.time-at>=NPC_SENSING.lostDwell||!foes.some(t=>sensingToken(g,t)===id))state.tracked.delete(id);
  for(const t of foes){const id=sensingToken(g,t),d=Math.hypot(t.x-e.x,t.z-e.z);if(d<=NPC_SENSING.enter||state.tracked.has(id)&&d<=NPC_SENSING.leave){state.contacts.add(id);state.tracked.set(id,g.time);}}
  const localCapture=prior?.identity===identity&&sameOwner&&((g.npcCaptures||0)>(prior.captureCount||0)||(g.reinforcements||0)>(prior.reinforcementCount||0))&&[...prior.contacts].some(id=>{
   const t=id==='hero'?g.player:g.enemies.find(n=>n.id===id);return t&&(!tacticFoe(g,e,t)||!t.alive);
  });
  if(localCapture)state.encounter={x:e.x,z:e.z,radius:NPC_SENSING.postRadius};
  if(state.contacts.size){if(state.mode==='march'){state.enteredAt=g.time;state.encounter={x:e.x,z:e.z,radius:NPC_SENSING.postRadius};}state.mode='combat';state.lastContactAt=g.time;}
  else if(g.time-state.lastContactAt<NPC_SENSING.lostDwell||g.time-state.enteredAt<NPC_SENSING.minDwell)state.mode='combat';else state.mode='march';
  state.captureCount=g.npcCaptures||0;state.reinforcementCount=g.reinforcements||0;state.role=sensingRole(g,e);state.team=team;if(state.role==='castle-defense'){state.post=npcCastleDuty(g,e);state.encounter=null;state.unlocked=0;state.marchProgress=0;}states.set(e.id,state);
 }
 for(const team of ['ally','enemy']){
  const side=units.filter(e=>(e.team||'enemy')===team&&!npcCastleDuty(g,e)),focus=g.teamTactics?.[team]?.focus||'balanced',mirror=team==='ally'?1:-1;
  // Capture/control changes cannot leave an entire surviving force waiting
  // for a vanished assault lane. Promote the nearest surviving lane member.
  if(side.length&&!side.some(e=>states.get(e.id).role==='assault')){
   const lane=focus==='left'?-10.2:focus==='right'?10.2:0;
   const next=[...side].sort((a,b)=>Math.abs(a.homeX*mirror-lane)-Math.abs(b.homeX*mirror-lane)||a.id-b.id)[0];states.get(next.id).role='assault';
  }
  const forward=-mirror,lead=Math.max(0,...side.filter(e=>states.get(e.id).role==='assault').map(e=>(e.z-e.homeZ)*forward));
  for(const e of side){const state=states.get(e.id),lag=state.role==='reserve'?NPC_SENSING.reserveLag:state.role==='support'?NPC_SENSING.supportLag:0;
   // A released post only advances. Lost leaders never pull a forward-only
   // pawn backward or make units oscillate at a moving line threshold.
   state.unlocked=state.role==='assault'?Infinity:Math.max(Number.isFinite(state.unlocked)?state.unlocked:0,Math.floor(Math.max(0,lead-lag)/NPC_SENSING.progressStep)*NPC_SENSING.progressStep);
   state.marchProgress=state.role==='assault'?Math.max(state.marchProgress||0,9,lead):state.unlocked;
   // PROTOTYPE: continue an initial assault's assigned forward lane after
   // local contact is lost and its released line is consumed. No foe location
   // or new action is supplied; normal routes, posts and collisions still own
   // every actual movement. Guards, royal marches and reserve releases differ.
   if(g.strategies?.[team]==='balanced'&&state.role==='assault'&&state.mode==='march'&&e.recruitedTeam!==team&&!npcRoyalFollower(g,e)&&g.active&&!battleEnded(g)&&e.attack==='idle'&&!(e.stagger>0)&&!(e.spawnProtection>0)&&Math.abs(e.y||0)<.001){
    const progress=(e.z-e.homeZ)*forward,remaining=state.marchProgress-progress,maxProgress=forward>0?arenaBounds(g).maxZ-e.homeZ:e.homeZ-arenaBounds(g).minZ;
    if(e.piece==='knight'?remaining<6-1e-7:remaining<=.15)state.marchProgress=Math.min(maxProgress,Math.max(state.marchProgress,progress+9));
   }
   // March only to the released line. This moving local post cannot create
   // blind forward progress: the march goal is never beyond that line.
   state.post=state.mode==='combat'&&state.encounter?state.encounter:{x:e.x,z:e.z,radius:NPC_SENSING.postRadius};
   const renewed=npcRenewedEncounterPost(g,e,state);if(renewed)state.post=state.encounter=renewed;
  }
 }
 frame={key,states,at:g.time,locked:lock,playerId:g.playerId,npcCaptures:g.npcCaptures,reinforcements:g.reinforcements};sensingFrames.set(g,frame);return frame;
}
function npcTacticalState(g,e){
 const state=npcSensingFrame(g)?.states.get(e.id);if(!state)return null;
 return {mode:state.mode,searching:state.mode==='combat'&&!state.contacts.size,role:state.role,post:{...state.post},marchProgress:state.marchProgress,visibleIds:[...state.contacts].sort((a,b)=>a==='hero'?1:b==='hero'?-1:a-b),unlocked:state.unlocked,enteredAt:state.enteredAt,lastContactAt:state.lastContactAt};
}
// A visible but legally unreachable foe (for example behind a pawn) does
// not command an illegal turn or permanent wait. That actor maintains its
// assigned lane until a legal local target becomes available.

// EXPERIMENT ONLY: an assault that has exhausted its forward edge can search
// back along its own known home lane. No opponent coordinates are consumed.
// A local contact always owns target choice; this leg resumes only after the
// existing loss dwell. Royal orders, defensive and unreleased lanes retain duty.
const assaultReturnSearches=new WeakMap();
function npcAssaultReturnSearch(g,e,state){
 const team=e.team||'enemy',identity=state.identity;
 if(state.role!=='assault'||g.strategies?.[team]==='defensive'||!sensingEligible(g,e)||npcRoyalFollower(g,e)) {assaultReturnSearches.delete(e);return null;}
 let leg=assaultReturnSearches.get(e);
 if(!g.active||battleEnded(g)||state.mode!=='march'||state.contacts.size||e.attack!=='idle'||e.stagger>0||e.spawnProtection>0||e.invulnerable>0||Math.abs(e.y||0)>=.001){if(leg)leg.observedAt=null;return null;}
 if(leg&&leg.identity!==identity){assaultReturnSearches.delete(e);leg=null;}
 const a=arenaBounds(g),edge=team==='ally'?e.z-a.minZ:a.maxZ-e.z;
 // A completed short leg cannot relatch within the same end strip.
 // It rearms only after a real observation outside that strip.
 if(leg?.complete){if(edge>1.75)assaultReturnSearches.delete(e);return null;}
 if(!leg){
  if(edge>1.6||edge< -1e-7||!Number.isFinite(e.homeX)||!Number.isFinite(e.homeZ)||Math.hypot(e.x-e.homeX,e.z-e.homeZ)<=1.6)return null;
  const goal={x:e.homeX,z:e.homeZ};
  if(!arenaContains(g,goal)||!npcRoute(e,goal.x,goal.z,g))return null;
  leg={identity,...goal,observedAt:g.time,observedX:e.x,observedZ:e.z,stoppedSince:g.time};assaultReturnSearches.set(e,leg);
 }
 // Only observed real standstill consumes an occupied near-home arrival.
 // Calls repeated in one tick cannot advance the timer; combat/phase gaps
 // reset it. An obstruction further along the route is not an arrival.
 if(leg.observedAt===null||g.time>leg.observedAt+1e-9){
  if(leg.observedAt===null||g.time-leg.observedAt>.1||Math.hypot(e.x-leg.observedX,e.z-leg.observedZ)>1e-7)leg.stoppedSince=g.time;
  leg.observedAt=g.time;leg.observedX=e.x;leg.observedZ=e.z;
 }
 const remaining=Math.hypot(leg.x-e.x,leg.z-e.z);
 if(remaining<=.15||remaining<=1.6&&g.time-leg.stoppedSince>=NPC_SENSING.minDwell-1e-7){leg.complete=true;return null;}
 if(!npcRoute(e,leg.x,leg.z,g))return null;
 return {x:leg.x,z:leg.z,tacticalMarch:true,role:'assault',assaultReturnSearch:true};
}

function npcMarchTarget(g,e,state){
 if(npcCastleDuty(g,e))return npcCastleReturnTarget(g,e,state);
 if(!state||state.mode==='combat'&&!state.contacts.size)return null;
 const team=e.team||'enemy',forward=team==='ally'?-1:1,limit=npcPursuitLimit(g,e);
 if(!(limit>0))return null;
 const search=npcAssaultReturnSearch(g,e,state);if(search)return search;
 // A recruited assault unit keeps the existing recruit pursuit contract.
 // Local sensing still chooses every enemy; the encounter post, legal routes,
 // body/terrain clips and a live royal march retain their existing authority.
 // Initial units and unreleased support/reserve lanes keep their old budget.
 const recruitedAssault=e.recruitedTeam===team&&state.role==='assault';
 const march=npcRoyalFollower(g,e)&&npcRoyalMarch(g,team),maxProgress=forward>0?arenaBounds(g).maxZ-e.homeZ:e.homeZ-arenaBounds(g).minZ,cap=Math.min(maxProgress,march?march.progress+RANK_SPACING:g.strategies?.[team]==='balanced'?(recruitedAssault?npcBasePursuitLimit(g,e):state.marchProgress):Math.min(limit,state.unlocked)),progress=(e.z-e.homeZ)*forward;
 if(!(cap-progress>.15))return null;
 let x=e.piece==='pawn'||e.piece==='lance'?e.x:e.homeX,z=e.homeZ+forward*cap;
 if(e.piece==='knight'){
  if(cap-progress<6-1e-7)return null;
  const focus=g.teamTactics?.[team]?.focus||'balanced',mirror=-forward,lane=(focus==='left'?-10.2:focus==='right'?10.2:0)*mirror;
  let dx=Math.sign(lane-e.x)||Math.sign(-e.x)||mirror;
  if(e.x+dx*3<arenaBounds(g).minX||e.x+dx*3>arenaBounds(g).maxX)dx=-dx;
  x=e.x+dx*3;z=e.z+forward*6;
  if(!npcActionWithinPost(g,e,'jump',{x:dx/Math.sqrt(5),z:forward*2/Math.sqrt(5)},Math.sqrt(45)))return null;
 }
 return {x,z,tacticalMarch:true,role:state.role,maintainLane:state.mode==='combat'};
}
// A short legal first-leg commitment can release a friendly traffic jam.
// This only chooses another obstacle-free shortest-path ordering; it never
// changes a piece's movement mask or moves a blocker out of the way.
// The 3.2-unit/1.6-second lease is local (less than one file spacing);
// attacks and royal assignments retain priority, and every step still clips.
const friendlyRouteLegs=new WeakMap();
function npcFriendlyRoute(g,e,target,primary){
 if(g.npcSensing!==true||!primary||!sensingEligible(g,e)||!(npcPursuitLimit(g,e)>0)){friendlyRouteLegs.delete(e);return primary;}
 const dirs=e.piece==='dragon'?C:e.piece==='horse'?D:PIECES[e.piece]?.dirs||[];
 if(dirs.length<2){friendlyRouteLegs.delete(e);return primary;}
 const state=npcSensingFrame(g)?.states.get(e.id);if(!state){friendlyRouteLegs.delete(e);return primary;}
 const post=npcPost(g,e),identity=[state.identity,state.role,target.tacticalMarch?'march':target===g.player?'hero':target.id].join(':');
 const within=point=>arenaContains(g,point)&&Math.hypot(point.x-post.x,point.z-post.z)<=post.radius+1e-7;
 const clear=(move,distance)=>{
  const end={x:e.x+move.x*distance,z:e.z+move.z*distance},probe={x:e.x,z:e.z},p=g.player;
  if(!within(end))return false;
  if(p&&(p.y||0)<=1.5&&distanceSegment(p.x,p.z,e.x,e.z,end.x,end.z)<=1.6&&!((e.x-p.x)*move.x+(e.z-p.z)*move.z>=0&&Math.hypot(e.x-p.x,e.z-p.z)<1.6))return false;
  clipRush(g,probe,end.x,end.z,e,true,1.4);
  return Math.hypot(probe.x-end.x,probe.z-end.z)<1e-7;
 };
 const old=friendlyRouteLegs.get(e);
 if(old){
  const dx=old.x-e.x,dz=old.z-e.z,distance=dx*old.dx+dz*old.dz;
  if(old.identity===identity&&g.time<old.until&&Math.hypot(target.x-old.goalX,target.z-old.goalZ)<2&&distance>1e-7&&Math.abs(dx*old.dz-dz*old.dx)<1e-7&&within(old))return {x:old.dx,z:old.dz,distance};
  friendlyRouteLegs.delete(e);
 }
 // Only a real close friendly body obstruction enables this exception.
 // Forward-only units cannot yield sideways or backwards.
 const probeDistance=Math.min(.12,primary.distance),px=e.x+primary.x*probeDistance,pz=e.z+primary.z*probeDistance;
 const blocked=g.enemies.some(b=>b!==e&&b.alive&&b.team===e.team&&(b.y||0)<HERO_HEIGHT&&distanceSegment(b.x,b.z,e.x,e.z,px,pz)<1.4-1e-7&&(e.x-b.x)*primary.x+(e.z-b.z)*primary.z< -1e-7);
 if(!blocked)return primary;
 const alternate=nextLegalSegment([...dirs].reverse(),e.team||'enemy',target.x-e.x,target.z-e.z);
 if(!alternate||alternate.x*primary.x+alternate.z*primary.z>1-1e-7)return primary;
 const distance=Math.min(3.2,alternate.distance);
 if(distance<.15||!clear(alternate,distance))return primary;
 const leg={identity,x:e.x+alternate.x*distance,z:e.z+alternate.z*distance,dx:alternate.x,dz:alternate.z,goalX:target.x,goalZ:target.z,until:g.time+1.6};
 friendlyRouteLegs.set(e,leg);return {x:alternate.x,z:alternate.z,distance};
}
function npcMarchMove(g,e,target,dt,slashMotions){
 if(!target?.tacticalMarch||e.piece==='knight')return false;
 e.intent=target.castleReturn?'castle_return':target.maintainLane?'maintain_lane':target.role==='reserve'?'reserve_advance':target.role==='support'?'support_advance':'tactic_advance';
 const primary=npcRoute(e,target.x,target.z,g),move=npcFriendlyRoute(g,e,target,primary);if(!move)return true;
 const travel=terrainGroundDistance(g,e,move.x,move.z,movementSpeed(g,e.team||'enemy',true)*dt,move.distance),post=npcPost(g,e);
 if(npcCastleDuty(g,e)?npcCastleStepAllowed(g,e,{x:e.x+move.x*travel,z:e.z+move.z*travel}):Math.hypot(e.x+move.x*travel-post.x,e.z+move.z*travel-post.z)<=post.radius+1e-7)moveNPC(g,e,move===primary?target.x:e.x+move.x*move.distance,move===primary?target.z:e.z+move.z*move.distance,dt,slashMotions);
 return true;
}

// A nearby visible foe may be ahead of a knight without admitting either
// its fixed landing attack or its existing forward advance. Reconsider only
// other local contacts, at a bounded cadence, while ordinary idle/grounded.
// Admission, warning, cooldown, post, terrain and landing rules stay in charge.
const npcKnightAdvanceChecks=new WeakMap();
function npcKnightAdvanceTarget(g,e,state,current,candidates){
 if(!state||e.piece!=='knight'||!current||!g.active||battleEnded(g)||e.attack!=='idle'||e.stagger>0||e.spawnProtection>0||Math.abs(e.y||0)>=.001||!(npcPursuitLimit(g,e)>0))return null;
 const forward=e.team==='ally'?-1:1,legal=t=>{
  const face=npcAttackFacing(e,t),end=face&&{x:e.x+Math.sign(face.x)*3,z:e.z+forward*6};
  return !!face&&(t.z-e.z)*forward>6&&arenaContains(g,end)&&npcActionWithinPost(g,e,'jump',face,Math.hypot(t.x-e.x,t.z-e.z));
 };
 if(legal(current))return null;
 const identity=state.identity,old=npcKnightAdvanceChecks.get(e);
 if(old&&old.identity===identity&&g.time>=old.at&&g.time<old.until){const target=candidates.find(t=>sensingToken(g,t)===old.targetId);return target&&legal(target)?target:null;}
 let best=null,score=Infinity;
 for(const t of candidates){if(!legal(t))continue;let q=Math.hypot(t.x-e.x,t.z-e.z);if(g.strategies?.[e.team||'enemy']==='aggressive'&&(t.piece==='king'||t===g.player&&pieceKey(g)==='king'))q-=1;if(sensingToken(g,t)===e.intentTargetId)q-=.5;const id=t===g.player?g.playerId:t.id;if(q<score||Math.abs(q-score)<1e-9&&id<(best===g.player?g.playerId:best?.id)){best=t;score=q;}}
 npcKnightAdvanceChecks.set(e,{identity,at:g.time,until:g.time+.18,targetId:best?sensingToken(g,best):null});
 return best;
}

function npcTarget(g,e){
 const sensed=npcSensingFrame(g)?.states.get(e.id);
 if(npcCastleDuty(g,e)&&!sensed)return null;
 const tactical=npcTacticsTarget(g,e);if(tactical&&(!sensed||sensed.contacts.has(sensingToken(g,tactical)))&&npcCastleCanServe(g,e,tactical)){e.intentUntil=g.time;e.intentTargetId=tactical===g.player?'hero':tactical.id;return tactical;}
 const team=e.team||'enemy',candidates=g.enemies.filter(t=>t.alive&&(t.team||'enemy')!==team);if(team==='enemy'&&g.hp>0)candidates.push(g.player);
 if(sensed)for(let i=candidates.length-1;i>=0;i--)if(!sensed.contacts.has(sensingToken(g,candidates[i]))||!npcCastleCanServe(g,e,candidates[i]))candidates.splice(i,1);
 const forward=team==='ally'?-1:1,reachable=t=>{const dx=t.x-e.x,dz=t.z-e.z;return e.piece==='knight'?dz*forward>0:!!enemyDirection(e,dx,dz)||!!npcRoute(e,t.x,t.z,g);};
 const old=candidates.find(t=>(t===g.player?'hero':t.id)===e.intentTargetId);if(!sensed&&g.time<(e.intentUntil||0)&&old&&reachable(old))return old;
 const guarded=npcGuardRole(g,e),kingSlot=(g.kingPersonalities&&KingPersonality.liveKing(g,team))||g.formationSlots.find(t=>t.team===team&&t.slotKey===4);let best=null,score=Infinity,bestAttack=null,attackScore=Infinity;
 for(const t of candidates){if(!reachable(t))continue;let q=Math.hypot(t.x-e.x,t.z-e.z);if(!enemyDirection(e,t.x-e.x,t.z-e.z)&&e.piece!=='knight')q+=2;if(guarded&&kingSlot&&Math.hypot(t.x-kingSlot.x,t.z-kingSlot.z)<9)q-=5;if(g.strategies?.[team]==='aggressive'&&(t.piece==='king'||t===g.player&&pieceKey(g)==='king'))q-=1;if(t===old)q-=.5;if(q<score||sensed&&Math.abs(q-score)<1e-9&&(t===g.player?g.playerId:t.id)<(best===g.player?g.playerId:best.id)){best=t;score=q;}const face=npcAttackFacing(e,t),len=Math.hypot(t.x-e.x,t.z-e.z);if(face&&len<DIFFICULTIES[g.difficulty||'normal'].engage&&(q<attackScore||sensed&&Math.abs(q-attackScore)<1e-9&&(t===g.player?g.playerId:t.id)<(bestAttack===g.player?g.playerId:bestAttack.id))&&npcActionWithinPost(g,e,npcAttackKind(e,face,len,g),face,len)&&npcActionMayReach(g,e,t,face,npcAttackKind(e,face,len,g))){bestAttack=t;attackScore=q;}}
 if(!bestAttack)best=npcKnightAdvanceTarget(g,e,sensed,best,candidates)||best;
 const following=!bestAttack&&npcRoyalFollower(g,e)?npcMarchTarget(g,e,sensed):null;best=bestAttack||best;e.intentUntil=g.time+.18;e.intentTargetId=best?(best===g.player?'hero':best.id):null;return following||best||npcMarchTarget(g,e,sensed);
}
function npcRetreatTarget(g,e,target,dt){const dx=target.x-e.x,dz=target.z-e.z,len=Math.hypot(dx,dz);if(len<.01)return null;const point={x:clamp(e.x-dx/len*2,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(e.z-dz/len*2,arenaBounds(g).minZ,arenaBounds(g).maxZ)},post=npcPost(g,e,'retreat'),limit=post.radius,before=Math.hypot(e.x-post.x,e.z-post.z);if(Math.hypot(point.x-post.x,point.z-post.z)>Math.max(limit,before)+1e-7)return null;const route=npcRoute(e,point.x,point.z,g);if(!route)return null;const travel=Math.min(route.distance,movementSpeed(g,e.team||'enemy',true)*dt);if(Math.hypot(e.x+route.x*travel-post.x,e.z+route.z*travel-post.z)>Math.max(limit,before)+1e-7)return null;return point;}
function npcApproachSegment(e,target,g=null){const route=npcRoute(e,target.x,target.z,g);if(route)return route;const dx=target.x-e.x,dz=target.z-e.z,face=enemyDirection(e,dx,dz);if(!face||e.piece==='dragon'&&face.x&&face.z||e.piece==='horse'&&(!face.x||!face.z))return null;const distance=dx*face.x+dz*face.z;return distance>1e-7?{...face,distance}:null;}
function arenaTravel(x,z,dx,dz,distance,g=null){const a=arenaBounds(g);let result=distance;if(dx>0)result=Math.min(result,(a.maxX-x)/dx);if(dx<0)result=Math.min(result,(a.minX-x)/dx);if(dz>0)result=Math.min(result,(a.maxZ-z)/dz);if(dz<0)result=Math.min(result,(a.minZ-z)/dz);return Math.max(0,result);}
function npcChargeTravel(g,e,face,postOverride=null){let distance=CHARGE_SPEED*.38;if(g.strategies){const post=postOverride||npcPost(g,e,'action'),limit=post.radius;if(Number.isFinite(limit)){const x=e.x-post.x,z=e.z-post.z,b=x*face.x+z*face.z,c=x*x+z*z-limit*limit,disc=b*b-c;if(c>1e-7||disc<0)return 0;distance=Math.min(distance,Math.max(0,-b+Math.sqrt(disc)));}}return arenaTravel(e.x,e.z,face.x,face.z,distance,g);}
function npcActionWithinPost(g,e,kind,face,len){if(g.capabilityLoadout&&!npcHasAbility(g,e,kind,face))return false;if(kind==='jump'&&!terrainJump(g,e,{x:clamp(e.x+Math.sign(face.x)*3,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(e.z+(e.team==='ally'?-6:6),arenaBounds(g).minZ,arenaBounds(g).maxZ)},e.team||'enemy'))return false;if(kind==='charge')return npcChargeTravel(g,e,face)>.05;if(!g.strategies||kind!=='jump')return true;const post=npcPost(g,e,'action'),limit=post.radius;if(!Number.isFinite(limit))return true;return Math.hypot(e.x+Math.sign(face.x)*3-post.x,e.z+(e.team==='ally'?-6:6)-post.z)<=limit+1e-7;}
function enemyDirection(e,x,z){const ax=Math.abs(x),az=Math.abs(z);let sx=Math.sign(x),sz=Math.sign(z);if(ax<az*.414)sx=0;else if(az<ax*.414)sz=0;const dirs=PIECES[e.piece||'pawn'].dirs;if(!dirs.some(([a,b])=>(e.team==='ally'?a:-a)===sx&&(e.team==='ally'?b:-b)===sz))return null;const n=Math.hypot(sx,sz);return n?{x:sx/n,z:sz/n}:null;}
function isStepDirection(g,x,z){const k=pieceKey(g);return (k==='dragon'&&x!==0&&z!==0)||(k==='horse'&&(x===0||z===0));}
function direction(g,x,z){if(!g.player)return {x:0,z:0};
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.max(Math.abs(x),Math.abs(z))<.06)return {x:0,z:0};
 const k=pieceKey(g);if(k==='rook')return cardinal(x,z,g.player);
 const ax=Math.abs(x),az=Math.abs(z);let sx=Math.sign(x),sz=Math.sign(z);
 if(ax<az*.414)sx=0;else if(az<ax*.414)sz=0;
 if(!allowed(g,sx,sz))return {x:0,z:0};const n=Math.hypot(sx,sz);return {x:sx/n,z:sz/n};
}
const JUMP_DURATION=.9,JUMP_HEIGHT=4.3,JUMP_DISTANCE=7.2;
// Optional initial handicap allocation. Captured player stock is never touched.
function handicapReserveOption(options){let owner=options,field;while(owner&&!field){field=Object.getOwnPropertyDescriptor(owner,'handicapToEnemyReserve');owner=Object.getPrototypeOf(owner);}if(field&&!Object.prototype.hasOwnProperty.call(field,'value'))throw new TypeError('Handicap reserve option must be a data option');const value=field?.value;if(value!==undefined&&value!==true&&value!==false)throw new TypeError('Handicap reserve option must be boolean');return value===true;}
function handicapDeploymentOption(options){let owner=options,field;while(owner&&!field){field=Object.getOwnPropertyDescriptor(owner,'handicapEnemyDeployment');owner=Object.getPrototypeOf(owner);}if(field&&!Object.prototype.hasOwnProperty.call(field,'value'))throw new TypeError('Handicap deployment must be a data option');const value=field?.value;if(value!==undefined&&value!=='reserve'&&value!=='promoted-start')throw new TypeError('Invalid handicap deployment mode');return value||'reserve';}
// Only actors allocated by installHandicapEnemyReserves opt in. Public fields,
// cloned bodies and ordinary captures cannot grant this provenance.
const handicapTransferredActors=new WeakSet();
// Native control switching alone replaces an actor with role-specific bodies.
// Carry authority only at that private commit boundary, not by public ID/flags.
function inheritHandicapTransfer(from,to){
 if(handicapTransferredActors.has(from)&&from.id===to.id&&from.slotKey===to.slotKey&&capturedReturnBase(from)===capturedReturnBase(to))handicapTransferredActors.add(to);
}
function handicapPhysicalFile(x){return Number.isFinite(x)?clamp(Math.floor(x/FILE_SPACING+4.5),0,8):null;}
function handicapTransferReturnLegal(g,e){
 if(!handicapTransferredActors.has(e))return true;
 // A captured promoted actor returns as its ordinary base, just as respawnNPC
 // restores below. Its current corpse form must not bypass pawn/drop rules.
 const piece=capturedReturnBase(e);if(!['pawn','lance','knight'].includes(piece))return true;
 const team=e.pendingTeam,pos=g.formationSlots.find(s=>s.team===team&&s.slotKey===e.slotKey);
 if(!pos||!['ally','enemy'].includes(team)||!Number.isFinite(pos.z))return false;
 // Canonical formation coordinates, NOT decorative board seams: the enemy
 // back rank is 7-2*3.8=-0.6, and the ally back rank is its z->30-z mirror.
 // Count nearest ranks away from the receiving team's forward dead edge.
 // Midpoint ties go to the farther-from-edge rank; knights need two ranks.
 // A 1e-9 world-unit tolerance makes those ties stable under mirrored floats.
 const enemyBack=7-2*RANK_SPACING,deadEdge=team==='ally'?enemyBack:30-enemyBack;
 const awayFromEdge=(pos.z-deadEdge)*(team==='ally'?1:-1);
 if(awayFromEdge<((piece==='knight'?2:1)-.5)*RANK_SPACING-1e-9)return false;
 if(piece!=='pawn')return true;
 // Nine canonical physical files x=(col-4)*3.4. Moving actors use current x;
 // midpoint ties go toward increasing x, and outer apron stays in edge files.
 const file=handicapPhysicalFile(pos.x);if(file===null)return false;
 if(g.enemies.some(b=>b!==e&&b.team===team&&b.alive&&b.hp>0&&b.piece==='pawn'&&!b.promoted&&handicapPhysicalFile(b.x)===file))return false;
 return !(g.player&&g.player.team===team&&g.player.alive!==false&&g.hp>0&&pieceKey(g)==='pawn'&&handicapPhysicalFile(g.player.x)===file);
}

function installHandicapEnemyReserves(g,templates,deployment){
 if(g.scenario!=='army'||g.battleScenario||!g.formationHero||isSpectator(g)||!g.handicap)return;
 const rule=HANDICAPS[g.handicap];if(!rule)return;
 const missing=templates.filter(e=>e.piece!=='king'&&e.slotKey!==g.heroSlotKey&&(rule.solo||rule.remove.includes(e.slotKey))&&!g.enemies.some(n=>n.team==='ally'&&n.slotKey===e.slotKey));
 if(!missing.length)return;
 const ids=new Set([g.playerId,...g.enemies.map(e=>e.id)]);const staged=[];
 for(const base of missing){let id=0;while(ids.has(id))id++;if(id>=MAX_NPCS||!g.formationSlots.some(s=>s.team==='enemy'&&s.slotKey===base.slotKey))throw new Error('Invalid handicap reserve identity');ids.add(id);staged.push({...base,id,alive:false,hp:0,maxHp:g.teamStats?.ally.hp||1,age:99,attack:'idle',attackTimer:0,attackCooldown:0,spawnProtection:0,invulnerable:0,reinforceTarget:null,pendingTeam:'enemy',respawnAt:g.time+RESPAWN_DELAY});}
 if(g.enemies.length+staged.length+(g.player?1:0)>MAX_NPCS)throw new Error('Handicap reserves exceed population');
 if(deployment==='promoted-start'){
  const placed=[g.player,...g.enemies.filter(e=>e.alive)];
  for(const e of staged){if(!terrainDry(g,e)||placed.some(p=>p&&Math.hypot(p.x-e.x,p.z-e.z)<1.5)){const error=new Error('Cannot deploy handicap pieces in former ally slots');error.code='HANDICAP_DEPLOYMENT_INVALID';throw error;}placed.push(e);}
  for(const e of staged){const base=e.piece,form=PIECES[base].promote;Object.assign(e,{team:'enemy',piece:form||base,effectivePiece:form||base,basePiece:base,promoted:!!form,transformUntil:0,alive:true,hp:npcHomeHp(g,'enemy',e.slotKey),maxHp:npcHomeHp(g,'enemy',e.slotKey),equipment:npcHomeEquipment(g,'enemy',e.slotKey),age:0,pendingTeam:null,respawnAt:null,attackCooldown:.8+(e.id%9)*.13,aimDx:0,aimDz:1});}
 }
 for(const e of staged)handicapTransferredActors.add(e);
 g.enemies.push(...staged);
 Object.defineProperties(g,{handicapReserveRuleset:{value:'handicap-enemy-reserve-v2',enumerable:true},initialEnemyReserveCount:{value:staged.length,enumerable:true},handicapEnemyDeployment:{value:deployment,enumerable:true}});
}
function create(seed=1,piece='rook',formationKey='initial',options={}){const transferHandicap=handicapReserveOption(options),handicapDeployment=handicapDeploymentOption(options);const automaticReturn=automaticAllyReturnOption(options);if(!automaticReturn&&(options.controlMode==='spectator'||options.trainingLesson!=null))throw new TypeError('Manual captured return requires a manual army');const mission=options.battleScenario==null||options.battleScenario==='free'?null:battleScenarioDefinition(options.battleScenario);if(options.battleScenario!=null&&options.battleScenario!=='free'&&!mission)throw new TypeError('Unknown battle scenario');if(mission){options=battleScenarioOptions(mission,options);piece=mission.pieces.includes(piece)?piece:mission.pieces[0];formationKey=mission.formation;}if(!automaticReturn&&(!options.formationHero||(options.scenario!==undefined&&options.scenario!=='army')||options.controlMode&&options.controlMode!=='manual'))throw new TypeError('Manual captured return requires a manual formationHero army');if(!FORMATIONS[formationKey])formationKey='initial';if(!PIECES[piece])piece='rook';const handicapKey=options.formationHero&&(!options.scenario||options.scenario==='army')&&Object.prototype.hasOwnProperty.call(HANDICAPS,options.handicap)?options.handicap:null;if(handicapKey&&!handicapAllows(handicapKey,piece))piece='king';let s=seed>>>0;const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};const back=['lance','knight','silver','gold','king','gold','silver','knight','lance'];let formation=[...back.map((piece,col)=>({piece,col,row:0})),{piece:'rook',col:1,row:1},{piece:'bishop',col:7,row:1},...Array.from({length:9},(_,col)=>({piece:'pawn',col,row:2}))];if(formationKey!=='initial'){const preset=FORMATIONS[formationKey],queues={};for(const key of Object.keys(PIECES))queues[key]=[...(key==='pawn'?FORMATION_PAWNS:key==='knight'?['2i','8i']:preset[key]||[])];formation=formation.map(({piece})=>{const square=queues[piece].shift();return{piece,col:Number(square[0])-1,row:8-(square.charCodeAt(1)-97)};});}const enemies=formation.map(({piece:enemyPiece,col,row},id)=>({id,slotKey:id,team:'enemy',piece:enemyPiece,file:9-col,rank:row+1,x:(col-4)*FILE_SPACING,z:7+(row-2)*RANK_SPACING,homeX:(col-4)*FILE_SPACING,homeZ:7+(row-2)*RANK_SPACING,y:0,alive:true,age:0,phase:random()*6.28,vx:0,vz:0,vy:0,angle:0,spin:0,attack:'idle',attackTimer:0,attackCooldown:.8+(id%9)*.13,aimDx:0,aimDz:1}));const scenario=['duel','squad','thrust_trial','slash_trial','charge_trial','jump_trial','guard_trial','awaken_trial','switch_trial'].includes(options.scenario)?options.scenario:'army';if(scenario!=='army'){const count=scenario==='duel'?1:5;enemies.splice(0,enemies.length,...Array.from({length:count},(_,id)=>({...enemies[11+id],id,piece:'pawn',x:(id-Math.floor(count/2))*3.4,z:9,homeX:(id-Math.floor(count/2))*3.4,homeZ:9,attackCooldown:1.1})));}const layouts={switch_trial:[[2,11,'gold'],[2,8,'pawn']],duel:[[0,5]],thrust_trial:[[0,11,'pawn'],[0,8,'silver'],[0,5,'gold']],slash_trial:[[-1.4,11.7,'silver'],[0,11.7,'pawn'],[1.4,11.7,'gold']],charge_trial:[[0,6],[5,6]],jump_trial:[[3,8]],guard_trial:[[0,11]],awaken_trial:[[3,2]]};if(layouts[scenario]){const base=enemies[0];enemies.splice(0,enemies.length,...layouts[scenario].map(([x,z,piece=base.piece],id)=>({...base,id,slotKey:id,piece,x,z,homeX:x,homeZ:z,attackCooldown:2})));if(scenario==='thrust_trial')for(const e of enemies)e.trainingTarget=true;if(['charge_trial','jump_trial'].includes(scenario))for(const x of scenario==='charge_trial'?[0]:[-3,0,3])enemies.push({...base,id:enemies.length,slotKey:enemies.length,team:'ally',trainingGuard:true,spawnProtection:999,x,z:11,homeX:x,homeZ:11,attackCooldown:999});}
const formationHero=!!options.formationHero&&scenario==='army',basePiece=Object.keys(PIECES).find(k=>PIECES[k].promote===piece)||piece;let heroSlot=null;const allyCount=scenario!=='army'?0:handicapKey?(HANDICAPS[handicapKey].solo?0:19-HANDICAPS[handicapKey].remove.length):clamp(Math.floor(Number(options.allyCount)||0),formationHero&&basePiece!=='king'?1:0,formationHero?19:20),allyFormation=FORMATIONS[options.allyFormation]?options.allyFormation:'initial';let allyTemplates=[];if(!options.templateOnly){const template=create(seed,'rook',allyFormation,{templateOnly:true});allyTemplates=template.enemies.map(e=>({...e,x:-e.x,z:30-e.z,homeX:-e.homeX,homeZ:30-e.homeZ,team:'ally'}));const eligible=handicapKey?allyTemplates.filter(e=>!HANDICAPS[handicapKey].remove.includes(e.slotKey)):allyTemplates;if(formationHero)heroSlot=eligible.filter(e=>e.piece===basePiece).sort((a,b)=>Math.abs(a.x)-Math.abs(b.x)||a.slotKey-b.slotKey)[0];const remaining=eligible.filter(e=>!heroSlot||e.slotKey!==heroSlot.slotKey);const order=formationHero?[...remaining.filter(e=>e.piece==='king'),...remaining.filter(e=>e.piece==='pawn'),...remaining.filter(e=>e.piece!=='pawn'&&e.piece!=='king')]:[...remaining.filter(e=>e.piece==='pawn'),...remaining.filter(e=>e.piece!=='pawn'&&e.piece!=='king'),...remaining.filter(e=>e.piece==='king')];for(const base of order.slice(0,allyCount))enemies.push({...base,id:enemies.length,phase:random()*6.28});}
const spectator=formationHero&&options.controlMode==='spectator';
// Restore exactly the selected formation slot, with NPC identity, equipment,
// lifecycle and attack timers. No hero body or hero stat advantage remains.
if(spectator){
 if(!heroSlot)throw new Error('Spectator requires a formation slot');
 enemies.push({...heroSlot,piece});
 // A former manual-role choice must not reorder or retime an equivalent NPC
 // army. Canonical slot identity also survives later capture and rejoining.
 const allies=enemies.filter(e=>e.team==='ally').sort((a,b)=>a.slotKey-b.slotKey),phases=[];let phaseSeed=seed>>>0;
 for(let i=0;i<40;i++){phaseSeed=(Math.imul(phaseSeed,1664525)+1013904223)>>>0;if(i>=20)phases.push(phaseSeed/4294967296*6.28);}
 for(const e of allies){e.id=20+e.slotKey;e.phase=phases[e.slotKey];e.aimDx=0;e.aimDz=-1;}
 enemies.splice(0,enemies.length,...enemies.filter(e=>e.team==='enemy'),...allies);
}
const difficulty=DIFFICULTIES[options.difficulty]?options.difficulty:'normal',balance=DIFFICULTIES[difficulty];const strategies=scenario==='army'&&options.strategies?normalizeStrategies(options.strategies):null;const teamStats=scenario==='army'&&options.teamStats?normalizeTeamStats(options.teamStats):null;for(const e of enemies){e.maxHp=e.hp=teamStats?.[e.team||'enemy'].hp||1;e.equipment=teamStats?.[e.team||'enemy'].equipment||'light';e.hurtFlash=0;e.invulnerable=0;e.heroCooldowns=null;e.npcCooldownUsed=false;}const heroHp=scenario==='army'?(Number.isInteger(options.heroHp)&&options.heroHp>=1&&options.heroHp<=5?options.heroHp:(teamStats?.ally.hp||balance.hp)):['guard_trial','awaken_trial'].includes(scenario)?3:1;
const game={playerId:formationHero?39:40,guarding:false,guardFlash:0,strategies,guardCache:{},teamStats,handicap:handicapKey,formationHero,heroSlotKey:heroSlot?.slotKey??null,difficulty,seed,piece,scenario,formationKey,allyCount,allyFormation,enemies,reinforcements:0,npcCaptures:0,formationSlots:[...enemies.filter(e=>e.team==='enemy').map(e=>({id:e.id,slotKey:e.slotKey,x:e.x,z:e.z,team:'enemy'})),...allyTemplates.map((e,i)=>({id:20+i,slotKey:e.slotKey,x:e.x,z:e.z,team:'ally'}))],vacancies:[],reformTimer:0,waves:[],promotionPulse:null,chainContacts:0,nextWaveId:1,hp:heroHp,maxHp:heroHp,invulnerable:0,damageFlash:0,lost:false,lossTime:0,playerHits:0,player:{id:formationHero?39:40,slotKey:heroSlot?.slotKey??null,homeX:heroSlot?.x??0,homeZ:heroSlot?.z??14,team:'ally',alive:true,spawnProtection:0,equipment:teamStats?.ally.equipment||'light',x:heroSlot?.x??0,y:0,z:heroSlot?.z??14,dx:piece==='bishop'?-Math.SQRT1_2:0,dz:piece==='bishop'?-Math.SQRT1_2:-1},time:0,active:false,mode:'ready',phase:0,cooldown:0,sweepCooldown:0,stepCooldown:0,score:0,combo:0,best:0,charges:0,sweeps:0,steps:0,thrusts:0,jumps:0,jumpCooldown:0,turns:0,hitstop:0,firstHit:false,lastHit:-10,promoted:false,events:[],won:false,winTime:0};if(spectator){Object.defineProperty(game,'controlMode',{value:'spectator',enumerable:true});game.player=null;game.playerId=null;game.hp=game.maxHp=0;game.allyCount++;game.draw=false;game.drawTime=0;}
if(scenario==='army'&&options.trainingLesson!=='recruit')Object.defineProperty(game,'lanceActionRuleset',{value:LANCE_ACTION_RULESET,enumerable:true,writable:false,configurable:false});
if((scenario==='army'&&options.trainingLesson!=='recruit')||(scenario==='awaken_trial'&&piece==='pawn'))Object.defineProperty(game,'automaticAwakeningRuleset',{value:AUTOMATIC_AWAKENING_RULESET,enumerable:true,writable:false,configurable:false});
if(scenario==='army'&&formationHero&&options.kingPersonalities){game.kingPersonalities=KingPersonality.normalizePersonalities(options.kingPersonalities);game.kingPlan=KingPersonality.initialPlan(game);}if(scenario==='army'&&formationHero&&options.invasionScoring===true){game.invasionScoring=true;game.invasion=Invasion.createInvasion(game);}if(teamStats&&options.trainingLesson!=='recruit')Object.defineProperty(game,'equipmentCadenceRuleset',{value:EQUIPMENT_CADENCE_RULESET,enumerable:true,writable:false,configurable:false});if(options.terrain==='three_bridges')game.terrain='three_bridges';if(scenario==='army'&&options.teamTactics)game.teamTactics=normalizeTeamTactics(options.teamTactics);if(scenario==='army'&&options.npcSensing===true)game.npcSensing=true;if(!spectator&&options.capabilities!==undefined){if(!CAP)throw new Error('Capability runtime not loaded');CAP.install(game,options.capabilities,{PIECES,ACTIONS});}if(options.arena!==undefined)installArena(game,options.arena);else if(formationHero&&options.deferArmyArena!==true){installArena(game,STANDARD_ARMY_ARENA);Object.defineProperty(game,'armyArenaRuleset',{value:ARMY_ARENA_RULESET,enumerable:true,writable:false,configurable:false});}if(mission)installBattleScenario(game,mission);if(!automaticReturn)installCapturedReturn(game);if(transferHandicap&&options.trainingLesson==null)installHandicapEnemyReserves(game,allyTemplates,handicapDeployment);
if(scenario==='switch_trial'){const ally=game.enemies[0];Object.assign(ally,{team:'ally',piece:'gold',x:2,z:11,homeX:2,homeZ:11,slotKey:0,attack:'idle',attackCooldown:0,aimDx:0,aimDz:-1});const target=game.enemies[1];target.trainingTarget=true;game.enemies=[ally,target];game.switchLesson={initialActorId:39,allyActorId:ally.id,targetId:target.id,switched:false};game.formationHero=true;game.playerId=game.player.id=39;game.allyCount=1;game.heroSlotKey=4;game.player.slotKey=4;game.formationSlots=[];}
if(scenario==='army'&&options.devEscortBrace===true)Object.defineProperty(game,'devEscortBrace',{value:true,enumerable:true});return game;}
function cardinal(x,z,p={dx:0,dz:-1}){x=Number.isFinite(x)?x:0;z=Number.isFinite(z)?z:0;if(Math.max(Math.abs(x),Math.abs(z))<.06)return {x:0,z:0};if(Math.abs(x)===Math.abs(z)&&p.dz&&Math.sign(z)===p.dz)return {x:0,z:Math.sign(z)};return Math.abs(x)>=Math.abs(z)?{x:Math.sign(x),z:0}:{x:0,z:Math.sign(z)};}
function cancel(g){if(!g.player)return false;if(g.thrustAction)delete g.thrustAction;g.waves=g.waves.filter(w=>!(w.held&&w.sourceId===g.playerId));if(['charge','windup','sweep','dragon','thrust','jump'].includes(g.mode)){g.mode='ready';g.phase=0;g.player.y=0;g.hitstop=0;g.events.push({type:'cancel'});return true;}return false;}
function aim(g,x,z){if(!g.player)return false;const d=direction(g,x,z);if(!d.x&&!d.z)return;const changed=d.x!==g.player.dx||d.z!==g.player.dz;if(changed&&['charge','windup'].includes(g.mode)){cancel(g);g.cooldown=Math.max(g.cooldown,.12);g.turns++;}if(g.mode!=='dragon'&&g.mode!=='jump'){g.player.dx=d.x;g.player.dz=d.z;}}
function charge(g){if(!canAction(g,'charge'))return false;g.chargeContact=false;if(!allowed(g,g.player.dx,g.player.dz))return false;if(battleEnded(g)||g.cooldown>0||g.mode==='jump'||g.mode==='thrust'||g.mode==='dragon'||g.mode==='charge'||g.mode==='windup')return false;g.active=true;g.mode='windup';g.phase=.075;g.charges++;g.firstHit=false;g.events.push({type:'charge'});return true;}
function sweep(g){if(!canAction(g,'sweep'))return false;if(!allowed(g,g.player.dx,g.player.dz))return false;if(pieceKey(g)==='knight')return false;if(battleEnded(g)||g.sweepCooldown>0||g.mode==='jump'||g.mode==='dragon')return false;cancel(g);g.active=true;g.mode='sweep';g.phase=SWEEP_DURATION;g.sweepCooldown=SWEEP_DURATION;g.sweepDirection={dx:g.player.dx,dz:g.player.dz};g.sweeps++;g.firstHit=false;g.waveLaunched=false;g.events.push({type:'sweep'});return true;}
function thrust(g,options){
 const stage=options?.profile==='three-hit-thrust-v1'&&[2,3].includes(options.stage)?options.stage:0;
 if(options!==undefined&&!stage)return false;
 if(!canAction(g,'thrust'))return false;if(!allowed(g,g.player.dx,g.player.dz))return false;if(pieceKey(g)==='knight')return false;if(battleEnded(g)||g.sweepCooldown>0||g.mode==='jump'||g.mode==='dragon')return false;
 cancel(g);g.active=true;g.mode='thrust';g.phase=stage?THRUST_FOLLOWUP_TIMINGS[stage].duration:.4;g.sweepCooldown=g.phase;g.sweepDirection={dx:g.player.dx,dz:g.player.dz};g.thrusts++;g.firstHit=false;g.waveLaunched=false;
 if(stage)g.thrustAction=Object.freeze({profile:'three-hit-thrust-v1',stage,actorId:g.playerId,actionCount:g.thrusts});
 g.events.push({type:'thrust'});return true;
}
function jump(g,x=0,z=0){if(!canAction(g,'jump'))return false;if(CAP?.forwardHop(g))return startJump(g,{x:0,z:-1},false);return knightJump(g,x<0?-1:x>0?1:g.knightSide||1);}
// Pure landing/ability query. Timers, guard and terminal readiness remain
// the caller's existing gates. UI and actual admission share this proposal.
function jumpProposal(g,d,knight){const raw={x:g.player.x+(knight?d.x*STEP_DISTANCE:d.x*JUMP_DISTANCE),z:g.player.z+(knight?-2*STEP_DISTANCE:d.z*JUMP_DISTANCE)},point=g.arena?raw:{x:clamp(raw.x,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(raw.z,arenaBounds(g).minZ,arenaBounds(g).maxZ)},allowed=terrainJump(g,g.player,point,'ally',knight);return {allowed,reason:allowed?null:g.arena&&!arenaContains(g,raw)?'outside-arena':'terrain',point};}
function jumpLanding(g,x=0,z=0){if(!heroHasAbility(g,'jump'))return {allowed:false,reason:'ability',point:null};if(CAP?.forwardHop(g))return jumpProposal(g,{x:0,z:-1},false);if(pieceKey(g)!=='knight')return {allowed:false,reason:'ability',point:null};return jumpProposal(g,{x:x<0?-1:x>0?1:g.knightSide||1,z:-2},true);}
function startJump(g,d,knight=false){if(g.guarding||battleEnded(g)||g.jumpCooldown>0||g.mode!=='ready')return false;if(!jumpProposal(g,d,knight).allowed)return false;g.active=true;g.mode='jump';g.phase=JUMP_DURATION;g.jumpCooldown=1.1;g.jumpLanded=false;g.jumpIsKnight=knight;g.jumpStart={x:g.player.x,z:g.player.z};const dx=knight?d.x*STEP_DISTANCE:d.x*JUMP_DISTANCE,dz=knight?-2*STEP_DISTANCE:d.z*JUMP_DISTANCE;g.jumpEnd={x:clamp(g.player.x+dx,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(g.player.z+dz,arenaBounds(g).minZ,arenaBounds(g).maxZ)};const n=Math.hypot(dx,dz);if(n){g.player.dx=dx/n;g.player.dz=dz/n;}g.jumps++;g.events.push({type:'jump'});return true;}
function knightJump(g,side){if(pieceKey(g)!=='knight'||!heroHasAbility(g,'jump'))return false;g.knightSide=side<0?-1:1;return startJump(g,{x:g.knightSide,z:-2},true);}
function dragonStep(g,x,z){if(!heroHasAbility(g,'step_attack')||g.guarding||g.mode==='jump'||battleEnded(g)||g.stepCooldown>0||!Number.isFinite(x)||!Number.isFinite(z)||!isStepDirection(g,x,z)||!allowed(g,x,z))return false;cancel(g);g.active=true;g.mode='dragon';g.phase=.18;g.stepCooldown=.38;g.steps++;g.firstHit=false;const n=Math.hypot(x,z);g.player.dx=x/n;g.player.dz=z/n;g.stepStart={x:g.player.x,z:g.player.z};g.stepEnd=g.arena?arenaClip(g,g.player,{x:g.player.x+g.player.dx*STEP_DISTANCE,z:g.player.z+g.player.dz*STEP_DISTANCE}).point:{x:clamp(g.player.x+g.player.dx*STEP_DISTANCE,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(g.player.z+g.player.dz*STEP_DISTANCE,arenaBounds(g).minZ,arenaBounds(g).maxZ)};g.events.push({type:'dragon'});spawnWave(g,'player','slash',g.player.x,1.9,g.player.z,g.player.dx,g.player.dz,{horseStepWave:pieceKey(g)==='horse'});return true;}
function distanceSegment(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?clamp(((px-ax)*dx+(pz-az)*dz)/l,0,1):0;return Math.hypot(px-ax-t*dx,pz-az-t*dz);}
// Horizontal bow unfolds from the character's anatomical right (-local X).
const SLASH_PROFILES=Array.from({length:9},(_,stage)=>{const span=.18+.82*Math.max(1,stage)/8,points=[];for(let i=0;i<=40;i++){const a=Math.PI*.95-i/40*Math.PI*.90*span;points.push([Math.cos(a),Math.sin(a)]);}for(let i=39;i>0;i--){const t=i/40,a=Math.PI*.95-t*Math.PI*.90*span,r=1-.32*Math.pow(Math.sin(Math.PI*t),.65);points.push([r*Math.cos(a),r*Math.sin(a)]);}return points;});
const MAX_WAVES=32,HERO_HEIGHT=3.8,HERO_RADIUS=.60,ENEMY_HEIGHT=HERO_HEIGHT,ENEMY_RADIUS=HERO_RADIUS;
// The crescent first unfolds at its authored hand origin, then travels faster
// over the remaining lifetime. This preserves its 2.84-unit maximum travel,
// radius/profile and lifetime; rendering and every contact solver use this
// same piecewise curve. Ordinary waves deliberately share that timing across factions.
// Personal horse-step waves instead spend the same travel budget during the
// 0.18s native step after the first two authored profile stages; this retains
// close opening contact without letting the owner overtake the opening wave.
function waveTravelEnd(w){return w.horseStepWave?.18:w.life-.035;}
function waveTravelDistance(w,fromAge,toAge){
 const delay=w.horseStepWave?2*.075/8:w.kind==='slash'?SLASH_OPEN_DELAY:0,end=waveTravelEnd(w);
 return w.speed*Math.max(0,Math.max(0,Math.min(toAge,end)-delay)-Math.max(0,Math.min(fromAge,end)-delay));
}
function spawnWave(g,team,kind,x,y,z,dx,dz,options={}){
 if(isSpectator(g)&&options.ownerId==null)return null;
 if(g.capabilityLoadout){const ability={slash:'sweep',thrust:'thrust',charge:'charge',burst:'jump'}[kind],hero=options.ownerId===g.playerId||(options.ownerId==null&&team==='player'),actor=hero?g.player:g.enemies.find(e=>e.id===options.ownerId);if(!ability||(options.ownerId!=null&&!actor)||(actor&&(team!==(hero||actor.team==='ally'?'player':'enemy')||!actorHasAbility(g,actor,ability,hero?'hero':'npc'))))return null;}

 if((options.ownerId!=null&&g.waves.length>=MAX_WAVES-4)||g.waves.length>=MAX_WAVES||![x,y,z,dx,dz].every(Number.isFinite))return null;let n=Math.hypot(dx,dz);if(n<.000001){dx=0;dz=1;n=1;}dx/=n;dz/=n;
 const enemy=team==='enemy',npc=options.ownerId!=null,factor=enemy?ENEMY_HEIGHT/HERO_HEIGHT:1;
 const def=kind==='slash'?{rx:.5,ry:.22,rz:.5,speed:SLASH_SPEED,life:SLASH_LIFE}:kind==='charge'?{rx:1.4,ry:1.9,rz:1.15,speed:0,life:.6}:kind==='burst'?{rx:.6,ry:.65,rz:.6,speed:0,life:.3}:{rx:THRUST.radius,ry:THRUST.radius,rz:THRUST.radius,speed:0,life:npc?.35:.24};
 const rightOffset=!enemy&&!npc?(kind==='slash'?.45:kind==='thrust'?.35:0):0;
 const w={id:g.nextWaveId++,team,kind,sourceId:options.ownerId??(team==='player'?g.playerId:null),personal:team==='player'&&options.ownerId==null,sourceX:x,sourceZ:z,orientation:kind==='slash'?'horizontal':'vertical',x:x+dx*.55-dz*rightOffset,y,z:z+dz*.55+dx*rightOffset,dx,dz,rx:def.rx*factor,ry:def.ry*factor,rz:def.rz*factor,speed:def.speed,life:def.life,age:0,angleStart:-Math.PI*.78,angleLength:Math.PI*1.56,innerRatio:.70,profileStage:kind==='slash'?1:0,profile:kind==='slash'?SLASH_PROFILES[1]:null,follow:!!options.follow,ownerId:options.ownerId,hitIds:[],hitPlayer:false};
 if(kind==='slash'&&options.horseStepWave&&!enemy&&!npc&&pieceKey(g)==='horse'&&g.mode==='dragon'){w.horseStepWave=true;w.speed=SLASH_TRAVEL/(.18-2*.075/8);}if(kind==='burst'){w.x=x;w.z=z;}if(kind==='thrust'){const pose=thrustPoint({x,y:y-THRUST.height,z},dx,dz,THRUST.release);Object.assign(w,{held:true,bound:options.bound??(options.ownerId!=null||team==='player'&&g.mode==='thrust'),sourceY:y-THRUST.height,x:pose.x,y:pose.y,z:pose.z,rx:THRUST.radius,ry:THRUST.radius,rz:THRUST.radius,speed:0,life:npc?.35:.24,age:options.releaseDelay?-options.releaseDelay:0,swingScale:npc?.24/.35:1,follow:false});}g.waves.push(w);if(team==='player'&&options.ownerId==null)g.events.push({type:'attack_release',kind:kind==='slash'?'sweep':kind,x,y,z,waveId:w.id,sourceId:w.sourceId,personal:w.personal,action:kind,time:g.time});return w;
}
// Held thrust: the renderer and collider share this exact local tip path.
const THRUST=Object.freeze({duration:.4,release:.16,extendEnd:.24,activeEnd:.27,start:1.1,reach:3.2,right:0,height:1.9,radius:.14,length:3.6});
// Explicit optional controlled-thrust timing. The held contact solver below
// remains on its original release-relative .16..27 clock and unchanged path.
const THRUST_FOLLOWUP_TIMINGS=Object.freeze({
  2:Object.freeze({duration:.50,release:.22,extendEnd:.30,activeEnd:.33}),
  3:Object.freeze({duration:.60,release:.26,extendEnd:.34,activeEnd:.37})
});
function thrustTiming(g){
 const a=g?.thrustAction;
 if(g?.mode!=='thrust'||!a||a.profile!=='three-hit-thrust-v1'||![2,3].includes(a.stage)||a.actorId!==g.playerId||a.actionCount!==g.thrusts||!Number.isFinite(g.phase))return null;
 const spec=THRUST_FOLLOWUP_TIMINGS[a.stage],elapsed=clamp(spec.duration-g.phase,0,spec.duration);
 const canonicalElapsed=elapsed<=spec.release?THRUST.release*elapsed/spec.release:elapsed<=spec.activeEnd?THRUST.release+elapsed-spec.release:THRUST.activeEnd+(THRUST.duration-THRUST.activeEnd)*(elapsed-spec.activeEnd)/(spec.duration-spec.activeEnd);
 return Object.freeze({...a,...spec,elapsed,canonicalElapsed,canonicalPhase:THRUST.duration-canonicalElapsed});
}
function thrustExtension(t){if(t<=THRUST.release)return THRUST.start;if(t<THRUST.extendEnd)return THRUST.start+(THRUST.reach-THRUST.start)*(t-THRUST.release)/(THRUST.extendEnd-THRUST.release);if(t<=THRUST.activeEnd)return THRUST.reach;return THRUST.reach+(THRUST.start-THRUST.reach)*clamp((t-THRUST.activeEnd)/(THRUST.duration-THRUST.activeEnd),0,1);}
function thrustPoint(actor,dx,dz,elapsed){const n=Math.hypot(dx,dz)||1;dx/=n;dz/=n;const reach=thrustExtension(elapsed);return {x:actor.x+dx*reach-dz*THRUST.right,y:(actor.y||0)+THRUST.height,z:actor.z+dz*reach+dx*THRUST.right,dx,dz};}
function thrustPoses(g){
 if(battleEnded(g))return [];const poses=[];
 if(g.mode==='thrust'&&g.sweepDirection){const timing=thrustTiming(g),elapsed=timing?timing.canonicalElapsed:THRUST.duration-g.phase;poses.push({id:g.playerId,team:'ally',hero:true,elapsed,...(timing?{thrustTiming:timing}:{}),...thrustPoint(g.player,g.sweepDirection.dx,g.sweepDirection.dz,elapsed),actorX:g.player.x,actorY:g.player.y||0,actorZ:g.player.z});}
 for(const e of g.enemies){if(!e.alive||e.actionKind!=='thrust'||!['windup','recover'].includes(e.attack))continue;const elapsed=e.attack==='windup'?THRUST.release*(1-clamp(e.attackTimer/(e.windupDuration||.75),0,1)):THRUST.release+.24*(1-clamp(e.attackTimer/.35,0,1));poses.push({id:e.id,team:e.team,hero:false,elapsed,...thrustPoint(e,e.aimDx,e.aimDz,elapsed),actorX:e.x,actorY:e.y||0,actorZ:e.z});}
 return poses;
}
function thrustFrame(g){return new Map([...(g.player?[g.player]:[]),...g.enemies.filter(e=>e.alive)].map(e=>[e,{x:e.x,y:e.y||0,z:e.z,team:e.team,attack:e.attack,alive:e===g.player?g.hp>0:e.alive}]));}
function heldThrustContact(w,dt,ownerMotion,targetMotion){
 const scale=w.swingScale||1,first=Math.max(0,-w.age),last=Math.min(dt,(THRUST.activeEnd-THRUST.release)/scale-w.age-1e-10);
 if(last<first)return null;
 const at=(motion,t)=>{const p=bodyMotionAt(motion,t);p.y=motion.start.y+(motion.end.y-motion.start.y)*clamp(t/(motion.frameDt||dt||1),0,1);return p;};
 const pointAt=t=>thrustPoint(at(ownerMotion,t),w.dx,w.dz,THRUST.release+(w.age+t)*scale);
 const relativeAt=t=>{const p=pointAt(t),b=at(targetMotion,t);return {x:p.x-b.x,y:p.y-b.y,z:p.z-b.z};};
 const times=[first,last];for(const t of [(THRUST.extendEnd-THRUST.release)/scale-w.age,ownerMotion.moveDt+(ownerMotion.delay||0),targetMotion.moveDt+(targetMotion.delay||0),ownerMotion.delay||0,targetMotion.delay||0,...bodyMotionTimes(ownerMotion),...bodyMotionTimes(targetMotion)])if(t>first&&t<last)times.push(t);
 times.sort((a,b)=>a-b);const r=ENEMY_RADIUS+THRUST.radius,low=ENEMY_RADIUS,high=ENEMY_HEIGHT-ENEMY_RADIUS;
 const solve=(a,b,t0,t1)=>{const duration=t1-t0,cut=[0,1],dy=b.y-a.y;for(const height of [low,high])if(dy){const u=(height-a.y)/dy;if(u>0&&u<1)cut.push(u);}cut.sort((x,y)=>x-y);
  for(let k=1;k<cut.length;k++){const u0=cut[k-1],u1=cut[k],mid=(u0+u1)/2,band=a.y+dy*mid<low?low:a.y+dy*mid>high?high:null;
   const v0={x:a.x+(b.x-a.x)*u0,y:band===null?0:a.y+dy*u0-band,z:a.z+(b.z-a.z)*u0},dv={x:(b.x-a.x)*(u1-u0),y:band===null?0:dy*(u1-u0),z:(b.z-a.z)*(u1-u0)};
   const c=v0.x*v0.x+v0.y*v0.y+v0.z*v0.z-r*r,A=dv.x*dv.x+dv.y*dv.y+dv.z*dv.z,B=2*(v0.x*dv.x+v0.y*dv.y+v0.z*dv.z);let u=null;if(c<=1e-12)u=0;else if(A>1e-20){const D=B*B-4*A*c;if(D>=0){const q=(-B-Math.sqrt(D))/(2*A);if(q>=-1e-10&&q<=1+1e-10)u=clamp(q,0,1);}}
   if(u!==null){const t=t0+duration*(u0+(u1-u0)*u);return {t,point:pointAt(t),body:at(targetMotion,t)};}
  }return null;};
 if(first===last){const v=relativeAt(first),dy=v.y-clamp(v.y,low,high);if(v.x*v.x+v.z*v.z+dy*dy<=r*r)return {t:first,point:pointAt(first),body:at(targetMotion,first)};return null;}
 for(let i=1;i<times.length;i++){const contact=solve(relativeAt(times[i-1]),relativeAt(times[i]),times[i-1],times[i]);if(contact)return contact;}return null;
}
function updateHeldThrusts(g,dt,frame,heroMotion){
 const stationary=p=>({start:{...p},end:{...p},moveDt:0,delay:0,frameDt:dt});
 const motions=new Map();const motion=e=>{if(motions.has(e))return motions.get(e);const old=frame.get(e),now={x:e.x,y:e.y||0,z:e.z};let m;
  if(!old||old.team!==e.team)m=stationary(now);else if(e===g.player&&heroMotion)m={...heroMotion,frameDt:dt};else {const distance=Math.hypot(now.x-old.x,now.z-old.z),speed=old.attack==='charge'?CHARGE_SPEED:movementSpeed(g,e.team||'enemy',true);m=terrainOn(g)&&!old.y&&!now.y&&distance<=speed*dt+1e-7?Terrain.motion(old,now,speed):{start:old,end:now,moveDt:distance?dt:0,delay:0};m.frameDt=dt;}motions.set(e,m);return m;};
 const pending=[],consumed=new Set(),owners=new Map(),ownerAlive=owner=>owner===g.player?g.hp>0:!!owner?.alive;
 // Gather every candidate before applying damage. A killed front target may
 // expose the next live body, while an earlier owner death cancels its later hit.
 for(const w of g.waves){if(!w.held)continue;if(battleEnded(g)){w.age=w.life;continue;}
  const owner=w.bound?(w.sourceId===g.playerId?g.player:g.enemies.find(e=>e.id===w.sourceId)):null,valid=owner===g.player?g.mode==='thrust':owner?.alive&&!(owner.stagger>0)&&owner.actionKind==='thrust'&&owner.attack==='recover';
  if(w.bound&&!valid){w.age=w.life;continue;}if(w.bound)owners.set(w,owner);const ownerMotion=owner?motion(owner):stationary({x:w.sourceX,y:w.sourceY||0,z:w.sourceZ});
  const opposing=w.team==='player'?'enemy':'ally',targets=g.enemies.filter(e=>e.alive&&e.id!==w.sourceId&&(e.team||'enemy')===opposing);
  if(w.team==='enemy'&&g.playerId!==w.sourceId&&g.hp>0)targets.push(g.player);
  for(const e of targets){const previous=frame.get(e),appeared=!previous?.alive||previous.team!==e.team;let c;if(appeared){const a=ownerMotion.end,b={x:e.x,y:e.y||0,z:e.z};c=heldThrustContact({...w,age:w.age+dt},0,stationary(a),stationary(b));if(c)c.t=dt;}else c=heldThrustContact(w,dt,ownerMotion,motion(e));if(c)pending.push({w,owner,e,...c});}
  w.age+=dt;const pose=thrustPoint(owner||{x:w.sourceX,y:w.sourceY||0,z:w.sourceZ},w.dx,w.dz,THRUST.release+w.age*(w.swingScale||1));Object.assign(w,{x:pose.x,y:pose.y,z:pose.z});
 }
 pending.sort((a,b)=>a.t-b.t||(a.w.sourceId??-1)-(b.w.sourceId??-1)||(a.e.id??g.playerId)-(b.e.id??g.playerId)||a.w.id-b.w.id);
 // Only numerical time ties are simultaneous; a genuinely earlier contact
 // retains priority regardless of NPC-array or wave insertion order.
 const timeEpsilon=1e-8;
 for(let index=0;index<pending.length&&!battleEnded(g);){const time=pending[index].t,batch=[],reserved=new Set(),terminal=[];let end=index+1;while(end<pending.length&&pending[end].t<=time+timeEpsilon)end++;
  for(let i=index;i<end;i++){const c=pending[i],{w,owner,e}=c;if(consumed.has(w)||reserved.has(w))continue;if(w.bound&&!ownerAlive(owner)){consumed.add(w);w.age=w.life;continue;}if(!ownerAlive(e))continue;reserved.add(w);batch.push(c);}
  // Owners valid at this contact instant keep their already-reaching strikes,
  // even if another member of the same batch kills them. Terminal decisions wait.
  for(const c of batch){const {w,e}=c,isPlayer=e===g.player,blocked=e.spawnProtection>0||(isPlayer?g.invulnerable>0||g.guarding:e.invulnerable>0);consumed.add(w);w.age=w.life;w.hitIds.push(e.id??g.playerId);w.contact=c.point;
   g.events.push({type:'thrust_contact',targetId:e.id??g.playerId,x:c.point.x,y:c.point.y,z:c.point.z,blocked,personal:w.personal,team:e.team,waveId:w.id,sourceId:w.sourceId,action:'thrust'});
   if(e.spawnProtection>0)continue;if(isPlayer){w.hitPlayer=true;if(g.guarding){g.guardFlash=.18;g.events.push({type:'guard_block',x:e.x,y:e.y,z:e.z,action:'thrust'});}else if(g.invulnerable<=0&&g.hp>0){g.hp=Math.max(0,g.hp-1);g.invulnerable=.72;g.damageFlash=.22;g.playerHits++;g.events.push({type:'player_hit',x:e.x,y:e.y,z:e.z,hp:g.hp,maxHp:g.maxHp,action:'thrust'});if(g.hp===0)terminal.push({win:false,reason:'hero'});}}else if(!(e.invulnerable>0))hit(g,e,w.dx,w.dz,'thrust',w.team,w.ownerId,w,c.body,terminal);
  }
  if(terminal.length){finishContactBatch(g,terminal);for(const w of g.waves)if(w.held)w.age=w.life;}
  index=end;
 }
 for(const [w,owner] of owners)if(!ownerAlive(owner))w.age=w.life;
 g.waves=g.waves.filter(w=>!w.held||w.age<w.life);
}
function pointSectorDistanceSquared(x,y,inner,outer,start,length){
 const radius=Math.hypot(x,y),angle=Math.atan2(y,x),delta=((angle-start)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
 let best=Infinity;
 if(delta<=length){const d=radius-clamp(radius,inner,outer);best=d*d;}
 for(const a of [start,start+length]){const cx=Math.cos(a),cy=Math.sin(a),r=clamp(x*cx+y*cy,inner,outer);best=Math.min(best,(x-r*cx)**2+(y-r*cy)**2);}
 return best;
}
function pointProfileDistanceSquared(x,y,profile,rx,ry){let inside=false,best=Infinity;for(let i=0,j=profile.length-1;i<profile.length;j=i++){const ax=profile[j][0]*rx,ay=profile[j][1]*ry,bx=profile[i][0]*rx,by=profile[i][1]*ry;if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1);best=Math.min(best,(x-ax-t*dx)**2+(y-ay-t*dy)**2);}return inside?0:best;}
function pointEllipsoidDistanceSquared(x,y,z,rx,ry,rz){
 const p=[Math.abs(x),Math.abs(y),Math.abs(z)],a=[rx,ry,rz];
 if(p.reduce((v,n,i)=>v+(n/a[i])**2,0)<=1)return 0;
 const f=t=>p.reduce((v,n,i)=>v+(a[i]*n/(t+a[i]*a[i]))**2,0);
 let lo=0,hi=Math.max(...p.map((n,i)=>a[i]*n),1);while(f(hi)>1)hi*=2;
 for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(f(mid)>1)lo=mid;else hi=mid;}
 return p.reduce((v,n,i)=>v+(n-a[i]*a[i]*n/(hi+a[i]*a[i]))**2,0);
}
function waveHitsBody(w,body){
 if(![w.x,w.y,w.z,w.dx,w.dz,w.rx,w.ry,w.rz,body.x,body.z,body.height,body.radius].every(Number.isFinite)||Math.abs(Math.hypot(w.dx,w.dz)-1)>.0001||w.rx<=0||w.ry<=0||w.rz<=0||body.radius<=0||body.height<=0)return false;
 const r=body.radius,base=body.y||0,h=body.height,dx=body.x-w.x,dz=body.z-w.z,u=dx*w.dz-dz*w.dx,vz=dx*w.dx+dz*w.dz;
 if(Math.abs(u)>w.rx+r||Math.abs(vz)>w.rz+r||base>w.y+w.ry+r||base+h<w.y-w.ry-r)return false;
 const low=base+Math.min(r,h/2),high=base+h-Math.min(r,h/2);
 if(w.kind==='slash'&&w.orientation==='horizontal'){const vertical=Math.max(0,Math.abs(clamp(w.y,low,high)-w.y)-w.ry);return pointProfileDistanceSquared(u,vz,w.profile,w.rx,w.rz)+vertical*vertical<=r*r;}
 if(w.kind!=='slash'){const y=clamp(w.y,low,high)-w.y;return pointEllipsoidDistanceSquared(u,y,vz,w.rx,w.ry,w.rz)<=r*r;}
 const depth=Math.max(0,Math.abs(vz)-w.rz);
 for(let i=0;i<=10;i++){const y=low+(high-low)*i/10-w.y;const d=w.profile?pointProfileDistanceSquared(u,y,w.profile,w.rx,w.ry):pointSectorDistanceSquared(u,y,w.rx*w.innerRatio,w.rx,w.angleStart,w.angleLength);if(d+depth*depth<=r*r)return true;}
 return false;
}
// Collision against the complete active travel segment, including launch and final range.
function sweptWaveHitsBody(w,body,fromX,fromZ){
 if(waveHitsBody(w,body))return true;const dx=w.x-fromX,dz=w.z-fromZ,length=dx*dx+dz*dz;if(length<1e-12)return false;
 const previous={...w,x:fromX,z:fromZ};if(waveHitsBody(previous,body))return true;
 if(w.kind!=='slash'){const t=clamp(((body.x-fromX)*dx+(body.z-fromZ)*dz)/length,0,1);return waveHitsBody({...w,x:fromX+dx*t,z:fromZ+dz*t},body);}
 if(w.orientation!=='horizontal')return false;
 const r=body.radius,base=body.y||0,h=body.height,low=base+Math.min(r,h/2),high=base+h-Math.min(r,h/2),vertical=Math.max(0,Math.abs(clamp(w.y,low,high)-w.y)-w.ry);if(vertical>r)return false;
 const ux=(body.x-fromX)*w.dz-(body.z-fromZ)*w.dx,vx=(body.x-fromX)*w.dx+(body.z-fromZ)*w.dz,uy=(body.x-w.x)*w.dz-(body.z-w.z)*w.dx,vy=(body.x-w.x)*w.dx+(body.z-w.z)*w.dz;
 let best=Math.min(pointProfileDistanceSquared(ux,vx,w.profile,w.rx,w.rz),pointProfileDistanceSquared(uy,vy,w.profile,w.rx,w.rz));
 const sx=uy-ux,sy=vy-vx,l=sx*sx+sy*sy;
 for(let i=0,j=w.profile.length-1;i<w.profile.length;j=i++){
  const ax=w.profile[j][0]*w.rx,ay=w.profile[j][1]*w.rz,bx=w.profile[i][0]*w.rx,by=w.profile[i][1]*w.rz,t=clamp(((ax-ux)*sx+(ay-vx)*sy)/(l||1),0,1);best=Math.min(best,(ax-ux-t*sx)**2+(ay-vx-t*sy)**2);
  const ex=bx-ax,ey=by-ay,den=sx*ey-sy*ex;if(Math.abs(den)>1e-12){const qx=ax-ux,qy=ay-vx,a=(qx*ey-qy*ex)/den,b=(qx*sy-qy*sx)/den;if(a>=0&&a<=1&&b>=0&&b<=1)best=0;}
 }
 return best+vertical*vertical<=r*r;
}
// Conservative union of the old shape and the current shape's full travel.
function waveCandidateBounds(previous,w,fromX,fromZ){
 const r=ENEMY_RADIUS,pn=previous.dx*previous.dx+previous.dz*previous.dz,wn=w.dx*w.dx+w.dz*w.dz;
 const px=(Math.abs(previous.dz)*(previous.rx+r)+Math.abs(previous.dx)*(previous.rz+r))/pn,pz=(Math.abs(previous.dx)*(previous.rx+r)+Math.abs(previous.dz)*(previous.rz+r))/pn;
 const wx=(Math.abs(w.dz)*(w.rx+r)+Math.abs(w.dx)*(w.rz+r))/wn,wz=(Math.abs(w.dx)*(w.rx+r)+Math.abs(w.dz)*(w.rz+r))/wn;
 const ex=Math.max(px,wx)+1e-7,ez=Math.max(pz,wz)+1e-7;
 return {minX:Math.min(fromX,w.x)-ex,maxX:Math.max(fromX,w.x)+ex,minZ:Math.min(fromZ,w.z)-ez,maxZ:Math.max(fromZ,w.z)+ez,minY:Math.min(previous.y-previous.ry,w.y-w.ry)-r-1e-7,maxY:Math.max(previous.y+previous.ry,w.y+w.ry)+r+1e-7};
}
function withinWaveCandidateBounds(e,b){const y=e.y||0;return !(e.x<b.minX||e.x>b.maxX||e.z<b.minZ||e.z>b.maxZ||y>b.maxY||y+ENEMY_HEIGHT<b.minY);}
function matureSlashHitsMotion(waveStart, motion, dt) {
  const {start: bodyStart, end: bodyEnd, moveDt, delay = 0} = motion;
  if (waveStart.kind !== 'slash' || waveStart.orientation !== 'horizontal'
      || Math.abs((bodyStart.y || 0) - (bodyEnd.y || 0)) > 1e-9
      || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(moveDt)
      || moveDt < 0 || moveDt + delay > dt + 1e-9) return null;
  const first = Math.max(0, .1 - waveStart.age);
  const expiry = waveStart.life - waveStart.age;
  // Lifetime is half-open. Do not award a contact first reached at expiry.
  const last = Math.min(dt, expiry - 1e-10);
  if (last < first) return false;
  const travelEnd = waveTravelEnd(waveStart);
  const points = [first, last];
  for (const t of [delay, delay + moveDt, travelEnd - waveStart.age, ...bodyMotionTimes(motion)])
    if (t > first && t < last) points.push(t);
  points.sort((a, b) => a - b);
  const position = t => {
    const b = moveDt > 0 ? clamp((t - delay) / moveDt, 0, 1) : 1;
    const travel = waveTravelDistance(waveStart,waveStart.age,waveStart.age+t), at=motion.timeline?bodyMotionAt(motion,t):null;
    return {
      x: waveStart.x + waveStart.dx * travel - (at?at.x:bodyStart.x + (bodyEnd.x - bodyStart.x) * b),
      z: waveStart.z + waveStart.dz * travel - (at?at.z:bodyStart.z + (bodyEnd.z - bodyStart.z) * b)
    };
  };
  const body = { ...bodyStart, x: 0, z: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = position(points[i - 1]), b = position(points[i]);
    const u0 = -a.x * waveStart.dz + a.z * waveStart.dx;
    const u1 = -b.x * waveStart.dz + b.z * waveStart.dx;
    const v0 = -a.x * waveStart.dx - a.z * waveStart.dz;
    const v1 = -b.x * waveStart.dx - b.z * waveStart.dz;
    const extent = 1.9 + body.radius;
    if (Math.min(u0, u1) > extent || Math.max(u0, u1) < -extent
        || Math.min(v0, v1) > extent || Math.max(v0, v1) < -extent) continue;
    const w = { ...waveStart, ...b, rx: 1.9, rz: 1.9, profileStage: 8, profile: SLASH_PROFILES[8] };
    if (sweptWaveHitsBody(w, body, a.x, a.z)) return true;
  }
  return false;
}

// A deliberately narrow prediction: ordinary grounded hero travel is already
// observed, while only isolated ongoing NPC charges are safe to predict before
// this engine's NPC phase. All other motion retains the prior collision path.
function matureSlashBodyMotion(g,e,dt,heroMotion,currentWave){
 if(e===g.player)return heroMotion;
 if(dt>.05+1e-9||!g.active||battleEnded(g)||!e.alive||e.trainingGuard||e.attack!=='charge'||e.attackTimer<=0||e.stopAfterContact||e.chargeContact||e.stagger>0||e.spawnProtection>0||e.reinforceTarget!=null||Math.abs(e.y||0)>1e-9||Math.abs(Math.hypot(e.aimDx,e.aimDz)-1)>1e-9||g.promotionPulse)return null;
 // Already-overlapping grounded actors may receive a later landing correction.
 if(g.player&&(g.player.y||0)<ENEMY_HEIGHT&&Math.hypot(e.x-g.player.x,e.z-g.player.z)<HERO_RADIUS+ENEMY_RADIUS+1e-8)return null;
 // Other live waves may change the charge or end the battle before movement.
 // Without time-of-impact ordering, do not predict through that uncertainty.
 if(g.waves.some(w=>w!==currentWave&&w.age<w.life&&!(w.follow&&w.ownerId===e.id)))return null;
 // A nearby actor could move into the charge lane first. The 6-unit exclusion
 // exceeds one 50ms legal NPC leap/charge plus both body radii and rush travel.
 // It is only a prediction eligibility margin, never a damage radius.
 for(const other of g.enemies){if(other===e)continue;
  if(other.stagger>0||!other.alive&&other.age<.65)return null;
  if(other.alive&&Math.hypot(other.x-e.x,other.z-e.z)<=6)return null;
  if(!other.alive&&other.pendingTeam&&g.time>=other.respawnAt){const slot=g.formationSlots.find(s=>s.team===other.pendingTeam&&s.slotKey===other.slotKey);if(slot&&Math.hypot(slot.x-e.x,slot.z-e.z)<=6)return null;}
 }
 // An owned rush wave can stop its charge during the wave phase. Never predict
 // movement past that contact, including a protected or friendly body block.
 for(const own of g.waves){if(!own.follow||own.ownerId!==e.id)continue;
  if(own.hitIds.length)return null;
  const next={...own,x:e.x+e.aimDx*.55,z:e.z+e.aimDz*.55,y:(e.y||0)+1.9,dx:e.aimDx,dz:e.aimDz};
  for(const b of [...g.enemies,...(g.player?[g.player]:[])]){if(b===e||b!==g.player&&!b.alive||own.hitIds.includes(b===g.player?g.playerId:b.id))continue;const body={x:b.x,y:b.y||0,z:b.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS};if(waveHitsBody(own,body)||sweptWaveHitsBody(next,body,own.x,own.z))return null;}
 }
 const start={x:e.x,y:e.y||0,z:e.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS},end={...start};
 const distance=terrainGroundDistance(g,e,e.aimDx,e.aimDz,CHARGE_SPEED*Math.min(dt,e.attackTimer),npcChargeTravel({...g,guardCache:{...g.guardCache}},e,{x:e.aimDx,z:e.aimDz},g.npcSensing===true?npcPost(g,e,'action'):null));
 clipRush(g,end,e.x+e.aimDx*distance,e.z+e.aimDz*distance,e);
 return terrainOn(g)?Terrain.motion(start,end,CHARGE_SPEED):{start,end,moveDt:Math.hypot(end.x-start.x,end.z-start.z)/CHARGE_SPEED,delay:0};
}
function withinWaveMotionBounds(motion,bounds){const a=motion.start,b=motion.end;return !(Math.max(a.x,b.x)<bounds.minX||Math.min(a.x,b.x)>bounds.maxX||Math.max(a.z,b.z)<bounds.minZ||Math.min(a.z,b.z)>bounds.maxZ||Math.min(a.y,b.y)>bounds.maxY||Math.max(a.y,b.y)+ENEMY_HEIGHT<bounds.minY);}

// Earliest contact for a mature horizontal crescent and an eligible constant-
// height body path. Each relative segment is tested against the original
// polygon's edge capsules, not an inflated disk or a sampled time grid.
function matureSlashContact(waveStart,motion,dt){
 const {start,end,moveDt,delay=0}=motion,r=start.radius,base=start.y||0,h=start.height;
 if(waveStart.kind!=='slash'||waveStart.orientation!=='horizontal'||Math.abs(base-(end.y||0))>1e-9||dt<=0)return null;
 const low=base+Math.min(r,h/2),high=base+h-Math.min(r,h/2),vertical=Math.max(0,Math.abs(clamp(waveStart.y,low,high)-waveStart.y)-waveStart.ry);
 if(vertical>r)return null;const radius=Math.sqrt(Math.max(0,r*r-vertical*vertical));
 const first=Math.max(0,.1-waveStart.age),last=Math.min(dt,waveStart.life-waveStart.age-1e-10),travelEnd=waveTravelEnd(waveStart)-waveStart.age;
 if(last<first)return null;const times=[first,last];for(const t of [delay,delay+moveDt,travelEnd,...bodyMotionTimes(motion)])if(t>first&&t<last)times.push(t);times.sort((a,b)=>a-b);
 const bodyAt=t=>{if(motion.timeline)return bodyMotionAt(motion,t);const u=moveDt>0?clamp((t-delay)/moveDt,0,1):1;return{x:start.x+(end.x-start.x)*u,y:base,z:start.z+(end.z-start.z)*u};};
 const relativeAt=t=>{const body=bodyAt(t),distance=waveTravelDistance(waveStart,waveStart.age,waveStart.age+t),x=body.x-waveStart.x-waveStart.dx*distance,z=body.z-waveStart.z-waveStart.dz*distance;return{x:x*waveStart.dz-z*waveStart.dx,y:x*waveStart.dx+z*waveStart.dz};};
 function circleEntry(x,y,vx,vy,cx,cy){const ox=x-cx,oy=y-cy,c=ox*ox+oy*oy-radius*radius;if(c<=0)return 0;const a=vx*vx+vy*vy;if(a<1e-24)return Infinity;const b=2*(ox*vx+oy*vy),disc=b*b-4*a*c;if(disc<0)return Infinity;const t=(-b-Math.sqrt(disc))/(2*a);return t>=0&&t<=1?t:Infinity;}
 function edgeEntry(p,q,ax,ay,bx,by){const vx=q.x-p.x,vy=q.y-p.y,ex=bx-ax,ey=by-ay,length=Math.hypot(ex,ey);let earliest=circleEntry(p.x,p.y,vx,vy,ax,ay);if(length<1e-12)return earliest;
  const along=((p.x-ax)*ex+(p.y-ay)*ey)/length,across=(-(p.x-ax)*ey+(p.y-ay)*ex)/length,da=(vx*ex+vy*ey)/length,dc=(-vx*ey+vy*ex)/length;let lo=0,hi=1;
  for(const [value,change,min,max] of [[along,da,0,length],[across,dc,-radius,radius]]){if(Math.abs(change)<1e-18){if(value<min||value>max)return earliest;}else{let a=(min-value)/change,b=(max-value)/change;if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return earliest;}}
  if(lo>=0&&lo<=1)earliest=Math.min(earliest,lo);return earliest;
 }
 const profile=SLASH_PROFILES[8];
 for(let n=1;n<times.length;n++){const t0=times[n-1],t1=times[n],p=relativeAt(t0),q=relativeAt(t1);
  if(pointProfileDistanceSquared(p.x,p.y,profile,1.9,1.9)<=radius*radius)return{...bodyAt(t0),t:t0};
  let firstHit=Infinity;for(let i=0,j=profile.length-1;i<profile.length;j=i++)firstHit=Math.min(firstHit,edgeEntry(p,q,profile[j][0]*1.9,profile[j][1]*1.9,profile[i][0]*1.9,profile[i][1]*1.9));
  if(Number.isFinite(firstHit)){const t=t0+(t1-t0)*firstHit;return{...bodyAt(t),t};}
 }
 return null;
}

// Authored-stage bounds and edge frames are immutable derived geometry. They
// only reject impossible candidates; contact still uses the crescent itself.
const SLASH_GROWTH_GEOMETRY=SLASH_PROFILES.map(profile=>{
 const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity},edges=[];
 for(let i=0,j=profile.length-1;i<profile.length;j=i++){
  const a=profile[j],b=profile[i],ex=b[0]-a[0],ey=b[1]-a[1],length=Math.hypot(ex,ey);
  bounds.minX=Math.min(bounds.minX,b[0]);bounds.maxX=Math.max(bounds.maxX,b[0]);bounds.minY=Math.min(bounds.minY,b[1]);bounds.maxY=Math.max(bounds.maxY,b[1]);
  edges.push({x:a[0],y:a[1],ux:length?ex/length:0,uy:length?ey/length:0,length});
 }
 return{profile,bounds,edges};
});
// Exact horizontal crescent contact over its authored growth interval. The body
// is static at this wave phase or follows an already observed, constant-height
// piecewise-linear path. No NPC future path is inferred here.
function growingSlashHitsMotion(waveStart,motion,dt,firstContact=false){
 const {start,end,moveDt,delay=0}=motion,r=start.radius,base=start.y||0,h=start.height;
 if(waveStart.kind!=='slash'||waveStart.orientation!=='horizontal'||waveStart.follow
   ||!Number.isFinite(dt)||dt<=0||!Number.isFinite(moveDt)||moveDt<0||!Number.isFinite(delay)||delay<0||delay+moveDt>dt+1e-9
   ||Math.abs(base-(end.y||0))>1e-9)return null;
 const low=base+Math.min(r,h/2),high=base+h-Math.min(r,h/2),vertical=Math.max(0,Math.abs(clamp(waveStart.y,low,high)-waveStart.y)-waveStart.ry);
 if(vertical>r)return firstContact?null:false;const radius=Math.sqrt(Math.max(0,r*r-vertical*vertical)),radius2=radius*radius;
 const expiry=waveStart.life-waveStart.age,last=Math.min(dt,expiry),travelEnd=waveTravelEnd(waveStart)-waveStart.age;
 if(last<0)return firstContact?null:false;
 // Degenerate vertical tangencies keep the established prefix refinement.
 if(firstContact&&radius<=1e-10)return undefined;let firstTime=Infinity;
 const times=[0,last];
 for(const age of [SLASH_OPEN_DELAY,.075/8,2*.075/8,3*.075/8,4*.075/8,5*.075/8,6*.075/8,7*.075/8,.1]){const t=age-waveStart.age;if(t>0&&t<last)times.push(t);}
 for(const t of [delay,delay+moveDt,travelEnd,...bodyMotionTimes(motion)])if(t>0&&t<last)times.push(t);
 times.sort((a,b)=>a-b);
 const scaleAt=t=>.5+1.4*Math.min(1,(waveStart.age+t)/.1);
 const geometryAt=t=>SLASH_GROWTH_GEOMETRY[Math.min(8,Math.max(1,Math.ceil((waveStart.age+t)/.075*8)))];
 const relativeAt=t=>{const at=motion.timeline?bodyMotionAt(motion,t):null,f=moveDt>0?clamp((t-delay)/moveDt,0,1):1,distance=waveTravelDistance(waveStart,waveStart.age,waveStart.age+t),x=(at?at.x:start.x+(end.x-start.x)*f)-waveStart.x-waveStart.dx*distance,z=(at?at.z:start.z+(end.z-start.z)*f)-waveStart.z-waveStart.dz*distance;return{x:x*waveStart.dz-z*waveStart.dx,y:x*waveStart.dx+z*waveStart.dz};};
 // Test actual shapes at boundaries separately. Adjacent intervals stay open,
 // so a departing tangency of the next profile cannot invent a boundary hit.
 function overlapsBounds(p,q,s0,s1,b){const pad=radius+1e-10;return !(Math.max(p.x,q.x)<Math.min(b.minX*s0,b.minX*s1)-pad||Math.min(p.x,q.x)>Math.max(b.maxX*s0,b.maxX*s1)+pad||Math.max(p.y,q.y)<Math.min(b.minY*s0,b.minY*s1)-pad||Math.min(p.y,q.y)>Math.max(b.maxY*s0,b.maxY*s1)+pad);}
 for(const t of times){if(t>=expiry)continue;const p=relativeAt(t),s=scaleAt(t),shape=geometryAt(t);if(overlapsBounds(p,p,s,s,shape.bounds)&&pointProfileDistanceSquared(p.x,p.y,shape.profile,s,s)<=radius2){if(!firstContact)return true;firstTime=Math.min(firstTime,t);}}
 function intervalEntry(lo,hi){lo=Math.max(0,lo);hi=Math.min(1,hi);return lo<hi||lo===hi&&lo>0&&lo<1?lo:Infinity;}
 function movingCircle(px,py,vx,vy,ax,ay,dx,dy){const x=px-ax,y=py-ay,v= vx-dx,w=vy-dy,A=v*v+w*w,B=x*v+y*w,C=x*x+y*y-radius2;if(A===0)return C<=0?0:Infinity;const disc=B*B-A*C;if(disc<0)return Infinity;const root=Math.sqrt(disc),q=-B-(B<0?-root:root);let a,b;if(q===0)a=b=-B/A;else{a=q/A;b=C/q;if(a>b)[a,b]=[b,a];}return intervalEntry(a,b);}
 function movingEdge(p,q,edge,s0,s1){
  const {x:ex,y:ey,ux,uy,length}=edge,ds=s1-s0,ax=ex*s0,ay=ey*s0,dax=ex*ds,day=ey*ds,vx=q.x-p.x,vy=q.y-p.y;
  const circle=movingCircle(p.x,p.y,vx,vy,ax,ay,dax,day);
  if(length===0)return circle;
  const x=p.x-ax,y=p.y-ay,dx=vx-dax,dy=vy-day,along=x*ux+y*uy,da=dx*ux+dy*uy,across=-x*uy+y*ux,dc=-dx*uy+dy*ux;
  let lo=0,hi=1;
  for(const [value,change] of [[along,da],[length*s0-along,length*ds-da],[radius-across,-dc],[radius+across,dc]]){if(change===0){if(value<0)return circle;}else if(change>0)lo=Math.max(lo,-value/change);else hi=Math.min(hi,-value/change);if(lo>hi)return circle;}
  return Math.min(circle,intervalEntry(lo,hi));
 }
 for(let n=1;n<times.length;n++){const a=times[n-1],b=times[n];if(a>=firstTime)break;if(b<=a)continue;const middle=(a+b)/2,p=relativeAt(a),q=relativeAt(b),shape=geometryAt(middle),s0=scaleAt(a),s1=scaleAt(b);
  if(!overlapsBounds(p,q,s0,s1,shape.bounds))continue;
  const vx=q.x-p.x,vy=q.y-p.y,length2=vx*vx+vy*vy,f=length2?clamp(-(p.x*vx+p.y*vy)/length2,0,1):0,outer=Math.max(s0,s1)+radius+1e-10;
  if((p.x+f*vx)**2+(p.y+f*vy)**2>outer*outer)continue;
  const m=relativeAt(middle),sm=scaleAt(middle);
  // One interior witness plus exact boundary crossings also covers a point
  // staying inside the concave polygon for the entire open interval.
  if(!firstContact&&pointProfileDistanceSquared(m.x,m.y,shape.profile,sm,sm)<=radius2)return true;
  // A strict interior at the right-hand stage limit contacts immediately.
  // Departing tangencies are excluded by each edge's open-interval test.
  if(firstContact&&pointProfileDistanceSquared(p.x,p.y,shape.profile,s0,s0)<radius2)firstTime=Math.min(firstTime,a);
  for(const edge of shape.edges){const entry=movingEdge(p,q,edge,s0,s1);if(Number.isFinite(entry)){if(!firstContact)return true;firstTime=Math.min(firstTime,a+(b-a)*entry);}}
 }
 return firstContact?(Number.isFinite(firstTime)?firstTime:null):false;
}

// Charge-only time of contact on the same sampled sweep used by updateWaves.
// The ellipsoid/capsule separation is convex along this linear segment. Find
// its minimum, then the first crossing, rather than sorting bodies by center.
function chargeWaveContact(previous,w,body,dt){
 const separation=t=>{const x=body.x-previous.x-(w.x-previous.x)*t,z=body.z-previous.z-(w.z-previous.z)*t,y=previous.y+(w.y-previous.y)*t,low=(body.y||0)+Math.min(body.radius,body.height/2),high=(body.y||0)+body.height-Math.min(body.radius,body.height/2);return pointEllipsoidDistanceSquared(x*w.dz-z*w.dx,clamp(y,low,high)-y,x*w.dx+z*w.dz,w.rx,w.ry,w.rz)-body.radius*body.radius;};
 if(separation(0)<=0)return 0;
 let lo=0,hi=1,end=1;if(separation(1)>0){for(let i=0;i<42;i++){const a=(2*lo+hi)/3,b=(lo+2*hi)/3;if(separation(a)<=separation(b))hi=b;else lo=a;}end=(lo+hi)/2;if(separation(end)>1e-12)return null;}
 lo=0;hi=end;for(let i=0;i<42;i++){const mid=(lo+hi)/2;if(separation(mid)<=1e-12)hi=mid;else lo=mid;}return hi*dt;
}
// Current authored ordinary waves share this phase. Held thrusts and deferred
// walking-body slash contacts retain their existing post-NPC-motion phases.
function ordinaryWaveContact(previous,w,body,motion,dt){
 if(w.kind==='charge'||w.kind==='thrust'){const t=chargeWaveContact(previous,w,body,dt);return t===null?null:{...body,t};}
 if(w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&dt>0)return observedSlashContact(previous,motion||{start:body,end:body,moveDt:0,delay:0},dt);
 if(w.kind==='burst'){
  if(waveHitsBody(previous,body))return {...body,t:0};if(!waveHitsBody(w,body))return null;
  let lo=0,hi=dt;for(let i=0;i<36;i++){const t=(lo+hi)/2,r=.6+2.2*Math.min(1,(previous.age+t)/.16);if(waveHitsBody({...w,rx:r,rz:r},body))hi=t;else lo=t;}return {...body,t:hi};
 }
 // Legacy/un-authored shapes retain their collision test and end-of-step time.
 return waveHitsBody(previous,body)?{...body,t:0}:sweptWaveHitsBody(w,body,previous.x,previous.z)?{...body,t:dt}:null;
}
// DEV opt-in experiment only. Must be paired with the visible telegraph.
function escortBraceEligible(g,e){return !!(g.devEscortBrace===true&&g.active&&!battleEnded(g)&&g.npcSensing===true&&e!==g.player&&e.alive&&['gold','silver'].includes(e.piece)&&e.attack==='idle'&&Math.abs(e.y||0)<1e-9&&!(e.stagger>0)&&!(e.spawnProtection>0)&&!(e.invulnerable>0)&&KingPersonality.escorts(g,e.team).includes(e));}
function escortBraceTick(g,e){
 let b=e.escortBrace;
 if(b&&(b.team!==e.team||!escortBraceEligible(g,e))){delete e.escortBrace;return false;}
 if(b){if(g.time>=b.end){delete e.escortBrace;return false;}e.intent=g.time<b.activeAt?'brace_windup':g.time<b.recoverAt?'brace_active':'brace_recovery';return true;}
 if(!escortBraceEligible(g,e)||g.time<(e.escortBraceReadyAt||0))return false;
 const king=KingPersonality.liveKing(g,e.team);if(!king)return false;
 const threats=[];
 // A stance is an explicit tactical commitment against a currently perceived
 // nearby actor, not a reaction that waits until its slash has already begun.
 const foes=[...g.enemies.filter(a=>a.alive&&a.team!==e.team),...(g.player&&e.team==='enemy'?[g.player]:[])];
 for(const a of foes){const dx=e.x-a.x,dz=e.z-a.z,d=Math.hypot(dx,dz);if(d>.01&&d<=8&&Math.hypot(a.x-king.x,a.z-king.z)<=11.5)threats.push({x:a.x,z:a.z,dx:dx/d,dz:dz/d,id:a.id});}
 threats.sort((a,b)=>Math.hypot(a.x-king.x,a.z-king.z)-Math.hypot(b.x-king.x,b.z-king.z)||a.id-b.id);
 for(const t of threats){const dx=e.x-t.x,dz=e.z-t.z,d=Math.hypot(dx,dz);if(d>8||d<.01||dx*t.dx+dz*t.dz<0||Math.abs(dx*t.dz-dz*t.dx)>2.2||(king.x-e.x)*t.dx+(king.z-e.z)*t.dz<.5)continue;
  const face=enemyDirection(e,-dx,-dz);if(!face)continue;
  e.escortBrace={team:e.team,dx:face.x,dz:face.z,activeAt:g.time+.30,recoverAt:g.time+.70,end:g.time+1.20,used:false};e.escortBraceReadyAt=g.time+1.60;e.aimDx=face.x;e.aimDz=face.z;e.intent='brace_windup';
  g.events.push({type:'escort_brace_windup',id:e.id,team:e.team,x:e.x,z:e.z,dx:face.x,dz:face.z,duration:.30});return true;
 }
 return false;
}
function escortBraceContact(g,e,w,time){const b=e.escortBrace;if(!b||b.used||!escortBraceEligible(g,e)||b.team!==e.team||w.kind!=='slash'||time<b.activeAt-1e-9||time>=b.recoverAt-1e-9||b.dx*w.dx+b.dz*w.dz>-.70)return false;
 b.used=true;b.recoverAt=time;b.end=time+.50;w.escortIntercepted=true;w.age=w.life;w.hitIds.push(e.id);e.intent='brace_recovery';g.events.push({type:'escort_brace_block',id:e.id,team:e.team,waveId:w.id,x:e.x,z:e.z});return true;
}

function updateWaves(g,dt,heroMotion=null,deathMotion=null,slashFrames=null,ordinaryMotions=null){
 const pending=[],consumed=new Set(),owners=new Map(),alive=e=>e===g.player?g.hp>0:!!e?.alive;
 // Prediction eligibility reads one phase-start snapshot, never ages changed
 // by whichever wave happened to be visited first.
 const phaseShapes=new Map(g.waves.map(w=>[w,{...w}])),phaseGame={...g,waves:[...phaseShapes.values()]};
 for(const w of g.waves){if(w.held)continue;const previous=phaseShapes.get(w),oldAge=w.age;let owner=null;
  if(slashFrames&&w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&oldAge<w.life)slashFrames.push({wave:w,start:previous});
  const travel=waveTravelDistance(w,oldAge,oldAge+dt);w.age+=dt;if(w.kind==='burst')w.rx=w.rz=.6+2.2*Math.min(1,w.age/.16);if(w.kind==='slash'){w.rx=w.rz=.5+1.4*Math.min(1,w.age/.1);w.profileStage=Math.min(8,Math.max(1,Math.ceil(w.age/.075*8)));w.profile=SLASH_PROFILES[w.profileStage];}
  if(w.follow){owner=w.ownerId==null?g.player:g.enemies.find(e=>e.id===w.ownerId);const active=owner===g.player?['charge','dragon'].includes(g.mode):owner?.alive&&owner.attack==='charge';if(!active||g.lost){w.age=w.life;continue;}owners.set(w,owner);w.dx=owner===g.player?owner.dx:owner.aimDx;w.dz=owner===g.player?owner.dz:owner.aimDz;w.x=owner.x+w.dx*.55;w.z=owner.z+w.dz*.55;w.y=(owner.y||0)+1.9;}
  else{w.x+=w.dx*travel;w.z+=w.dz*travel;}
  if(oldAge>=(w.kind==='slash'?w.life:w.life-.035)||battleEnded(g))continue;
  const opposing=w.team==='player'?'enemy':'ally',bounds=waveCandidateBounds(previous,w,previous.x,previous.z),mature=w.kind==='slash'&&oldAge>=.1&&dt>0,growing=w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&oldAge<.1&&dt>0,motions=new Map();
  const inBounds=e=>{if(growing&&e===g.player&&heroMotion){motions.set(e,heroMotion);return withinWaveMotionBounds(heroMotion,bounds);}if(!mature)return withinWaveCandidateBounds(e,bounds);const motion=matureSlashBodyMotion(phaseGame,e,dt,heroMotion,previous);if(motion){motions.set(e,motion);return withinWaveMotionBounds(motion,bounds);}return withinWaveCandidateBounds(e,bounds);};
  const targets=g.enemies.filter(e=>e.alive&&e.id!==w.sourceId&&!w.hitIds.includes(e.id)&&((e.team||'enemy')===opposing||w.kind==='charge')&&inBounds(e));if(g.player&&(w.team==='enemy'||w.kind==='charge')&&g.playerId!==w.sourceId&&!w.hitIds.includes(g.playerId)&&inBounds(g.player))targets.push(g.player);
  for(const e of targets){const body={x:e.x,y:e.y||0,z:e.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS};if(w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&ordinaryMotions?.get(e)?.defer&&!waveHitsBody(previous,body))continue;const motion=motions.get(e),contact=ordinaryWaveContact(previous,w,body,motion,dt);if(contact)pending.push({w,owner,e,t:contact.t,contact:motion&&e!==g.player?contact:null,along:(e.x-w.x)*w.dx+(e.z-w.z)*w.dz});}
 }
 pending.sort((a,b)=>a.t-b.t||(a.w.sourceId??-1)-(b.w.sourceId??-1)||a.w.id-b.w.id||a.along-b.along||(a.e.id??g.playerId)-(b.e.id??g.playerId));
 for(let index=0;index<pending.length&&!battleEnded(g);){const time=pending[index].t,batch=[],reserved=new Set(),terminal=[];let end=index+1;while(end<pending.length&&pending[end].t<=time+1e-8)end++;
  for(let i=index;i<end;i++){const c=pending[i],{w,owner,e}=c,single=w.kind==='charge'||w.kind==='thrust';if(consumed.has(w)||single&&reserved.has(w))continue;if(w.follow&&!alive(owner)){consumed.add(w);w.age=w.life;continue;}if(!alive(e)||w.hitIds.includes(e===g.player?g.playerId:e.id))continue;if(single)reserved.add(w);batch.push(c);}
  // Validate every bound owner and first body at this contact instant before
  // damage. Detached attacks remain independent; earlier deaths cancel rushes.
  for(const {w,owner,e,contact} of batch){const isPlayer=e===g.player,hostile=isPlayer?w.team==='enemy':(e.team||'enemy')===(w.team==='player'?'enemy':'ally'),single=w.kind==='charge'||w.kind==='thrust';
   if(single){consumed.add(w);w.age=w.life;if(w.kind==='charge'){if(w.ownerId==null)g.chargeContact=true;else if(owner)owner.chargeContact=true;else{const source=g.enemies.find(n=>n.id===w.ownerId);if(source)source.chargeContact=true;}}}
   if(w.escortIntercepted)continue;if(!isPlayer&&hostile&&escortBraceContact(g,e,w,g.time-dt+time)){consumed.add(w);continue;}
   if(!hostile)continue;w.hitIds.push(isPlayer?g.playerId:e.id);if(e.spawnProtection>0)continue;
   if(isPlayer){w.hitPlayer=true;if(g.guarding){g.guardFlash=.18;g.events.push({type:'guard_block',x:e.x,y:e.y,z:e.z});}else if(g.invulnerable<=0&&g.hp>0){g.hp=Math.max(0,g.hp-1);g.invulnerable=.72;g.damageFlash=.22;g.playerHits++;g.events.push({type:'player_hit',x:e.x,y:e.y,z:e.z,hp:g.hp,maxHp:g.maxHp});if(g.hp===0)terminal.push({win:false,reason:'hero'});}}
   else if(!(e.invulnerable>0)){hit(g,e,w.dx,w.dz,w.kind,w.team,w.ownerId,w,contact,terminal);if(contact&&!e.alive&&deathMotion)deathMotion.set(e,Math.max(0,dt-contact.t));}
  }
  if(terminal.length){finishContactBatch(g,terminal);}
  index=end;
 }
 for(const [w,owner] of owners)if(!alive(owner))w.age=w.life;
 g.waves=g.waves.filter(w=>w.age<w.life);
}

// Voluntary NPC walking happens after the normal wave phase. Initial contact
// remains immediate; eligible idle NPC future slash contact waits for the real
// body-clipped path (or a verified stationary body). Mixed-wave and possible
// terminal hazards retain prior priority plus the observed-entry supplement.
// No AI path is predicted and no landing/separation/respawn correction is travel.

// Preserve existing priority when another kind of wave could reach this actor.
// Conservative bounds are enlarged only for eligibility, never for collision.
// Any possible vulnerable royal/hero contact disables deferral for the frame:
// several waves may jointly end the battle and cancel unresolved contacts.
function ordinarySlashHazards(g,dt){
 const waves=[];let terminal=false;
 if(!g.active||!g.waves.some(w=>w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&w.age<w.life))return {waves,terminal};
 const travel=Math.max(movementSpeed(g,'ally',true),movementSpeed(g,'enemy',true))*dt;
 for(const w of g.waves){const deferredSlash=w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow;if(w.age>=(w.kind==='slash'?w.life:w.life-.035))continue;
  const next={...w},waveTravel=waveTravelDistance(w,w.age,w.age+dt);
  if(w.kind==='burst')next.rx=next.rz=.6+2.2*Math.min(1,(w.age+dt)/.16);if(w.kind==='slash')next.rx=next.rz=.5+1.4*Math.min(1,(w.age+dt)/.1);
  if(w.follow){const owner=w.ownerId==null?g.player:g.enemies.find(e=>e.id===w.ownerId);if(!owner)continue;next.dx=w.ownerId==null?owner.dx:owner.aimDx;next.dz=w.ownerId==null?owner.dz:owner.aimDz;next.x=owner.x+next.dx*.55;next.z=owner.z+next.dz*.55;next.y=(owner.y||0)+1.9;}
  else{next.x+=w.dx*waveTravel;next.z+=w.dz*waveTravel;}
  if(w.held){const owner=w.sourceId===g.playerId?g.player:g.enemies.find(e=>e.id===w.sourceId);if(owner){const tip=thrustPoint(owner,w.dx,w.dz,Math.min(THRUST.extendEnd,THRUST.release+(w.age+dt)*(w.swingScale||1)));Object.assign(next,{x:tip.x,y:tip.y,z:tip.z});}}
  const bounds=waveCandidateBounds(w,next,w.x,w.z);bounds.minX-=travel;bounds.maxX+=travel;bounds.minZ-=travel;bounds.maxZ+=travel;if(!deferredSlash)waves.push({wave:w,bounds});
  const opposing=w.team==='player'?'enemy':'ally';
  if(g.enemies.some(e=>e.alive&&e.piece==='king'&&e.id!==w.sourceId&&(e.team||'enemy')===opposing&&!(e.spawnProtection>0)&&!(e.invulnerable>0)&&withinWaveCandidateBounds(e,bounds))||w.team==='enemy'&&g.hp>0&&!g.guarding&&g.invulnerable<=0&&!(g.player.spawnProtection>0)&&withinWaveCandidateBounds(g.player,bounds))terminal=true;
 }
 return {waves,terminal};
}

function observedSlashContact(start,motion,dt){
 if(start.age>=.1)return matureSlashContact(start,motion,dt);
 const first=growingSlashHitsMotion(start,motion,dt,true);if(first!==undefined)return first===null?null:{...bodyMotionAt(motion,first),t:first};
 if(!growingSlashHitsMotion(start,motion,dt))return null;
 const bodyAt=t=>bodyMotionAt(motion,t);
 // Prefix contact is monotone. Analytic authored-stage tests are used for
 // each prefix; this is time-of-impact refinement, not collision sampling.
 let lo=0,hi=dt;
 for(let i=0;i<32;i++){const mid=(lo+hi)/2,delay=Math.min(mid,motion.delay||0),moveDt=Math.min(mid-delay,motion.moveDt),part={start:motion.start,end:bodyAt(mid),moveDt,delay,...(motion.timeline?{timeline:[...motion.timeline.filter(p=>p.t<moveDt),{...bodyAt(mid),t:moveDt}]}:{})};if(growingSlashHitsMotion(start,part,mid))hi=mid;else lo=mid;}
 return {...bodyAt(hi),t:hi};
}
function resolveObservedSlashMotions(g,dt,frames,motions){
 if(battleEnded(g)||!dt||!frames.length)return;
 const walking=[...motions].filter(([,record])=>record.defer||record.motion);if(!walking.length)return;
 for(const {wave:w,start} of frames){if(w.escortIntercepted)continue;
  const opposing=w.team==='player'?'enemy':'ally',contacts=[],bounds=waveCandidateBounds(start,w,start.x,start.z);
  for(const [e,record] of walking){if(!e.alive||e.team!==record.team||(e.team||'enemy')!==opposing||e.id===w.sourceId||w.hitIds.includes(e.id)||e.spawnProtection>0||Math.abs(e.y||0)>1e-9)continue;
   const motion=record.motion||{start:record.start,end:record.start,moveDt:0,delay:0};if(Math.abs(e.x-motion.end.x)>1e-9||Math.abs(e.z-motion.end.z)>1e-9||!withinWaveMotionBounds(motion,bounds))continue;const contact=observedSlashContact(start,motion,dt);if(contact)contacts.push({e,contact});
  }
  contacts.sort((a,b)=>a.contact.t-b.contact.t||a.e.id-b.e.id);
  for(const {e,contact} of contacts){if(w.escortIntercepted)break;if(!e.alive||w.hitIds.includes(e.id))continue;if(escortBraceContact(g,e,w,g.time-dt+contact.t))break;w.hitIds.push(e.id);if(!(e.invulnerable>0)){hit(g,e,w.dx,w.dz,w.kind,w.team,w.ownerId,w,contact);if(!e.alive){const remaining=Math.max(0,dt-contact.t);e.age+=remaining;e.x+=e.vx*remaining;e.z+=e.vz*remaining;e.y+=e.vy*remaining;e.vy-=18*remaining;e.angle+=e.spin*remaining;}}
   if(battleEnded(g))return;
  }
 }
}

// The existing solvers call this only for one exact contact-time batch.
// Never infer simultaneity merely because hits share a simulation frame.
function finishContactBatch(g,terminal){
 if(isSpectator(g)&&terminal.some(t=>t.win)&&terminal.some(t=>!t.win)){finishBattle(g,null,terminal.every(t=>t.reason==='king')?'mutual-kings':'mutual-terminal');return;}
 const loss=terminal.find(t=>!t.win&&t.reason==='hero')||terminal.find(t=>!t.win),result=loss||terminal[0];finishBattle(g,result.win,result.reason);
}
function finishBattle(g,win,reason){if(battleEnded(g))return;npcForgetPromotionPerception(g,null,true);finishCapturedReturn(g);if(g.battleScenario)g.scenarioOutcome=reason;if(g.player)delete g.player.awakeningEntry;for(const unit of g.enemies)delete unit.awakeningEntry;const draw=isSpectator(g)&&win===null;if(draw){g.draw=true;g.drawTime=g.time;g.drawReason=reason;g.lossReason=null;}else{g[win?'won':'lost']=true;g[win?'winTime':'lossTime']=g.time;g.lossReason=win?null:reason;}if(g.thrustAction)delete g.thrustAction;g.mode='ready';g.phase=0;if(g.player)g.player.y=0;g.guarding=false;g.active=false;g.hitstop=0;g.vacancies=[];for(const unit of g.enemies){npcResetCastleState(g,unit);unit.pendingTeam=null;unit.respawnAt=null;unit.reinforceTarget=null;if(unit.alive){unit.y=0;unit.stagger=0;unit.attack='idle';unit.attackTimer=0;}}g.events.push({type:draw?'draw':win?'win':'lose',reason});}
function hit(g,e,dx,dz,action=g.mode,team='player',ownerId,wave,contact,terminalRequests=null){const personal=wave?.personal??(team==='player'&&ownerId==null);
 if(battleEnded(g)||!e.alive)return;e.hp=Math.max(0,(e.hp??1)-1);e.hurtFlash=.22;if(e.hp>0){g.events.push({type:'npc_damage',id:e.id,hitDx:dx,hitDz:dz,x:contact?.x??e.x,y:contact?.y??e.y,z:contact?.z??e.z,team:e.team,personal,hp:e.hp,maxHp:e.maxHp,waveId:wave?.id,sourceId:wave?.sourceId,action,time:g.time});if(personal)g.hitstop=Math.max(g.hitstop,.025);return;}if(contact){e.x=contact.x;e.y=contact.y;e.z=contact.z;}registerVacancy(g,e);const p=Number.isFinite(wave?.sourceX)&&Number.isFinite(wave?.sourceZ)?{x:wave.sourceX,z:wave.sourceZ}:g.player||e,side=(e.x-p.x)*(-dz)+(e.z-p.z)*dx>=0?1:-1;npcForgetPromotionPerception(g,e,true);npcResetCastleState(g,e);e.alive=false;delete e.awakeningEntry;e.reinforceTarget=null;e.age=0;e.chainDepth=0;e.chainHitIds=[];e.stagger=0;e.vx=dx*10-dz*side*(4+e.id%4);e.vz=dz*10+dx*side*(4+e.id%4);e.vy=7+e.id%3;e.spin=side*(5+e.id%3);g.npcCaptures++;
 if(personal){g.score++;g.combo=g.time-g.lastHit<1.35?g.combo+1:1;g.lastHit=g.time;g.best=Math.max(g.best,g.combo);if([5,10,20].includes(g.combo))g.events.push({type:'combo_tier',combo:g.combo});if(!g.firstHit){g.firstHit=true;g.hitstop=.04;}}
 g.events.push({type:personal?'hit':'npc_hit',x:e.x,z:e.z,id:e.id,team:e.team,action,personal,waveId:wave?.id,sourceId:wave?.sourceId,time:g.time});
 // These two lessons finish on demonstrated actions in their tutorial adapter,
 // never on a personal wipe alone. Damage and defeat retain normal rules.
 if(g.scenario==='switch_trial'){const lesson=g.switchLesson;if(e.id===lesson?.targetId){const complete=lesson.switched&&personal===true&&wave?.sourceId===lesson.allyActorId&&g.playerId===lesson.allyActorId;finishBattle(g,complete,complete?'switched-ally-kill':'switch-lesson-order');}return;}
 if(['guard_trial','awaken_trial'].includes(g.scenario))return;
 if(g.scenario&&g.scenario!=='army'){if(!g.enemies.some(n=>n.alive&&n.team==='enemy')){if(terminalRequests)terminalRequests.push({win:true,reason:'practice'});else finishBattle(g,true,'practice');}return;}
 if(isSpectator(g)&&e.team==='ally'&&!g.enemies.some(n=>n.alive&&n.team==='ally')){if(terminalRequests)terminalRequests.push({win:false,reason:e.piece==='king'?'king':'army'});else finishBattle(g,false,e.piece==='king'?'king':'army');return;}
 if(e.piece==='king'){if(e.team==='enemy'&&g.battleScenario?.objective==='protect')return;if(terminalRequests)terminalRequests.push({win:e.team!=='ally',reason:'king'});else finishBattle(g,e.team!=='ally','king');return;}
 if(holdCapturedReturn(g,e))return;
 e.pendingTeam=e.team==='ally'?'enemy':'ally';e.respawnAt=g.time+RESPAWN_DELAY;

}
function respawnNPC(g,e){if(!handicapTransferReturnLegal(g,e))return;const capturedTicket=capturedReturnBeforeRespawn(g,e);if(capturedTicket===false)return;friendlyRouteLegs.delete(e);delete e.awakeningEntry;
 const team=e.pendingTeam,pos=g.formationSlots.find(s=>s.team===team&&s.slotKey===e.slotKey);if(!pos||!terrainDry(g,pos)||g.player&&Math.hypot(pos.x-g.player.x,pos.z-g.player.z)<2.3||g.enemies.some(b=>b!==e&&b.alive&&Math.hypot(b.x-pos.x,b.z-pos.z)<1.5))return;
 npcForgetPromotionPerception(g,e,true);npcResetCastleState(g,e);
 // The six effective promoted keys preserve their exact origin, including
 // the four forms displayed as 成金 and presets without basePiece metadata.
 // Restore only on successful revival; captured/waiting bodies keep their form.
 const base=Object.keys(PIECES).find(key=>PIECES[key].promote===e.piece);
 if(base){Object.assign(e,{piece:base,effectivePiece:base,basePiece:base,promoted:false,transformUntil:0,guarding:false});delete e.actionKind;delete e.actionPost;}
 delete e.awakeningReentryRequired;
 Object.assign(e,{team,recruitedTeam:team,alive:true,hp:npcHomeHp(g,team,e.slotKey),maxHp:npcHomeHp(g,team,e.slotKey),equipment:npcHomeEquipment(g,team,e.slotKey),hurtFlash:0,invulnerable:0,heroCooldowns:null,npcCooldownUsed:true,homeX:pos.x,homeZ:pos.z,x:pos.x,z:pos.z,y:0,age:0,vx:0,vy:0,vz:0,angle:0,spin:0,stagger:0,shoveX:0,shoveZ:0,chainDepth:0,chainHitIds:[],reinforceTarget:null,attack:'idle',attackTimer:0,attackReadySince:null,attackCooldown:1.3,aimDx:0,aimDz:team==='ally'?-1:1,spawnProtection:1.0,approachDir:null,pendingTeam:null,respawnAt:null,targetX:pos.x,targetZ:pos.z,intentTargetId:null,intentUntil:0,intent:'hold'});if(base&&inAwakeningZone(g,e))e.awakeningReentryRequired=true;g.reinforcements++;g.events.push({type:'reinforce',id:e.id,team,x:e.x,z:e.z});consumeCapturedReturn(g,capturedTicket);
}
// Crowd contacts never kill or score. Only the visible attack waves can do that.
function shove(g,e,dx,dz,speed,depth){
 if(!e.alive||e.trainingGuard)return;registerVacancy(g,e);e.reinforceTarget=null;const n=Math.hypot(dx,dz)||1;e.shoveStartX=e.x;e.shoveStartZ=e.z;e.shoveX=dx/n*speed;e.shoveZ=dz/n*speed;e.stagger=.42;e.staggerLife=.42;if(e.actionKind==='thrust')e.actionKind=null;e.chainDepth=depth;e.chainHitIds=[];e.attack='recover';e.npcCooldownUsed=true;e.attackTimer=.25;e.attackCooldown=Math.max(e.attackCooldown,.65);g.events.push({type:'shove',id:e.id,x:e.x,z:e.z});
}
function updatePromotion(g,dt){const q=g.promotionPulse;if(!q)return;q.age+=dt;if(q.age<0)return;if(q.age>=q.life){g.promotionPulse=null;return;}q.previousRadius=q.radius;q.radius=.65+4.55*Math.min(1,q.age/.4);
 if(battleEnded(g))return;for(const e of g.enemies){if(!e.alive||e.team==='ally'||q.hitIds.includes(e.id)||e.y>q.height)continue;const dx=e.x-q.x,dz=e.z-q.z,r=Math.hypot(dx,dz);if(r+ENEMY_RADIUS>=q.previousRadius-q.halfWidth&&r-ENEMY_RADIUS<=q.radius+q.halfWidth){q.hitIds.push(e.id);shove(g,e,dx,dz,10,0);}}
}
function updateShoves(g,dt){
 for(const e of g.enemies){if(!e.alive||!(e.stagger>0))continue;e.shoveStartX=e.x;e.shoveStartZ=e.z;e.stagger=Math.max(0,e.stagger-dt);terrainMove(g,e,e.x+e.shoveX*dt,e.z+e.shoveZ*dt);e.shoveX*=Math.exp(-dt*4);e.shoveZ*=Math.exp(-dt*4);e.y=.28*Math.sin(Math.PI*(1-e.stagger/e.staggerLife));if(!e.stagger)e.y=0;}
 if(battleEnded(g))return;
 for(const a of g.enemies){const flying=!a.alive&&a.age<.65&&a.y<2.1,pushing=a.alive&&a.stagger>.13;if((!flying&&!pushing)||(a.chainDepth||0)>=2)continue;const vx=flying?a.vx:a.shoveX,vz=flying?a.vz:a.shoveZ,speed=Math.hypot(vx,vz);if(![a.x,a.z,vx,vz].every(Number.isFinite)||(pushing&&![a.shoveStartX,a.shoveStartZ].every(Number.isFinite))||speed<3)continue;a.chainHitIds ||= [];
  for(const b of g.enemies){if(!b.alive||b===a||a.chainHitIds.includes(b.id)||b.stagger>.2)continue;if(distanceSegment(b.x,b.z,pushing?a.shoveStartX:a.x,pushing?a.shoveStartZ:a.z,pushing?a.x:a.x+vx*dt,pushing?a.z:a.z+vz*dt)>ENEMY_RADIUS*2)continue;a.chainHitIds.push(b.id);shove(g,b,vx,vz,Math.min(9,speed*.6),(a.chainDepth||0)+1);g.chainContacts++;}
 }
}
function registerVacancy(g,e){if(!g.vacancies)return;if(e.reinforceTarget!=null&&!g.vacancies.includes(e.reinforceTarget))g.vacancies.push(e.reinforceTarget);for(const slot of g.formationSlots)if(slot.team===(e.team||'enemy')&&Math.hypot(e.x-slot.x,e.z-slot.z)<.8&&!g.vacancies.includes(slot.id))g.vacancies.push(slot.id);}
function assignReinforcements(g,dt){
 if(g.scenario!=='army'||!g.active||battleEnded(g)||!g.vacancies.length)return;g.reformTimer-=dt;if(g.reformTimer>0)return;g.reformTimer=.25;
 const reserved=new Set(g.enemies.filter(e=>e.alive&&e.reinforceTarget!=null).map(e=>e.reinforceTarget));
 g.vacancies=g.vacancies.filter(id=>{const slot=g.formationSlots.find(s=>s.id===id);if(!slot||g.player&&Math.hypot(g.player.x-slot.x,g.player.z-slot.z)<.8||reserved.has(id)||g.enemies.some(e=>!e.alive&&e.pendingTeam===slot.team&&e.slotKey===slot.slotKey)||g.enemies.some(e=>e.alive&&!(e.stagger>0)&&Math.hypot(e.x-slot.x,e.z-slot.z)<.8)){rememberCapturedReturnVacancy(g,id,slot,reserved);return false;}
 const candidates=g.enemies.filter(e=>e.alive&&!npcCastleDuty(g,e)&&(e.team||'enemy')===slot.team&&e.piece!=='king'&&!KingPersonality.mobileEscort(g,e)&&!npcRoyalFollower(g,e)&&!(e.stagger>0)&&e.attack==='idle'&&e.reinforceTarget==null&&Math.hypot(e.x-slot.x,e.z-slot.z)<=5.5&&!!npcRoute(e,slot.x,slot.z,g)).sort((a,b)=>Math.hypot(a.x-slot.x,a.z-slot.z)-Math.hypot(b.x-slot.x,b.z-slot.z)||a.id-b.id);const unit=candidates[0];if(!unit)return true;unit.reinforceTarget=id;reserved.add(id);return false;});
}
function clipRush(g,body,tx,tz,owner=null,allowSeparating=false,spacing=HERO_RADIUS+ENEMY_RADIUS){const ax=body.x,az=body.z,dx=tx-ax,dz=tz-az,A=dx*dx+dz*dz;let t=terrainOn(g)?Terrain.clipSegment(body,{x:tx,z:tz},.6,'river').t:1;if(g?.arena)t=Math.min(t,arenaClip(g,body,{x:tx,z:tz}).t);const blockers=g.enemies.filter(e=>e.alive&&e!==owner&&(e.y||0)<HERO_HEIGHT);if(owner&&g.player&&(g.player.y||0)<ENEMY_HEIGHT)blockers.push(g.player);for(const b of blockers){const ox=ax-b.x,oz=az-b.z,r=spacing,C=ox*ox+oz*oz-r*r;if(C<=1e-8){if(allowSeparating&&ox*dx+oz*dz>=-1e-9)continue;t=0;continue;}if(A<1e-12)continue;const B=2*(ox*dx+oz*dz),disc=B*B-4*A*C;if(disc>=0){const q=(-B-Math.sqrt(disc))/(2*A);if(q>=0&&q<=t)t=q;}}body.x=ax+dx*t;body.z=az+dz*t;return t<1;}
function separateNPCPair(a,b,g=null){
 if(!a.alive||!b.alive||a.stagger>0||b.stagger>0||a.attack==='leap'||b.attack==='leap'||Math.abs((a.y||0)-(b.y||0))>=ENEMY_HEIGHT)return;
 for(let pass=0;pass<3;pass++){let dx=a.x-b.x,dz=a.z-b.z,len=Math.hypot(dx,dz);if(len>=1.4-1e-8)return;if(len<1e-8){const angle=((a.id||0)*7+(b.id||0)*11)*Math.PI/4;dx=Math.cos(angle);dz=Math.sin(angle);}else{dx/=len;dz/=len;}const deficit=1.4-len,wa=a.trainingGuard?0:1,wb=b.trainingGuard?0:1,total=wa+wb;if(!total)return;const share=pass===0?deficit/total:deficit;if(wa){terrainMove(g,a,clamp(a.x+dx*share,arenaBounds(g).minX,arenaBounds(g).maxX),clamp(a.z+dz*share,arenaBounds(g).minZ,arenaBounds(g).maxZ));}if(wb){const left=Math.max(0,1.4-Math.hypot(a.x-b.x,a.z-b.z));const move=pass===0?share:left;terrainMove(g,b,clamp(b.x-dx*move,arenaBounds(g).minX,arenaBounds(g).maxX),clamp(b.z-dz*move,arenaBounds(g).minZ,arenaBounds(g).maxZ));}}
}
function terrainLandingAngles(){return [];}
function clearHeroLanding(g,e){
 const p=g.player,R=HERO_RADIUS+ENEMY_RADIUS,eps=1e-7;e.contactWait=false;if(!p||!e.alive||e.trainingGuard||g.mode==='jump'||e.attack==='leap'||Math.abs(p.y||0)>.001||Math.abs(e.y||0)>.001||Math.hypot(e.x-p.x,e.z-p.z)>=R-eps)return;
 const ox=e.x,oz=e.z,peers=g.enemies.filter(b=>b!==e&&b.alive&&b.attack!=='leap'&&Math.abs(b.y||0)<.001);let preferred=Math.atan2(oz-p.z,ox-p.x);if(Math.hypot(ox-p.x,oz-p.z)<eps)preferred=e.leapStart?Math.atan2(e.leapStart.z-p.z,e.leapStart.x-p.x):(e.id+1)*2.399963;
 for(const strict of [true,false]){const angles=[preferred,...terrainLandingAngles(g,p,R)],limits=peers.map(b=>({b,t:strict?1.4:Math.min(1.4,Math.hypot(ox-b.x,oz-b.z))}));for(const {b,t} of limits){const dx=b.x-p.x,dz=b.z-p.z,d=Math.hypot(dx,dz);if(d<eps)continue;const k=(R*R+d*d-t*t)/(2*R*d);if(Math.abs(k)<=1){const phi=Math.atan2(dz,dx),a=Math.acos(k);angles.push(phi-a,phi+a);}}
  for(const x of [arenaBounds(g).minX,arenaBounds(g).maxX]){const v=(x-p.x)/R;if(Math.abs(v)<=1){const a=Math.acos(v);angles.push(a,-a);}}for(const z of [arenaBounds(g).minZ,arenaBounds(g).maxZ]){const v=(z-p.z)/R;if(Math.abs(v)<=1){const a=Math.asin(v);angles.push(a,Math.PI-a);}}
  const candidates=angles.map((angle,i)=>({x:p.x+Math.cos(angle)*R,z:p.z+Math.sin(angle)*R,i})).filter(q=>terrainPath(g,e,q)&&arenaContains(g,q,eps)&&limits.every(({b,t})=>Math.hypot(q.x-b.x,q.z-b.z)>=t-eps)).sort((a,b)=>Math.hypot(a.x-ox,a.z-oz)-Math.hypot(b.x-ox,b.z-oz)||a.i-b.i);
  if(candidates.length){e.x=clamp(candidates[0].x,arenaBounds(g).minX,arenaBounds(g).maxX);e.z=clamp(candidates[0].z,arenaBounds(g).minZ,arenaBounds(g).maxZ);return;}
 }
 e.contactWait=true;
}
// Resolve ready wounded units' higher-priority withdrawals before assigning
// attack slots. These are real, collision-checked moves, performed once. A
// blocked withdrawal must still be allowed to attack; never preview movement
// against a clone because movement also records real slash-contact motion.
// Evaluate the unchanged rush shape over its entire body-clipped travel.
// Bodies are held at the current decision instant; this is not a promise
// about where a moving friend or target will be after the warning.
function npcChargeFirstContact(g,e,face){
 if(!face)return null;
 const wave={kind:'charge',x:e.x+face.x*.55,y:1.9,z:e.z+face.z*.55,dx:face.x,dz:face.z,rx:1.4,ry:1.9,rz:1.15},releaseBounds=waveCandidateBounds(wave,wave,wave.x,wave.z),bodies=[];
 let first=null;
 for(const b of [...g.enemies,...(g.player?[g.player]:[])]){
  const hero=b===g.player,id=hero?g.playerId:b.id;if(id===e.id||!(hero?g.hp>0:b.alive))continue;
  const body={x:b.x,y:b.y||0,z:b.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS},team=hero?'ally':b.team||'enemy';bodies.push({b,id,body,team});
  if(!withinWaveCandidateBounds(b,releaseBounds)||!waveHitsBody(wave,body))continue;
  const along=(b.x-wave.x)*face.x+(b.z-wave.z)*face.z;
  if(!first||along<first.along||along===first.along&&id<first.id)first={id,team,t:0,along,x:b.x,z:b.z};
 }
 // No positive-time contact can precede an overlap at release.
 if(first)return first;
 const reach=terrainGroundDistance(g,e,face.x,face.z,npcChargeTravel(g,e,face)),end={x:e.x,z:e.z},owner=g.enemies.find(b=>b.id===e.id)||e;
 clipRush(g,end,e.x+face.x*reach,e.z+face.z*reach,owner);
 if(Math.hypot(end.x-e.x,end.z-e.z)<1e-12)return null;
 const last={...wave,x:end.x+face.x*.55,z:end.z+face.z*.55},bounds=waveCandidateBounds(wave,last,wave.x,wave.z);
 for(const {b,id,body,team} of bodies){
  if(!withinWaveCandidateBounds(b,bounds))continue;const t=chargeWaveContact(wave,last,body,1);if(t===null)continue;
  const along=(b.x-last.x)*face.x+(b.z-last.z)*face.z;
  if(!first||t<first.t||t===first.t&&(along<first.along||along===first.along&&id<first.id))first={id,team,t,along,x:b.x,z:b.z};
 }
 return first;
}
// Only recover a missing coarse facing at existing release contact. The usual
// facing always wins, and committed warnings never use this decision helper.
function npcChargeContactFacing(g,e,target){
 const normal=npcAttackFacing(e,target);
 if(normal||g.npcSensing!==true||target.tacticalMarch||target!==g.player&&target.id==null||!npcHasAbility(g,e,'charge'))return normal;
 const distance=Math.hypot(target.x-e.x,target.z-e.z);
 // Conservative release envelope: source offset + largest ellipse axis + body.
 if(distance===0||distance>.55+1.4+ENEMY_RADIUS)return null;
 const dirs=e.piece==='dragon'?C:e.piece==='horse'?D:PIECES[e.piece]?.dirs||[],sign=e.team==='ally'?1:-1,id=target===g.player?g.playerId:target.id;
 let best=null,bestDot=-Infinity;
 for(const [x,z] of dirs){const n=Math.hypot(x,z),face={x:x/n*sign,z:z/n*sign},dot=(target.x-e.x)*face.x+(target.z-e.z)*face.z;
  if(dot<=bestDot||npcAttackKind(e,face,distance,g)!=='charge'||!npcActionWithinPost(g,e,'charge',face,distance))continue;
  const first=npcChargeFirstContact(g,e,face);if(!first||first.id!==id||first.t!==0)continue;
  best=face;bestDot=dot;
 }
 return best;
}

const npcAttackLaneRoutes=new WeakMap(),npcAttackLaneSearches=new WeakMap();
function npcAttackLanePost(g,e){
 const post=npcPost(g,e);
 // A defensive shooter can change lanes locally, never pursue an enemy.
 // The ordinary pursuit post remains unchanged. Royal assignments win.
 return g.strategies?.[e.team||'enemy']==='defensive'?{...post,radius:Math.min(FILE_SPACING,npcPost(g,e,'retreat').radius)}:post;
}
function npcAttackLaneReservedClear(e,points,reservations){
 if(!reservations)return true;
 const close=(a,b,c,d)=>{
  const ux=b.x-a.x,uz=b.z-a.z,vx=d.x-c.x,vz=d.z-c.z,det=ux*vz-uz*vx;
  if(Math.abs(det)>1e-12){const x=c.x-a.x,z=c.z-a.z,t=(x*vz-z*vx)/det,u=(x*uz-z*ux)/det;if(t>=0&&t<=1&&u>=0&&u<=1)return true;}
  return Math.min(distanceSegment(a.x,a.z,c.x,c.z,d.x,d.z),distanceSegment(b.x,b.z,c.x,c.z,d.x,d.z),distanceSegment(c.x,c.z,a.x,a.z,b.x,b.z),distanceSegment(d.x,d.z,a.x,a.z,b.x,b.z))<1.4-1e-7;
 };
 for(const [other,route] of reservations){if(other===e)continue;let from=e;for(const point of points){let start=other;for(const end of route.points){if(close(from,point,start,end))return false;start=end;}from=point;}}
 return true;
}
// World-coordinate subtraction and accumulated ground steps can leave a few
// ULPs off a stored corner. Accept only that arithmetic uncertainty here;
// actual movement still uses npcRoute and moveNPC's unchanged legal axes.
function npcAttackLaneLegalLeg(from,to,dirs,team){
 if(Terrain.legalLeg(from,to,dirs,team))return true;
 const x=to.x-from.x,z=to.z-from.z,sign=team==='ally'?1:-1,error=64*Number.EPSILON*Math.max(1,Math.abs(from.x),Math.abs(from.z),Math.abs(to.x),Math.abs(to.z));
 return dirs.some(([dx,dz])=>{const n=Math.hypot(dx,dz);return (x*dx+z*dz)*sign>0&&Math.abs(x*dz-z*dx)/n<=error;});
}
function npcAttackLanePathClear(g,e,points,reservations=null){
 if(!npcAttackLaneReservedClear(e,points,reservations))return false;
 const post=npcAttackLanePost(g,e),dirs=e.piece==='dragon'?C:e.piece==='horse'?D:PIECES[e.piece]?.dirs||[];
 let from=e;
 for(const point of points){
  if(!arenaContains(g,point)||Math.hypot(point.x-post.x,point.z-post.z)>post.radius+1e-7||!npcAttackLaneLegalLeg(from,point,dirs,e.team||'enemy')||!terrainPath(g,from,point))return false;
  const p=g.player,dx=point.x-from.x,dz=point.z-from.z;
  if(p&&(p.y||0)<=1.5&&distanceSegment(p.x,p.z,from.x,from.z,point.x,point.z)<=1.6&&!((from.x-p.x)*dx+(from.z-p.z)*dz>=0&&Math.hypot(from.x-p.x,from.z-p.z)<1.6))return false;
  const probe={x:from.x,z:from.z};clipRush(g,probe,point.x,point.z,e,true,1.4);if(Math.hypot(probe.x-point.x,probe.z-point.z)>1e-7)return false;
  from=point;
 }
 return true;
}
function npcAttackLaneGoalContact(g,e,target,point){
 const stance={...e,x:point.x,z:point.z},face=npcChargeContactFacing(g,stance,target),distance=Math.hypot(target.x-point.x,target.z-point.z),kind=npcAttackKind(stance,face,distance,g);
 if(!face||kind!=='charge'||distance>=DIFFICULTIES[g.difficulty||'normal'].engage||!npcActionWithinPost(g,stance,kind,face,distance)||!npcActionMayReach(g,stance,target,face,kind))return false;
 return npcChargeFirstContact(g,stance,face)?.id===(target===g.player?g.playerId:target.id);
}
function npcAttackLaneRoute(g,e,target,reservations=null){
 const discard=()=>{npcAttackLaneRoutes.delete(e);npcAttackLaneSearches.delete(e);return null;};
 if(g.npcSensing!==true||!g.strategies||!sensingEligible(g,e)||!g.active||battleEnded(g)||e.attack!=='idle'||e.stagger>0||e.spawnProtection>0||Math.abs(e.y||0)>.001||!target||target.tacticalMarch||!npcHasAbility(g,e,'charge'))return discard();
 const post=npcAttackLanePost(g,e);if(!(post.radius>0))return discard();
 const key=[e.team,e.piece,e.homeX,e.homeZ,post.x,post.z,post.radius,g.playerId,target===g.player?'hero':target.id,g.strategies[e.team||'enemy'],g.teamTactics?.[e.team||'enemy']?.focus].join(':'),old=npcAttackLaneRoutes.get(e);
 const face=npcChargeContactFacing(g,e,target),distance=Math.hypot(target.x-e.x,target.z-e.z),kind=npcAttackKind(e,face,distance,g);
 if(!old&&(!face||kind!=='charge'||distance>=DIFFICULTIES[g.difficulty||'normal'].engage||!npcActionWithinPost(g,e,kind,face,distance)||!npcActionMayReach(g,e,target,face,kind)))return discard();
 const first=face&&kind==='charge'?npcChargeFirstContact(g,e,face):null;
 if(first?.id===(target===g.player?g.playerId:target.id))return discard();
 if(old){
  if(npcChargeFirstContact(g,{...e,x:old.startX,z:old.startZ},old.startFace)?.id===(target===g.player?g.playerId:target.id))return discard();
  while(old.points.length&&Math.hypot(old.points[0].x-e.x,old.points[0].z-e.z)<1e-7)old.points.shift();
  if(old.key===key&&old.until>g.time&&Math.hypot(target.x-old.targetX,target.z-old.targetZ)<=.5&&old.points.length&&npcAttackLanePathClear(g,e,old.points,reservations)&&npcAttackLaneGoalContact(g,e,target,old.points[old.points.length-1]))return old;
  discard();
 }
 if(!face||kind!=='charge'||distance>=DIFFICULTIES[g.difficulty||'normal'].engage||!npcActionWithinPost(g,e,kind,face,distance)||!npcActionMayReach(g,e,target,face,kind)||first?.team!==(e.team||'enemy'))return null;
 // A failed geometric search is bounded to four retries per second while
 // its local problem is stationary; movement or a role/target change retries now.
 const failed=npcAttackLaneSearches.get(e);if(failed&&failed.key===key&&failed.friendId===first.id&&failed.until>g.time&&Math.hypot(e.x-failed.x,e.z-failed.z)<=.1&&Math.hypot(target.x-failed.targetX,target.z-failed.targetZ)<=.1&&Math.hypot(first.x-failed.friendX,first.z-failed.friendZ)<=.1)return null;
 const dirs=e.piece==='dragon'?C:e.piece==='horse'?D:PIECES[e.piece]?.dirs||[],sign=e.team==='ally'?1:-1,candidates=[];
 // One legal local leg, then a small set of two-leg attack stances.
 for(const d of [.4,.8,1.2,1.6,2,2.4,2.8,3.2])for(const [x,z] of dirs){const n=Math.hypot(x,z);candidates.push({x:e.x+x/n*sign*d,z:e.z+z/n*sign*d});}
 for(const [x,z] of dirs){const n=Math.hypot(x,z),dx=x/n*sign,dz=z/n*sign;for(const d of [2.4,3.2])for(const side of [0,-.8,.8])candidates.push({x:target.x-dx*d-dz*side,z:target.z-dz*d+dx*side});}
 let best=null,bestLength=Infinity;
 for(const goal of candidates){
  const orders=[dirs,[...dirs].reverse()];
  for(const order of orders){const firstLeg=nextLegalSegment(order,e.team||'enemy',goal.x-e.x,goal.z-e.z);if(!firstLeg||firstLeg.distance>3.2+1e-7)continue;
   const corner={x:e.x+firstLeg.x*firstLeg.distance,z:e.z+firstLeg.z*firstLeg.distance},lastLength=Math.hypot(goal.x-corner.x,goal.z-corner.z),length=firstLeg.distance+lastLength;
   if(lastLength>3.2+1e-7||length>=bestLength-1e-7)continue;
   const points=lastLength>1e-7?[corner,goal]:[goal];if(!npcAttackLanePathClear(g,e,points,reservations)||!npcAttackLaneGoalContact(g,e,target,goal))continue;
   best=points;bestLength=length;
  }
 }
 if(!best){npcAttackLaneSearches.set(e,{key,friendId:first.id,x:e.x,z:e.z,targetX:target.x,targetZ:target.z,friendX:first.x,friendZ:first.z,until:g.time+.25});return null;}
 npcAttackLaneSearches.delete(e);
 let from=e,duration=0;for(const point of best){duration+=terrainOn(g)?Terrain.motion(from,point,movementSpeed(g,e.team||'enemy',true)).moveDt:Math.hypot(point.x-from.x,point.z-from.z)/movementSpeed(g,e.team||'enemy',true);from=point;}
 const route={key,points:best,startX:e.x,startZ:e.z,startFace:face,targetX:target.x,targetZ:target.z,until:g.time+duration+.25};npcAttackLaneRoutes.set(e,route);return route;
}
function npcMoveAttackLane(g,e,target,route,dt,slashMotions,reservations){
 if(!route||npcAttackLaneRoute(g,e,target,reservations)!==route)return false;
 friendlyRouteLegs.delete(e);e.attackReadySince=null;e.intent='attack_lane';const goal=route.points[0];
 if(!moveNPC(g,e,goal.x,goal.z,dt,slashMotions))npcAttackLaneRoutes.delete(e);
 return true;
}

function npcPrepareAttackRetreats(g,dt,slashMotions){
 const checked=new Set(),moved=new Set();
 for(const e of g.enemies){
  const team=e.team||'enemy';
  if(KingPersonality.ownsMovement(g,e)||!e.alive||e.trainingGuard||e.stagger>0||e.spawnProtection>0||!g.active||battleEnded(g)||e.attack!=='idle'||e.attackCooldown>dt||e.reinforceTarget!=null||g.strategies[team]==='aggressive'||e.piece==='king'||!(e.maxHp>1)||e.hp!==1)continue;
  const target=npcTarget(g,e);if(!target||target.tacticalMarch)continue;
  checked.add(e);
  if(Math.hypot(target.x-e.x,target.z-e.z)>=5)continue;
  const retreat=npcRetreatTarget(g,e,target,dt);
  if(!retreat||!moveNPC(g,e,retreat.x,retreat.z,dt,slashMotions))continue;
  e.attackReadySince=null;e.targetX=target.x;e.targetZ=target.z;
  if(npcAttackFacing(e,target))e.approachDir=null;
  friendlyRouteLegs.delete(e);e.intent='withdraw';moved.add(e);
 }
 return {checked,moved};
}
// Reserve windup starts from one faction-symmetric post-withdrawal snapshot.
function npcAttackAdmissions(g,dt,slashMotions){
 const retreats=npcPrepareAttackRetreats(g,dt,slashMotions),lanes=new Map(),laneTargets=new Map();
 const laneActors=g.enemies.filter(e=>!retreats.moved.has(e)&&e.alive&&!e.trainingGuard&&!(e.stagger>0)&&!(e.spawnProtection>0)&&g.active&&!battleEnded(g)&&e.attack==='idle'&&e.attackCooldown<=dt&&e.reinforceTarget==null&&npcHasAbility(g,e,'charge')).sort((a,b)=>a.id-b.id);
 for(const e of laneActors){const target=npcTarget(g,e);laneTargets.set(e,target);const lane=npcAttackLaneRoute(g,e,target,lanes);if(lane)lanes.set(e,lane);}
 const candidates={ally:[],enemy:[]},grants=new Set(),order={ally:[],enemy:[]};g.npcAttackCursor||={ally:0,enemy:0};
 for(const e of g.enemies){
  if(retreats.moved.has(e)||!e.alive||e.trainingGuard||e.stagger>0||e.spawnProtection>0||!g.active||battleEnded(g)||e.attack!=='idle'||e.attackCooldown>dt||e.reinforceTarget!=null){npcAttackLaneRoutes.delete(e);e.attackReadySince=null;continue;}
  const target=laneTargets.has(e)?laneTargets.get(e):npcTarget(g,e);if(!target){npcAttackLaneRoutes.delete(e);e.attackReadySince=null;continue;}
  if(lanes.has(e)){e.attackReadySince=null;continue;}
  const team=e.team||'enemy',dx=target.x-e.x,dz=target.z-e.z,len=Math.hypot(dx,dz),face=npcChargeContactFacing(g,e,target),kind=npcAttackKind(e,face,len,g),limit=npcPursuitLimit(g,e),combat=!target.tacticalMarch&&face&&len<DIFFICULTIES[g.difficulty||'normal'].engage&&npcActionMayReach(g,e,target,face,kind);
  if(!face||!combat&&!(e.piece==='knight'&&limit>0&&(target.tacticalMarch?dz*(team==='ally'?-1:1)>=6-1e-7:dz*(team==='ally'?-1:1)>6))||!npcActionWithinPost(g,e,kind,face,len)){e.attackReadySince=null;continue;}
  e.attackReadySince??=g.time;let threat=0;
  for(const a of g.enemies){if(!a.alive||a.team===team||a.attack!=='windup')continue;if(npcActionMayReach(g,a,e,{x:a.aimDx,z:a.aimDz},a.actionKind))threat=1;}
  candidates[team].push({e,combat,priority:g.time-e.attackReadySince+threat*.3+(combat?.6:0),tie:(e.slotKey-g.npcAttackCursor[team]+20)%20});
 }
 for(const team of ['ally','enemy']){
  const active=g.enemies.filter(e=>e.alive&&e.team===team&&e.attack==='windup'&&(e.stagger>0||e.spawnProtection>0||e.attackTimer>dt)).length;
  const queue=candidates[team];queue.sort((a,b)=>b.priority-a.priority||a.tie-b.tie||a.e.id-b.e.id);
  for(const c of queue.slice(0,Math.max(0,DIFFICULTIES[g.difficulty||'normal'].attackers-active))){grants.add(c.e);order[team].push(c.e);}
 }
 return {grants,order,retreats,lanes};
}
function step(g,dt,input={x:0,z:0}){
 dt=clamp(Number.isFinite(dt)?dt:0,0,.05);g.events=[];if(g.kingPlan&&g.active&&!battleEnded(g))g.kingPlan.elapsed+=dt;g.moveBlocked=false;g.time+=dt;g.invulnerable=Math.max(0,g.invulnerable-dt);g.damageFlash=Math.max(0,g.damageFlash-dt);g.guardFlash=Math.max(0,(g.guardFlash||0)-dt);const p=g.player,d=direction(g,input.x,input.z);if(p)p.spawnProtection=Math.max(0,(p.spawnProtection||0)-dt);for(const e of g.enemies){e.invulnerable=Math.max(0,(e.invulnerable||0)-dt);e.spawnProtection=Math.max(0,(e.spawnProtection||0)-dt);if(e.heroCooldowns)for(const key of Object.keys(e.heroCooldowns))e.heroCooldowns[key]=Math.max(0,e.heroCooldowns[key]-dt);}g.cooldown=Math.max(0,g.cooldown-dt);g.sweepCooldown=Math.max(0,g.sweepCooldown-dt);g.stepCooldown=Math.max(0,g.stepCooldown-dt);g.jumpCooldown=Math.max(0,g.jumpCooldown-dt);
 // Direction changes are read before hitstop: turning out of a rush is immediate.
 if(!battleEnded(g)&&(d.x||d.z)&&g.mode!=='dragon'&&g.mode!=='jump')aim(g,d.x,d.z);
 if(g.hitstop>0){if(g.devEscortBrace===true)for(const e of g.enemies)if(e.escortBrace){for(const k of ['activeAt','recoverAt','end'])e.escortBrace[k]+=dt;e.escortBraceReadyAt+=dt;}g.hitstop=Math.max(0,g.hitstop-dt);KingPersonality.suspendFrame(g,'hitstop',dt);updateBattleScenario(g);return g;}
 if(dt>0){observeAwakeningEntries(g);applyAutomaticAwakening(g);}
 const heldFrame=thrustFrame(g);
 let heroMotion=null,finishMotion=false;
 if(p){
 const slashPlayerStart={x:p.x,y:p.y||0,z:p.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS};let slashPlayerMoveDt=0,slashPlayerDelay=0,slashPlayerSpeed=0,slashPlayerKnown=g.mode!=='jump'&&Math.abs(p.y||0)<1e-9;
 let motionDt=dt;
 if(g.mode==='windup'){motionDt=Math.max(0,dt-g.phase);g.phase-=dt;if(g.phase<=0){g.mode='charge';g.phase=.38;spawnWave(g,'player','charge',p.x,(p.y||0)+1.9,p.z,p.dx,p.dz,{follow:true});}}
 if(g.mode==='charge'||g.mode==='dragon'){
  const ax=p.x,az=p.z,dragon=g.mode==='dragon',travelDt=Math.min(motionDt,g.phase);g.phase=Math.max(0,g.phase-travelDt);
  if(dragon){if(terrainOn(g)){const vx=g.stepEnd.x-g.stepStart.x,vz=g.stepEnd.z-g.stepStart.z,length=Math.hypot(vx,vz),dx=length?vx/length:0,dz=length?vz/length:0,travel=terrainGroundDistance(g,p,dx,dz,length/.18*travelDt,Math.hypot(g.stepEnd.x-p.x,g.stepEnd.z-p.z));p.x+=dx*travel;p.z+=dz*travel;}else{const t=1-g.phase/.18;p.x=g.stepStart.x+(g.stepEnd.x-g.stepStart.x)*t;p.z=g.stepStart.z+(g.stepEnd.z-g.stepStart.z)*t;}}else{const wanted=terrainGroundDistance(g,p,p.dx,p.dz,CHARGE_SPEED*travelDt),travel=arenaTravel(p.x,p.z,p.dx,p.dz,wanted,g);p.x+=p.dx*travel;p.z+=p.dz*travel;if(travel<wanted-1e-9)finishMotion=true;}
  
  const tx=p.x,tz=p.z;p.x=ax;p.z=az;if(clipRush(g,p,tx,tz)){finishMotion=true;g.cooldown=.4;}const slashMotionSpeed=dragon?Math.hypot(g.stepEnd.x-g.stepStart.x,g.stepEnd.z-g.stepStart.z)/.18:CHARGE_SPEED;slashPlayerMoveDt=slashMotionSpeed>1e-12?Math.hypot(p.x-ax,p.z-az)/slashMotionSpeed:0;slashPlayerDelay=dt-motionDt;slashPlayerSpeed=slashMotionSpeed;
  if(g.phase<=0||(travelDt>1e-9&&ax===p.x&&az===p.z)){finishMotion=true;if(!dragon)g.cooldown=.2;g.events.push({type:dragon?'endstep':'endcharge'});}
 }else if(!battleEnded(g)){
  if(!g.guarding&&g.mode!=='jump'&&(d.x||d.z)){g.active=true;const moveSpeed=Number.isFinite(input.moveSpeed)?clamp(input.moveSpeed,.5,movementSpeed(g,'ally',true)):movementSpeed(g,'ally',true);slashPlayerSpeed=moveSpeed;const distance=terrainGroundDistance(g,p,d.x,d.z,moveSpeed*dt,Number.isFinite(input.maxDistance)?Math.max(0,input.maxDistance):Infinity);const slashGoalX=g.arena?p.x+d.x*distance:clamp(p.x+d.x*distance,arenaBounds(g).minX,arenaBounds(g).maxX),slashGoalZ=g.arena?p.z+d.z*distance:clamp(p.z+d.z*distance,arenaBounds(g).minZ,arenaBounds(g).maxZ),slashGoalDistance=Math.hypot(slashGoalX-p.x,slashGoalZ-p.z);if(Math.abs(slashGoalX-p.x-d.x*distance)>1e-9||Math.abs(slashGoalZ-p.z-d.z*distance)>1e-9)slashPlayerKnown=false;g.moveBlocked=clipRush(g,p,slashGoalX,slashGoalZ,null,true);slashPlayerMoveDt=slashGoalDistance>1e-12?distance/moveSpeed*Math.hypot(p.x-slashPlayerStart.x,p.z-slashPlayerStart.z)/slashGoalDistance:0;}
  if(g.mode==='thrust'){const timing=thrustTiming(g),duration=timing?.duration??.4,release=timing?.release??.16,previousElapsed=duration-g.phase;g.phase=Math.max(0,g.phase-dt);const elapsed=duration-g.phase,face=g.sweepDirection;if(elapsed>=release&&!g.waveLaunched){g.waveLaunched=true;spawnWave(g,'player','thrust',p.x,(p.y||0)+1.9,p.z,face.dx,face.dz,{releaseDelay:Math.max(0,release-previousElapsed)});}if(g.phase<=0){g.mode='ready';if(g.thrustAction)delete g.thrustAction;}}
  if(g.mode==='jump'){g.phase=Math.max(0,g.phase-dt);const elapsed=JUMP_DURATION-g.phase,t=clamp((elapsed-.14)/.62,0,1);const u=clamp((t-.18)/.64,0,1),travel=u*u*(3-2*u);p.x=g.jumpStart.x+(g.jumpEnd.x-g.jumpStart.x)*travel;p.z=g.jumpStart.z+(g.jumpEnd.z-g.jumpStart.z)*travel;p.y=JUMP_HEIGHT*Math.sin(Math.PI*t);if(g.phase<=.10&&!g.jumpLanded){g.jumpLanded=true;g.events.push({type:'land',x:p.x,z:p.z});spawnWave(g,'player','burst',p.x,.65,p.z,p.dx,p.dz);g.firstHit=false;}if(g.phase<=0){p.y=0;g.mode='ready';if(g.jumpIsKnight){p.dx=0;p.dz=-1;}}}

  if(g.mode==='sweep'){g.phase=Math.max(0,g.phase-dt);const elapsed=SWEEP_DURATION-g.phase,face=g.sweepDirection;if(elapsed>=SWEEP_HIT_START&&!g.waveLaunched){g.waveLaunched=true;spawnWave(g,'player','slash',p.x,(p.y||0)+1.9,p.z,face.dx,face.dz);}if(g.phase<=0)g.mode='ready';}
 }
 heroMotion=slashPlayerKnown&&g.mode!=='jump'&&Math.abs(p.y||0)<1e-9?(terrainOn(g)&&slashPlayerSpeed?Terrain.motion(slashPlayerStart,{...slashPlayerStart,x:p.x,z:p.z},slashPlayerSpeed,slashPlayerDelay):{start:slashPlayerStart,end:{...slashPlayerStart,x:p.x,z:p.z},moveDt:slashPlayerMoveDt,delay:slashPlayerDelay}):null;
 }
 if(dt>0)observeAwakeningEntries(g);
 const slashDeathMotion=new Map(),slashFrames=[],slashMotions=new Map(),beforeScore=g.score,slashHazards=ordinarySlashHazards(g,dt);
 if(g.active&&!battleEnded(g)&&!g.promotionPulse&&g.waves.some(w=>w.kind==='slash'&&w.orientation==='horizontal'&&!w.follow&&w.age<w.life))for(const e of g.enemies)if(e.alive&&!e.trainingGuard&&Math.abs(e.y||0)<1e-9&&e.attack==='idle'&&!(e.stagger>0)&&!(e.spawnProtection>0))slashMotions.set(e,{team:e.team,defer:!slashHazards.terminal&&!slashHazards.waves.some(({wave,bounds})=>wave.sourceId!==e.id&&((e.team||'enemy')===(wave.team==='player'?'enemy':'ally')||wave.kind==='charge')&&withinWaveCandidateBounds(e,bounds)),start:{x:e.x,y:0,z:e.z,height:ENEMY_HEIGHT,radius:ENEMY_RADIUS}});
 updateWaves(g,dt,heroMotion,slashDeathMotion,slashFrames,slashMotions);if(g.chargeContact){finishMotion=true;g.chargeContact=false;}if(finishMotion){if(g.mode==='charge'){g.cooldown=Math.max(g.cooldown,.4);g.phase=0;}if(g.mode==='dragon'&&pieceKey(g)==='dragon'){const face=cardinal(p.dx,p.dz);p.dx=face.x;p.dz=face.z;}g.mode='ready';for(const w of g.waves)if(w.follow&&w.ownerId==null)w.age=w.life;}if(g.score-beforeScore>=3)g.hitstop=Math.max(g.hitstop,.065);
 updatePromotion(g,dt);
 updateShoves(g,dt);
 if(dt>0)observeAwakeningEntries(g);
 KingPersonality.updateDefense(g);
 if(g.kingPersonalities)for(const e of g.enemies)if(e.reinforceTarget!=null&&(npcCastleDuty(g,e)||KingPersonality.mobileEscort(g,e)||npcRoyalFollower(g,e))){if(!g.vacancies.includes(e.reinforceTarget))g.vacancies.push(e.reinforceTarget);e.reinforceTarget=null;}
 assignReinforcements(g,dt);
 KingPersonality.prepareMovement(g,dt);
 npcSensingFrame(g,true);
 const preparing={enemy:g.enemies.filter(e=>e.alive&&e.team==='enemy'&&e.attack==='windup').length,ally:g.enemies.filter(e=>e.alive&&e.team==='ally'&&e.attack==='windup').length};const attackAdmissions=g.strategies?npcAttackAdmissions(g,dt,slashMotions):null;
 for(const e of g.enemies){if(!e.alive){const corpseDt=slashDeathMotion.get(e)??dt;e.age+=corpseDt;if(!battleEnded(g)&&e.pendingTeam&&g.time>=e.respawnAt){respawnNPC(g,e);if(e.alive)continue;}if(e.age<2.4){e.x+=e.vx*corpseDt;e.z+=e.vz*corpseDt;e.y+=e.vy*corpseDt;e.vy-=18*corpseDt;e.angle+=e.spin*corpseDt;if(e.y<0){e.y=0;if(e.vy<-2)e.vy=-e.vy*.2;else e.vy=0;e.vx*=Math.exp(-corpseDt*5);e.vz*=Math.exp(-corpseDt*5);e.spin*=Math.exp(-corpseDt*4);}}continue;}
  e.hurtFlash=Math.max(0,(e.hurtFlash||0)-dt);if(e.trainingGuard)continue;if(e.stagger>0||e.spawnProtection>0||!g.active||battleEnded(g))continue;
  // A visible committed landing is an area attack: an escort cannot absorb
  // it. An idle autonomous marching king may take an ordinary legal escape;
  // committed attacks/recovery/stagger above are never cancelled.
  if(g.devEscortBrace===true&&escortBraceTick(g,e))continue;
  if(e.piece==='king'){const escape=KingPersonality.kingLandingAvoidance(g,e);if(escape){e.attackCooldown=Math.max(0,e.attackCooldown-dt);e.intent='avoid_landing';e.targetX=escape.x;e.targetZ=escape.z;moveNPC(g,e,escape.x,escape.z,dt,slashMotions);continue;}}
  if(attackAdmissions?.retreats.moved.has(e)){e.attackCooldown=Math.max(0,e.attackCooldown-dt);continue;}
  if(e.reinforceTarget!=null){friendlyRouteLegs.delete(e);const slot=g.formationSlots.find(s=>s.id===e.reinforceTarget),threat=g.strategies?npcTarget(g,e):null,interrupted=threat&&Math.hypot(threat.x-e.x,threat.z-e.z)<DIFFICULTIES[g.difficulty||'normal'].engage&&!!enemyDirection(e,threat.x-e.x,threat.z-e.z);if(!slot||g.enemies.some(b=>b!==e&&b.alive&&Math.hypot(b.x-slot.x,b.z-slot.z)<.8)){e.reinforceTarget=null;}else if(interrupted){if(!g.vacancies.includes(slot.id))g.vacancies.push(slot.id);e.reinforceTarget=null;}else if(Math.hypot(slot.x-e.x,slot.z-e.z)<=1e-7){e.reinforceTarget=null;}else if(!npcRoute(e,slot.x,slot.z,g)){if(!g.vacancies.includes(slot.id))g.vacancies.push(slot.id);e.reinforceTarget=null;}else{e.targetX=slot.x;e.targetZ=slot.z;e.intent='refill';moveNPC(g,e,slot.x,slot.z,dt,slashMotions);if(Math.hypot(slot.x-e.x,slot.z-e.z)<=1e-7)e.reinforceTarget=null;continue;}}
  const team=e.team||'enemy';let target;if(g.strategies||tacticEnabled(g,team))target=npcTarget(g,e);else{let distance=Infinity;for(const b of g.enemies){if(!b.alive||(b.team||'enemy')===team)continue;const q=Math.hypot(b.x-e.x,b.z-e.z);if(!target||q<distance){target=b;distance=q;}}if(p&&team==='enemy'&&Math.hypot(p.x-e.x,p.z-e.z)<distance)target=p;}
  target||={x:e.x,z:e.z};const dx=target.x-e.x,dz=target.z-e.z,len=Math.hypot(dx,dz),forward=team==='ally'?-1:1,knight=e.piece==='knight',attackFace=npcChargeContactFacing(g,e,target);e.targetX=target.x;e.targetZ=target.z;if(attackFace)e.approachDir=null;const kind=npcAttackKind(e,attackFace,len,g),limit=npcPursuitLimit(g,e),actionReach=!target.tacticalMarch&&!!attackFace&&e.attack==='idle'&&len<DIFFICULTIES[g.difficulty||'normal'].engage&&npcActionMayReach(g,e,target,attackFace,kind);e.intent=e.attack==='idle'?'hold':e.attack;KingPersonality.noteCombat(g,e,{targetId:target.id??g.playerId,actionReach,attackGranted:!!(attackAdmissions?attackAdmissions.grants.has(e):preparing[team]<DIFFICULTIES[g.difficulty||'normal'].attackers),cooldown:e.attackCooldown,dt});
  e.attackCooldown=Math.max(0,e.attackCooldown-dt);
  if(e.attack==='charge'){if(e.stopAfterContact||e.chargeContact){e.attack='recover';e.attackTimer=.45;e.attackCooldown=npcEquipmentReload(g,e,DIFFICULTIES[g.difficulty||'normal'].reload);e.stopAfterContact=false;for(const w of g.waves)if(w.ownerId===e.id&&w.follow)w.age=w.life;}else{const travelDt=Math.min(dt,e.attackTimer);e.attackTimer=Math.max(0,e.attackTimer-dt);const wanted=terrainGroundDistance(g,e,e.aimDx,e.aimDz,CHARGE_SPEED*travelDt),distance=Math.min(wanted,npcChargeTravel(g,e,{x:e.aimDx,z:e.aimDz}));e.stopAfterContact=clipRush(g,e,e.x+e.aimDx*distance,e.z+e.aimDz*distance,e)||e.attackTimer<=0||distance<wanted-1e-9;}}
  else if(e.attack==='leap'){e.attackTimer=Math.max(0,e.attackTimer-dt);const t=1-e.attackTimer/.75,u=clamp((t-.18)/.64,0,1),travel=u*u*(3-2*u);e.x=e.leapStart.x+(e.leapEnd.x-e.leapStart.x)*travel;e.z=e.leapStart.z+(e.leapEnd.z-e.leapStart.z)*travel;e.y=JUMP_HEIGHT*Math.sin(Math.PI*t);if(e.attackTimer<=0){e.y=0;spawnWave(g,team==='ally'?'player':'enemy','burst',e.x,.65,e.z,0,forward,{ownerId:e.id});e.attack='recover';e.attackTimer=.35;e.attackCooldown=npcEquipmentReload(g,e,2.2);}}
  else if(e.attack==='windup'){if(g.capabilityLoadout&&!npcHasAbility(g,e,e.actionKind,{x:e.aimDx,z:e.aimDz})){e.attack='recover';e.attackTimer=.35;e.attackCooldown=Math.max(e.attackCooldown,.35);preparing[team]--;continue;}const releaseDelay=Math.max(0,e.attackTimer);e.attackTimer-=dt;if(e.attackTimer<=0){if(knight){if(!terrainJump(g,e,{x:clamp(e.x+Math.sign(e.aimDx)*3,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(e.z+forward*6,arenaBounds(g).minZ,arenaBounds(g).maxZ)},team)){e.attack='recover';e.attackTimer=.35;e.attackCooldown=1;preparing[team]--;continue;}e.attack='leap';e.attackTimer=.75;e.leapStart={x:e.x,z:e.z};e.leapEnd={x:clamp(e.x+Math.sign(e.aimDx)*3,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(e.z+forward*6,arenaBounds(g).minZ,arenaBounds(g).maxZ)};}else if(e.actionKind==='charge'){e.attack='charge';e.attackTimer=npcChargeTravel(g,e,{x:e.aimDx,z:e.aimDz})/CHARGE_SPEED;e.chargeContact=false;e.stopAfterContact=false;spawnWave(g,team==='ally'?'player':'enemy','charge',e.x,1.9,e.z,e.aimDx,e.aimDz,{ownerId:e.id,follow:true});}else{spawnWave(g,team==='ally'?'player':'enemy',e.actionKind==='sweep'?'slash':'thrust',e.x,(e.y||0)+ENEMY_HEIGHT/2,e.z,e.aimDx,e.aimDz,{ownerId:e.id,releaseDelay:e.actionKind==='thrust'?releaseDelay:0});e.attack='recover';e.attackTimer=.35-(e.actionKind==='thrust'?Math.max(0,dt-releaseDelay):0);e.attackCooldown=npcOrdinaryReload(g,e);}preparing[team]--;}}
  else if(e.attack==='recover'){e.attackTimer-=dt;if(e.attackTimer<=0)e.attack='idle';}
  else if(!KingPersonality.ownsMovement(g,e)&&!KingPersonality.movementSpent(g,e)&&!target.tacticalMarch&&!attackAdmissions?.retreats.checked.has(e)&&g.strategies&&g.strategies[team]!=='aggressive'&&e.piece!=='king'&&e.maxHp>1&&e.hp===1&&len<5&&npcRetreatTarget(g,e,target,dt)&&(()=>{const retreat=npcRetreatTarget(g,e,target,dt);return moveNPC(g,e,retreat.x,retreat.z,dt,slashMotions);})()){e.attackReadySince=null;friendlyRouteLegs.delete(e);e.intent='withdraw';}
  else if((()=>{if(actionReach&&e.attackCooldown<=0&&(attackAdmissions?attackAdmissions.grants.has(e):preparing[team]<DIFFICULTIES[g.difficulty||'normal'].attackers)){KingPersonality.suspendMovement(g,e,'admitted-attack');return false;}if(KingPersonality.movementSuspended(g,e))return true;if(npcCastleDuty(g,e))return false;const goal=KingPersonality.defenseTarget(g,e);if(goal.status==='NO_DUTY')return false;friendlyRouteLegs.delete(e);e.intent=goal.intent;if(!goal.hold){e.targetX=goal.x;e.targetZ=goal.z;moveNPC(g,e,goal.x,goal.z,dt,slashMotions);}return true;})()){}
  else if(npcMoveAttackLane(g,e,target,attackAdmissions?.lanes.get(e),dt,slashMotions,attackAdmissions?.lanes)){}
  // Explicit thrust-practice targets never initiate attacks; ordinary recovery, hit and shove rules still apply.
  else if(g.scenario!=='switch_trial'&&!(g.scenario==='thrust_trial'&&e.trainingTarget===true)&&attackFace&&(len<DIFFICULTIES[g.difficulty||'normal'].engage&&actionReach||(knight&&limit>0&&(target.tacticalMarch?dz*forward>=6-1e-7:dz*forward>6)))&&e.attackCooldown<=0&&(attackAdmissions?attackAdmissions.grants.has(e):preparing[team]<DIFFICULTIES[g.difficulty||'normal'].attackers)&&npcActionWithinPost(g,e,kind,attackFace,len)){e.attackReadySince=null;if(g.npcSensing===true){friendlyRouteLegs.delete(e);e.actionPost=kind==='charge'?{...npcPost(g,e,'action')}:null;npcCastleCommitPost(g,e,e.actionPost);}e.actionKind=kind;e.npcCooldownUsed=true;e.attack='windup';e.attackTimer=npcEquipmentTiming(g,e).windup;e.windupDuration=e.attackTimer;e.aimDx=attackFace.x;e.aimDz=attackFace.z;preparing[team]++;g.events.push({type:'enemy_windup',id:e.id,team,x:e.x,z:e.z});}
  else if(KingPersonality.movementSpent(g,e)){}
  else if((()=>{if(npcCastleDuty(g,e))return false;const goal=KingPersonality.kingAdvanceTarget(g,e,actionReach)||(!KingPersonality.hasMovementTicket(g,e)&&KingPersonality.escortTarget(g,e,actionReach));if(!goal)return false;friendlyRouteLegs.delete(e);e.intent=e.piece==='king'?'king_advance':'escort';if(!goal.hold){e.targetX=goal.x;e.targetZ=goal.z;moveNPC(g,e,goal.x,goal.z,dt,slashMotions);}return true;})()){}
  else if(npcMarchMove(g,e,target,dt,slashMotions)){}
  else if(limit>0&&e.piece!=='king'&&!knight&&(!attackFace||len>4.8||!actionReach)&&len>1.4){const move=npcFriendlyRoute(g,e,target,npcApproachSegment(e,target,g));if(move){const travel=terrainGroundDistance(g,e,move.x,move.z,movementSpeed(g,team,true)*dt,move.distance),nx=e.x+move.x*travel,nz=e.z+move.z*travel;const post=npcPost(g,e);if(npcCastleDuty(g,e)?npcCastleStepAllowed(g,e,{x:nx,z:nz}):Math.hypot(nx-post.x,nz-post.z)<=post.radius+1e-7){e.intent='advance';moveNPC(g,e,e.x+move.x*move.distance,e.z+move.z*move.distance,dt,slashMotions);}}}

 }

 if(dt>0)observeAwakeningEntries(g);
 if(attackAdmissions)for(const team of ['ally','enemy'])for(const e of attackAdmissions.order[team])if(e.alive&&e.attack==='windup')g.npcAttackCursor[team]=(e.slotKey+1)%20;
 resolveObservedSlashMotions(g,dt,slashFrames,slashMotions);updateHeldThrusts(g,dt,heldFrame,heroMotion);if(g.score-beforeScore>=3)g.hitstop=Math.max(g.hitstop,.065);
 if(!battleEnded(g)){for(let i=0;i<g.enemies.length;i++)for(let j=i+1;j<g.enemies.length;j++)separateNPCPair(g.enemies[i],g.enemies[j],g);for(const e of g.enemies){if(e.alive){e.x=clamp(e.x,arenaBounds(g).minX,arenaBounds(g).maxX);e.z=clamp(e.z,arenaBounds(g).minZ,arenaBounds(g).maxZ);}clearHeroLanding(g,e);}}
 if(dt>0){observeAwakeningEntries(g);applyAutomaticAwakening(g);}
 if(g.invasion){const progress=Invasion.updateInvasion(g.invasion,g);g.events.push(...progress.awards);}
 if(g.npcSensing===true){const frame=sensingFrames.get(g);if(frame)frame.locked=false;}
 updateBattleScenario(g);
 return g;
}
/* Pure king plans and escort destinations. Caller owns timers and all movement. */
const KingPersonality=(()=>{'use strict';
const RULESET='king-personality-v1';
const PERSONALITIES={defensive:{name:'堅守'},midgame:{name:'中盤から進軍'},endgame:{name:'終盤から進軍'}};
const PHASES={midgame:{minimumSeconds:10,captureFraction:1/3,fallbackSeconds:35},endgame:{minimumSeconds:25,captureFraction:2/3,fallbackSeconds:70}};
const other=team=>team==='ally'?'enemy':'ally';
const teamOfWave=w=>w.team==='player'?'ally':w.team;
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Number.isFinite(p.y??0);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function normalizePersonalities(value){const out={};for(const team of ['ally','enemy'])out[team]=Object.prototype.hasOwnProperty.call(PERSONALITIES,value?.[team])?value[team]:'defensive';return out;}
function playerActor(g){if(!g?.player)return null;return {...g.player,id:g.playerId??g.player.id,team:'ally',piece:g.piece,hp:g.hp,alive:g.player.alive!==false,airborne:g.mode==='jump'};}
function liveKing(g,team){const p=playerActor(g);if(team==='ally'&&p?.piece==='king'&&p.alive&&p.hp>0)return p;return g?.enemies?.find(e=>e.team===team&&e.piece==='king'&&e.alive&&(e.hp??1)>0)||null;}
function initialNonKings(g){return Math.max(1,(g.enemies||[]).filter(e=>e.piece!=='king'&&!e.trainingGuard).length+(g.player&&g.piece!=='king'?1:0));}
function initialPlan(g){return {elapsed:0,initialNonKings:initialNonKings(g)};}
function stageReady(g,personality){
 const rule=PHASES[personality],clock=g?.kingPlan;
 if(!rule||!clock||!Number.isFinite(clock.elapsed)||clock.elapsed<rule.minimumSeconds)return false;
 const initial=Number.isFinite(clock.initialNonKings)&&clock.initialNonKings>=1?clock.initialNonKings:initialNonKings(g);
 return clock.elapsed>=rule.fallbackSeconds||(Number.isFinite(g.npcCaptures)&&g.npcCaptures>=Math.ceil(initial*rule.captureFraction));
}
function campAdvanceGoal(g,king){
 const slot=g?.formationSlots?.find(s=>s.team===king?.team&&s.slotKey===4);
 if(!slot||!Number.isFinite(slot.x)||!['ally','enemy'].includes(king?.team))return null;
 // A half-file inner lane passes BETWEEN the original stationary pawns.
 // The goal is fixed enemy territory; it is not a flag or a victory trigger.
 const side=slot.x<0?1:slot.x>0?-1:king.team==='ally'?-1:1;
 return {x:clamp(slot.x+side*1.7,arenaBounds(g).minX+2,arenaBounds(g).maxX-2),z:g.arena?clamp(king.team==='ally'?-1:31,arenaBounds(g).minZ+2,arenaBounds(g).maxZ-2):king.team==='ally'?-1:31};
}
function canPlan(g,unit){return g?.scenario==='army'&&g.formationHero===true&&g.kingPersonalities&&g.active&&!battleEnded(g)&&finite(unit)&&unit.alive&&(unit.hp??1)>0&&Math.abs(unit.y??0)<.001&&unit.attack==='idle'&&!(unit.stagger>0)&&!(unit.spawnProtection>0)&&!unit.trainingGuard;}
function hostileNear(g,team,point,radius=9){
 const foes=(g.enemies||[]).filter(e=>e.alive&&e.team===other(team));const p=playerActor(g);if(team==='enemy'&&p?.alive&&p.hp>0)foes.push(p);
 return foes.some(e=>finite(e)&&Math.hypot(e.x-point.x,e.z-point.z)<=radius)
   ||(g.waves||[]).some(w=>teamOfWave(w)===other(team)&&w.age<w.life&&finite(w)&&Math.hypot(w.x-point.x,w.z-point.z)<=radius+Math.max(w.rx||0,w.rz||0));
}
// The entry lane is a waypoint, not the end of an assault. These later
// destinations use authored formation knowledge, then only local observation.
function kingAssaultGoal(g,king){
 const life=royalFrames.get(g)?.lives.get(king.id),camp=life?.kingCampWaypoint||campAdvanceGoal(g,king),stage=life?.kingMarchStage;
 if(!stage)return camp;
 if(stage==='rally')return {x:king.x,z:king.z};
 const post=g.formationSlots?.find(s=>s.team===other(king.team)&&s.slotKey===4);
 if(stage==='post')return post?{x:post.x,z:post.z}:camp;
 const p=playerActor(g),foes=[...g.enemies,...(king.team==='enemy'&&p?.alive&&p.hp>0?[p]:[])].filter(e=>e.alive&&(e.hp??1)>0&&e.team===other(king.team)&&finite(e)&&Math.hypot(e.x-king.x,e.z-king.z)<11.5);
 foes.sort((a,b)=>Math.hypot(a.x-king.x,a.z-king.z)-Math.hypot(b.x-king.x,b.z-king.z)||(a.slotKey??0)-(b.slotKey??0)||a.id-b.id);
 return foes.length?{x:foes[0].x,z:foes[0].z}:{x:king.x,z:king.z};
}
// Read only the current guard/king/role owner. A same-position replacement
// cannot lend another life or assignment its old arrival/failure status.
function kingRallyDutyMatches(g,king,life,guard,guardLife,duty){
 if(!duty||duty.lifeKey!==guardLife.key||duty.kingId!==king.id||duty.kingKey!==life.key||duty.team!==guard.team)return false;
 const plan=g.royalDefense?.[guard.team],target=plan?.threatId===g.playerId?g.player:g.enemies.find(e=>e.id===plan?.threatId),validThreat=plan?.threatId==null||target&&(target===g.player?guard.team==='enemy'&&g.hp>0&&target.alive!==false:target.alive&&target.team!==guard.team);
 const goal=validThreat&&(!plan?.kingKey||plan.kingKey===life.key)?plan?.goals.find(q=>q.id===guard.id):null,kind=goal?.intent||(!goal&&escortAssignment(g,guard)?'mobile_escort':null),threat=goal&&plan.threatId!=null?target:null;
 let threatKey='escort';
 if(threat){const controlled=threat===g.player,id=controlled?g.playerId:threat.id,threatLife=royalState(g).lives.get(id),signature=[controlled?'ally':threat.team,controlled?g.piece:threat.piece,controlled,controlled?g.hp>0&&threat.alive!==false:threat.alive&&(threat.hp??1)>0].join(':');if(threatLife?.actor!==threat||threatLife.signature!==signature)return false;threatKey=threatLife.key;}
 return !!kind&&duty.kind===kind&&duty.ownerKey===[guardLife.key,life.key,kind,threatKey].join('|');
}
// Let the existing convoy finish its camp rendezvous before changing axes.
// One episode has a fixed deadline; replacements cannot restart the wait.
function kingRallyComplete(g,king,life){
 const now=g.kingPlan.elapsed,rally=life.kingRally||(life.kingRally={since:now,guards:{}}),guards=escorts(g,king.team),far=[];
 for(const guard of guards){
  const distance=Math.hypot(guard.x-king.x,guard.z-king.z),key=royalLife(g,guard),state=royalState(g),guardLife=state.lives.get(guard.id),duty=state.records.get(guard.id),signature=[guard.team,guard.piece,false,guard.alive&&(guard.hp??1)>0].join(':');
  const currentLife=guardLife?.actor===guard&&guardLife.signature===signature,status=currentLife&&kingRallyDutyMatches(g,king,life,guard,guardLife,duty)?duty.status:null;let record=rally.guards[key];
  if(!record||!currentLife)record=rally.guards[key]={best:distance,lastProgress:now};
  if(distance<record.best-.05){record.best=distance;record.lastProgress=now;}
  record.state=distance<4.5&&status==='ARRIVED'?'arrived':guard.attack!=='idle'?'combat':['SEARCH_FAILED','DESTINATION_BLOCKED'].includes(status)?'unreachable':now-record.lastProgress<1?'approaching':'stationary';
  if(record.state!=='arrived')far.push(record);
 }
 return !far.length||now-rally.since>=4||far.every(record=>['combat','unreachable'].includes(record.state)&&now-record.lastProgress>=1);
}
// Castle exit keeps its authored half-file order. After that waypoint, use
// either existing legal king-leg order, rejecting a locally body-blocked step.
function kingAssaultLeg(g,king,goal){
 const dirs=PIECES.king.dirs,orders=[dirs,[...dirs].reverse()];let shortLegs=0;
 for(let index=0;index<orders.length;index++){
  const leg=nextLegalSegment(orders[index],king.team,goal.x-king.x,goal.z-king.z);if(!leg)continue;
  if(leg.distance<=1e-7){
   // Both decompositions may start below the existing movement consumer's
   // tolerance. Preserve the real residual coordinates and try a cardinal
   // king route; do not snap the actor or inflate an unconsumable distance.
   shortLegs++;if(index===1&&shortLegs===2)orders.push(C,[...C].reverse());continue;
  }
  const probe=Math.min(leg.distance,.8),point={x:king.x+leg.x*probe,z:king.z+leg.z*probe};
  if(defenseClear(g,king,king,point))return {x:king.x+leg.x*leg.distance,z:king.z+leg.z*leg.distance};
 }
 return null;
}
// A bounded local visibility graph is used only after the existing royal
// route fails. Its edges are real legal king legs with unchanged clearance.
// Midpoints of passable body gaps represent narrow corridors that a single
// obstacle detour cannot describe. A complete chosen path is consumed exactly.
function kingNavigationGeometry(g,king,goal){
 const regroup=royalFrames.get(g)?.lives.get(king.id)?.kingRegroup,support=regroup&&kingRegroupGuard(g,king);
 return [king.x,king.z,goal.x,goal.z,support?[regroup.guardKey,support.x,support.z].join(','):'',g.terrain,JSON.stringify(arenaBounds(g)),...royalBodies(g,king).filter(({e,r})=>Math.hypot(e.x-king.x,e.z-king.z)<=12.5+r).map(({e,r})=>[royalBodyId(g,e),e.team,e.piece,e.x,e.z,e.y||0,r].join(','))].join('|');
}
function* kingConvoySearch(g,king,goal,stats){
 const supportActor=kingRegroupGuard(g,king),support=supportActor?{x:supportActor.x,z:supportActor.z}:null,forward=king.team==='ally'?-1:1;
 const regroupAllows=(a,b)=>!support||(b.z-a.z)*forward<=1e-7&&Math.hypot(b.x-support.x,b.z-support.z)<=Math.hypot(a.x-support.x,a.z-support.z)+1e-7;
 const bodies=royalBodies(g,king).map(({e,r})=>({e:{...e},r})),start={x:king.x,z:king.z},range=8,near=bodies.filter(({e,r})=>Math.hypot(e.x-start.x,e.z-start.z)<range+r),dirs=PIECES.king.dirs,orders=[dirs,[...dirs].reverse(),C,[...C].reverse()],nodes=[start],seen=new Set(),mirror=king.team==='ally'?1:-1;
 const add=p=>{if(support&&(p.z-start.z)*forward>1e-7)return;if(nodes.length>=192||Math.hypot(p.x-start.x,p.z-start.z)>range||!arenaContains(g,p)||bodies.some(({e,r})=>Math.hypot(e.x-p.x,e.z-p.z)<r+1e-5))return;const key=p.x.toFixed(7)+':'+p.z.toFixed(7);if(!seen.has(key)){seen.add(key);nodes.push(p);}};
 for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){const a=near[i],b=near[j],d=Math.hypot(a.e.x-b.e.x,a.e.z-b.e.z);if(d>a.r+b.r+2e-5&&d<a.r+b.r+1.6){const t=(d+a.r-b.r)/(2*d);add({x:a.e.x+(b.e.x-a.e.x)*t,z:a.e.z+(b.e.z-a.e.z)*t});}}
 for(const {e,r}of near)for(const radius of [r+.25,r+.8])for(let n=0;n<16;n++)add({x:e.x+mirror*Math.cos(n*Math.PI/8)*radius,z:e.z+mirror*Math.sin(n*Math.PI/8)*radius});
 stats.nodes=nodes.length;
 const link=function*(a,b){let best=null;for(const order of orders){let p=a,length=0,points=[],valid=true;for(let i=0;i<2&&Math.hypot(p.x-b.x,p.z-b.z)>1e-7;i++){const leg=nextLegalSegment(order,king.team,b.x-p.x,b.z-p.z);if(!leg||leg.distance<=1e-7){valid=false;break;}const q={x:p.x+leg.x*leg.distance,z:p.z+leg.z*leg.distance};if(stats.queries>=24000){stats.budgetHit=true;return null;}if(stats.queries&&stats.queries%512===0)yield;stats.queries++;if(!regroupAllows(p,q)||!defenseClear(g,king,p,q,null,bodies)){valid=false;break;}points.push(q);length+=leg.distance;p=q;}if(valid&&Math.hypot(p.x-b.x,p.z-b.z)<1e-6&&(!best||length<best.length-1e-7))best={length,points};}return best;};
 const distances=nodes.map(()=>Infinity),previous=[],closed=new Set();distances[0]=0;let selected=null,remaining=Math.hypot(start.x-goal.x,start.z-goal.z)-.15;
 for(let n=0;n<96&&!stats.budgetHit;n++){let index=-1;for(let i=0;i<nodes.length;i++)if(!closed.has(i)&&(index<0||distances[i]<distances[index]))index=i;if(index<0||!Number.isFinite(distances[index]))break;closed.add(index);stats.visited++;
  const p=nodes[index],d=Math.hypot(p.x-goal.x,p.z-goal.z);if(index&&d<remaining-1e-7){selected=index;remaining=d;}
  for(let j=1;j<nodes.length&&!stats.budgetHit;j++){if(closed.has(j)||j===index||Math.hypot(nodes[j].x-p.x,nodes[j].z-p.z)>4.5)continue;const edge=yield* link(p,nodes[j]);if(edge&&distances[index]+edge.length<distances[j]-1e-7){distances[j]=distances[index]+edge.length;previous[j]={index,points:edge.points};}}
 }
 if(selected==null)return null;
 const points=[];for(let i=selected;i!==0;i=previous[i].index)points.unshift(...previous[i].points);if(!points.length)return null;
 stats.found=true;stats.length=distances[selected];return {...points[0],remaining:points.slice(1),precise:true};
}
// Keep expensive local search off the movement tick's critical path. Each
// owner gets at most 512 clearance queries per simulation frame; the search
// snapshots obstacles, then proves the completed path against current bodies.
function kingConvoyNavigation(g,king,goal){
 const life=royalFrames.get(g)?.lives.get(king.id);if(!life)return null;
 const key=[king.x,king.z,goal.x,goal.z].join(':');let job=life.kingNavigationJob;
 if(job?.key!==key){delete life.kingNavigationJob;job=null;}
 if(!job){const stats={at:g.time,nodes:0,visited:0,queries:0,budgetHit:false,found:false,slices:0,maxSliceQueries:0};job=life.kingNavigationJob={key,geometry:kingNavigationGeometry(g,king,goal),stats,iterator:kingConvoySearch(g,king,goal,stats),lastFrame:null};life.kingNavigationStats=stats;}
 if(life.kingNavigationLastSliceAt===g.time)return null;
 life.kingNavigationLastSliceAt=g.time;job.lastFrame=g.time;const before=job.stats.queries,result=job.iterator.next();job.stats.slices++;job.stats.maxSliceQueries=Math.max(job.stats.maxSliceQueries,job.stats.queries-before);
 if(!result.done)return null;
 delete life.kingNavigationJob;job.stats.finishedAt=g.time;const route=result.value;
 // Only a completed negative search is a failure memo. A cancelled job or
 // interrupted successful route must remain eligible for a fresh attempt.
 if(!route){life.kingNavigationProbe=job.geometry;return null;}delete life.kingNavigationProbe;
 let p=king;for(const q of [route,...route.remaining]){if(!kingRegroupPermits(g,king,p,q)||!defenseClear(g,king,p,q)){job.stats.invalidated=true;return null;}p=q;}
 return route;
}
// The camp marker is a waypoint, not an occupied square to be captured.
// When a friendly body owns it, select a nearby clear camp waypoint and
// require actual arrival there. Never move the blocker or skip the rendezvous.
function kingChooseCampWaypoint(g,king,life){
 if(!life||life.kingMarchStage||!npcRoyalMarch(g,king.team))return;
 const original=campAdvanceGoal(g,king);if(!original)return;
 const blocked=p=>royalBodies(g,king).some(({e,r})=>e.team===king.team&&Math.hypot(e.x-p.x,e.z-p.z)<r+.15);
 if(life.kingCampWaypoint){if(!blocked(life.kingCampWaypoint))return;delete life.kingCampWaypoint;delete life.kingCampProbe;delete life.kingFormationBypass;delete life.kingNavigationProbe;delete life.kingNavigationJob;}
 if(Math.hypot(king.x-original.x,king.z-original.z)>RANK_SPACING*2||!blocked(original))return;
 const geometry=kingNavigationGeometry(g,king,original);if(life.kingCampProbe===geometry)return;life.kingCampProbe=geometry;
 const m=king.team==='ally'?1:-1,choices=[];
 for(const [x,z]of PIECES.king.dirs){const n=Math.hypot(x,z),point={x:original.x+x/n*m*RANK_SPACING,z:original.z+z/n*m*RANK_SPACING};if(!arenaContains(g,point)||endpointBlockers(g,king,point).length)continue;const route=defenseRoute(g,king,point);if(route?.complete)choices.push({point,length:route.length});}
 choices.sort((a,b)=>a.length-b.length);if(choices.length){life.kingCampWaypoint=choices[0].point;delete life.kingFormationBypass;delete life.kingNavigationProbe;delete life.kingNavigationJob;}
}
// A king displaced into the far boundary must not mistake an assault hold
// for a ban on regrouping. Commit to one living selected escort, with a wide
// enter/exit gap; movement may only go inward without increasing separation.
function clearKingNavigation(life){delete life.kingFormationBypass;delete life.kingNavigationJob;delete life.kingNavigationProbe;}
function kingRegroupGuard(g,king){const r=royalFrames.get(g)?.lives.get(king.id)?.kingRegroup;if(!r)return null;const guard=escorts(g,king.team).find(e=>e.id===r.guardId&&e.alive&&!e.trainingGuard&&e.id!==g.playerId&&(e.hp??1)>0&&royalLife(g,e)===r.guardKey);return guard||null;}
function kingRegroupPermits(g,king,a,b){
 const life=royalFrames.get(g)?.lives.get(king.id);if(!life?.kingRegroup)return true;const guard=kingRegroupGuard(g,king);if(!guard)return false;
 return (b.z-a.z)*(king.team==='ally'?-1:1)<=1e-7&&Math.hypot(b.x-guard.x,b.z-guard.z)<=Math.hypot(a.x-guard.x,a.z-guard.z)+1e-7;
}
function kingBoundaryRegroup(g,king,life,order,guards){
 if(!life||!order)return null;
 let r=life.kingRegroup,guard=r&&kingRegroupGuard(g,king);
 if(r&&(!guard||Math.hypot(king.x-guard.x,king.z-guard.z)<=4.2)){delete life.kingRegroup;clearKingNavigation(life);r=null;guard=null;}
 if(!r){
  const edge=order.forward>0?arenaBounds(g).maxZ:arenaBounds(g).minZ;
  if((edge-king.z)*order.forward>RANK_SPACING||!guards.length||guards.some(e=>Math.hypot(e.x-king.x,e.z-king.z)<=9))return null;
  guard=guards.filter(e=>(king.z-e.z)*order.forward>RANK_SPACING).sort((a,b)=>Math.hypot(a.x-king.x,a.z-king.z)-Math.hypot(b.x-king.x,b.z-king.z)||a.id-b.id)[0];if(!guard)return null;
  r=life.kingRegroup={guardId:guard.id,guardKey:royalLife(g,guard),x:guard.x,z:guard.z};clearKingNavigation(life);
 }
 // The actor may approach while this fixed rendezvous leg executes. Stop
 // on actual support, not a stale point, timer, replacement or median troop.
 if(Math.hypot(king.x-r.x,king.z-r.z)<.15){
  if((guard.z-king.z)*order.forward>1e-7)return {hold:true,guard};
  r.x=guard.x;r.z=guard.z;clearKingNavigation(life);
 }
 return {guard,goal:{x:r.x,z:r.z}};
}
// Only already committed, locally observable landing circles are hazards.
// Forecasts read the current actor life/aim; emitted bursts retain their own
// wave identity even if their source later dies or changes faction.
function kingLandingHazards(g,king){
 const hazards=[],radius=2.8+ENEMY_RADIUS;
 for(const e of g.enemies){
  if(!e.alive||e.team===king.team||e.piece!=='knight'||Math.hypot(e.x-king.x,e.z-king.z)>NPC_SENSING.enter)continue;
  let point=null;
  if(e.attack==='leap'&&e.leapEnd)point=e.leapEnd;
  else if(e.attack==='windup'&&e.actionKind==='jump'&&npcHasAbility(g,e,'jump',{x:e.aimDx,z:e.aimDz}))point={x:clamp(e.x+Math.sign(e.aimDx)*3,arenaBounds(g).minX,arenaBounds(g).maxX),z:clamp(e.z+(e.team==='ally'?-6:6),arenaBounds(g).minZ,arenaBounds(g).maxZ)};
  if(point)hazards.push({...point,radius,key:`actor:${royalLife(g,e)}:${point.x}:${point.z}`});
 }
 if(king.team==='enemy'&&g.hp>0&&g.player?.alive!==false&&g.mode==='jump'&&!g.jumpLanded&&g.jumpEnd&&Math.hypot(g.player.x-king.x,g.player.z-king.z)<=NPC_SENSING.enter)hazards.push({...g.jumpEnd,radius,key:`hero:${royalLife(g,g.player)}:${g.jumpEnd.x}:${g.jumpEnd.z}`});
 for(const w of g.waves)if(w.kind==='burst'&&teamOfWave(w)!==king.team&&w.age<w.life&&!w.hitIds?.includes(king.id)&&Math.hypot(w.x-king.x,w.z-king.z)<=NPC_SENSING.enter)hazards.push({x:w.x,z:w.z,radius,key:`wave:${w.id}`});
 return hazards;
}
function kingLandingAvoidance(g,king){
 if(king.piece!=='king'||!canPlan(g,king)||!npcRoyalMarch(g,king.team))return null;
 const hazards=kingLandingHazards(g,king);if(!hazards.some(h=>Math.hypot(king.x-h.x,king.z-h.z)<=h.radius+.15))return null;
 let best=null;const mirror=king.team==='ally'?1:-1;
 for(const [dx,dz]of PIECES.king.dirs){
  const n=Math.hypot(dx,dz),x=dx/n*mirror,z=dz/n*mirror;let distance=0;
  for(const h of hazards){const ox=king.x-h.x,oz=king.z-h.z,r=h.radius+.15;if(Math.hypot(ox,oz)>r)continue;const projection=ox*x+oz*z;distance=Math.max(distance,-projection+Math.sqrt(Math.max(0,projection*projection-ox*ox-oz*oz+r*r))+.0001);}
  if(distance<=1e-7||distance>RANK_SPACING)continue;
  const point={x:king.x+x*distance,z:king.z+z*distance};
  if(hazards.some(h=>Math.hypot(point.x-h.x,point.z-h.z)<=h.radius+.15||Math.hypot(king.x-h.x,king.z-h.z)>h.radius+.15&&distanceSegment(h.x,h.z,king.x,king.z,point.x,point.z)<=h.radius+.15)||!defenseClear(g,king,king,point))continue;
  if(!best||distance<best.distance-1e-7)best={...point,distance};
 }
 if(best){const life=royalFrames.get(g)?.lives.get(king.id);if(life){delete life.kingFormationBypass;delete life.kingNavigationJob;delete life.kingNavigationProbe;}}
 return best;
}
function kingMarchEntersLanding(g,king,march){
 if(!npcRoyalMarch(g,king.team))return false;
 const leg=npcRoute(king,march.x,march.z,g);if(!leg)return false;
 const point={x:king.x+leg.x*Math.min(.8,leg.distance),z:king.z+leg.z*Math.min(.8,leg.distance)};
 return kingLandingHazards(g,king).some(h=>Math.hypot(king.x-h.x,king.z-h.z)>h.radius+.15&&distanceSegment(h.x,h.z,king.x,king.z,point.x,point.z)<=h.radius+.15);
}
function kingAdvanceTarget(g,king,combatTargetInReach=false){
 if(!canPlan(g,king)||king.piece!=='king'||!stageReady(g,g.kingPersonalities[king.team])||combatTargetInReach)return null;
 const owner=royalFrames.get(g)?.lives.get(king.id),order=npcRoyalMarch(g,king.team),records=royalFrames.get(g)?.records;
 if(owner)delete owner.kingScreenWait;
 const guards=escorts(g,king.team).filter(e=>!e.trainingGuard&&(e.hp??1)>0&&(order||!(['SEARCH_FAILED','DESTINATION_BLOCKED'].includes(records?.get(e.id)?.status)&&g.time-(records.get(e.id).failureAt??g.time)>3)));
 const slot=g.formationSlots.find(s=>s.team===king.team&&s.slotKey===4),departed=slot&&Math.hypot(king.x-slot.x,king.z-slot.z)>2;
 const regroup=kingBoundaryRegroup(g,king,owner,order,guards);if(regroup?.hold)return {x:king.x,z:king.z,hold:true,reason:'regroup-escort-rendezvous'};
 // This support condition is independent of the route direction. Resolve it
 // before any local search, including when unrelated bodies keep moving.
 if(order&&!regroup&&departed&&guards.length&&guards.every(e=>Math.hypot(e.x-king.x,e.z-king.z)>4.2)){if(owner){delete owner.kingNavigationJob;if(owner.kingFormationBypass?.precise)delete owner.kingFormationBypass;}return {x:king.x,z:king.z,hold:true,reason:'await-escort-position'};}
 if(!regroup)kingChooseCampWaypoint(g,king,owner);
 const goal=regroup?.goal||kingAssaultGoal(g,king);if(!goal||Math.hypot(goal.x-king.x,goal.z-king.z)<=1e-7)return null;
 const continuing=!!(regroup||owner?.kingMarchStage||owner?.kingCampWaypoint);let march=continuing?kingAssaultLeg(g,king,goal):Math.abs(goal.x-king.x)>1e-7?{x:goal.x,z:king.z}:goal;
 if(march&&!kingRegroupPermits(g,king,king,march))march=null;
 const blockedDirect=!march;
 if(!march&&!order)return {x:king.x,z:king.z,hold:true,reason:'assault-body-route-blocked'};
 march||=goal;
 const troops=order?g.enemies.filter(e=>e.alive&&e.team===king.team&&e.piece!=='king'&&e.id!==g.playerId&&!e.trainingGuard):[];
 // The marching formation may occupy the king's old open lane. Commit one
 // bounded, body-clear bypass leg rather than pushing a follower or switching
 // back to the authored X lane halfway through a detour.
 if(order){
 const life=royalFrames.get(g)?.lives.get(king.id),key=[regroup?'regroup:'+life.kingRegroup.guardKey:life?.kingMarchStage||'camp',goal.x,goal.z].join(':'),old=life?.kingFormationBypass;
 if(old?.precise)while(Math.hypot(old.x-king.x,old.z-king.z)<=1e-7&&old.remaining.length)Object.assign(old,old.remaining.shift());
 if(old){let p=king,clear=true;for(const q of [old,...(old.remaining||[])]){if(!kingRegroupPermits(g,king,p,q)||!defenseClear(g,king,p,q)){clear=false;break;}p=q;}if(old.key!==key||Math.hypot(old.x-king.x,old.z-king.z)<(old.precise?1e-7:.05)||!clear)delete life.kingFormationBypass;}
 if(life?.kingFormationBypass){const leg=kingAssaultLeg(g,king,life.kingFormationBypass);if(leg&&kingRegroupPermits(g,king,king,leg))march=leg;else delete life.kingFormationBypass;}
 if(!life?.kingFormationBypass&&!life?.kingNavigationJob){
  const primary=npcRoute(king,march.x,march.z,g),reverse=nextLegalSegment([...PIECES.king.dirs].reverse(),king.team,march.x-king.x,march.z-king.z);
  for(const proposal of [primary,reverse]){
   if(!proposal||proposal.distance<=1e-7)continue;
   const distance=Math.min(proposal.distance,RANK_SPACING),point={x:king.x+proposal.x*distance,z:king.z+proposal.z*distance};
   if(defenseClear(g,king,king,{x:king.x+proposal.x*Math.min(.8,distance),z:king.z+proposal.z*Math.min(.8,distance)}))continue;
   const route=defenseRoute(g,king,point);
   if(route){const endpoint={x:route.x,z:route.z},leg=kingAssaultLeg(g,king,endpoint);if(leg&&kingRegroupPermits(g,king,king,leg)){march=leg;if(life)life.kingFormationBypass={...endpoint,key};break;}}
  }
 }
  if(!life?.kingFormationBypass){
   const leg=npcRoute(king,march.x,march.z,g),p=leg?{x:king.x+leg.x*Math.min(.8,leg.distance),z:king.z+leg.z*Math.min(.8,leg.distance)}:null;
   if(blockedDirect||!p||!defenseClear(g,king,king,p)){
    const geometry=kingNavigationGeometry(g,king,goal);
    if(life?.kingNavigationJob||life?.kingNavigationProbe!==geometry){
     const route=kingConvoyNavigation(g,king,goal);if(route&&life){life.kingFormationBypass={...route,key};march={x:route.x,z:route.z};}
    }
   }else if(life)delete life.kingNavigationJob;
  }
  if(life?.kingFormationBypass)delete life.kingNavigationJob;
  if(life?.kingNavigationJob)return {x:king.x,z:king.z,hold:true,reason:'convoy-route-search'};
  if(blockedDirect&&!life?.kingFormationBypass)return {x:king.x,z:king.z,hold:true,reason:'assault-body-route-blocked'};
 }
 if(troops.length&&!regroup){
  const leg=npcRoute(king,march.x,march.z,g),budget=movementSpeed(g,king.team,true)*(royalFrames.get(g)?.frameDt||1/60),next=leg?order.kingProgress+leg.z*order.forward*Math.min(budget,leg.distance):order.kingProgress;
  const lag=troops.map(e=>{const target=clamp(e.homeZ+order.forward*next,arenaBounds(g).minZ,arenaBounds(g).maxZ),gap=(target-e.z)*order.forward;return e.piece==='knight'?Math.max(0,gap-6):Math.max(0,gap);}).sort((a,b)=>a-b);
  const lateralAlignment=!!leg&&leg.z===0&&Number.isFinite(leg.distance)&&leg.distance>1e-7&&march.z===king.z&&next<=order.kingProgress;
  if(!lateralAlignment&&lag[Math.floor(lag.length/2)]>RANK_SPACING+1e-7)return {x:king.x,z:king.z,hold:true,reason:'regroup-army-line'};
 }
 // Only an autonomous royal can wait for support. The controlled king
 // never enters this policy. An army order cannot discard a living escort
 // because a failed route has aged; support requires actual positioning.
 if(guards.length&&!regroup){
  const dx=march.x-king.x,dz=march.z-king.z,length=Math.hypot(dx,dz),face=continuing?{x:dx/length,z:dz/length}:Math.abs(goal.x-king.x)>1e-7?{x:Math.sign(goal.x-king.x),z:0}:{x:0,z:king.team==='ally'?-1:1},foes=g.enemies.filter(e=>e.alive&&e.team===other(king.team));const p=playerActor(g);if(king.team==='enemy'&&p?.alive&&p.hp>0)foes.push(p);
  const ahead=foes.filter(e=>finite(e)&&Math.hypot(e.x-king.x,e.z-king.z)<11.5&&(e.x-king.x)*face.x+(e.z-king.z)*face.z>0).sort((a,b)=>Math.hypot(a.x-king.x,a.z-king.z)-Math.hypot(b.x-king.x,b.z-king.z))[0];
  const screened=!ahead||guards.some(e=>{const d=Math.hypot(ahead.x-king.x,ahead.z-king.z);return Math.hypot(e.x-king.x,e.z-king.z)<5.5&&((e.x-king.x)*(ahead.x-king.x)+(e.z-king.z)*(ahead.z-king.z))/d>1.4;});
  if(!order&&departed&&guards.every(e=>Math.hypot(e.x-king.x,e.z-king.z)>4.2)||!screened){if(owner){if(order&&!screened&&ahead&&['post','local'].includes(owner.kingMarchStage))owner.kingScreenWait={x:king.x,z:king.z,stage:owner.kingMarchStage,goalX:goal.x,goalZ:goal.z,geometry:kingNavigationGeometry(g,king,goal),aheadId:ahead.id,aheadKey:royalLife(g,ahead.id===g.playerId?g.player:ahead),aheadX:ahead.x,aheadZ:ahead.z};delete owner.kingNavigationJob;if(owner.kingFormationBypass?.precise)delete owner.kingFormationBypass;}return {x:king.x,z:king.z,hold:true,reason:'await-escort-position'};}
 }
 if(!kingRegroupPermits(g,king,king,march))return {x:king.x,z:king.z,hold:true,reason:'regroup-body-route-blocked'};
 if(kingMarchEntersLanding(g,king,march))return {x:king.x,z:king.z,hold:true,reason:'wait-committed-landing'};
 // Align with the open lane first: the generic shortest legal route can put
 // its long forward leg first, which would otherwise stop at the pawn row.
 return march;
}
function escorts(g,team){
 if(!g?.kingPersonalities||!liveKing(g,team))return [];
 const slot=g.formationSlots?.find(s=>s.team===team&&s.slotKey===4);if(!slot)return [];
 const count=g.strategies?.[team]==='aggressive'?1:2;
 return (g.enemies||[]).filter(e=>e.alive&&e.team===team&&npcRoyalGuardPiece(g,e.piece)&&Math.hypot(e.homeX-slot.x,e.homeZ-slot.z)<9)
   .sort((a,b)=>npcGuardCompare(g,team,slot,a,b)).slice(0,count);
}
// Private per-game ownership, extending the existing royal leg records. The
// immutable ticket is per simulation frame; actors and episodes survive refresh.
const royalFrames=new WeakMap();
function royalState(g){let s=royalFrames.get(g);if(!s){s={serial:0,lives:new Map(),records:new Map(),tickets:new Map(),pairs:[],time:null};royalFrames.set(g,s);}return s;}
function syncRoyalLives(g){
 const s=royalState(g),present=new Set(),actors=[...g.enemies,...(g.player?[g.player]:[])];
 for(const e of actors){const controlled=e===g.player,id=controlled?g.playerId:e.id,team=controlled?'ally':e.team,piece=controlled?g.piece:e.piece,alive=controlled?g.hp>0&&e.alive!==false:e.alive&&(e.hp??1)>0,signature=[team,piece,controlled,alive].join(':');present.add(id);let life=s.lives.get(id);
  if(!life||life.actor!==e||life.signature!==signature){life={actor:e,signature,key:`${id}:${++s.serial}:${team}:${piece}`,alive};s.lives.set(id,life);s.records.delete(id);}
  // Milestones belong to this autonomous king life. Control transfer/death
  // recreates the life above; a genuine home return starts a new departure.
  if(alive&&!controlled&&piece==='king'){
   if((life.kingFormationBypass?.precise||life.kingNavigationJob)&&(e.attack!=='idle'||e.stagger>0||e.spawnProtection>0||Math.abs(e.y||0)>=.001||battleEnded(g))){delete life.kingFormationBypass;delete life.kingNavigationProbe;delete life.kingNavigationJob;}
   const home=g.formationSlots?.find(q=>q.team===team&&q.slotKey===4),camp=life.kingCampWaypoint||campAdvanceGoal(g,e),post=g.formationSlots?.find(q=>q.team===other(team)&&q.slotKey===4);
   if(life.kingRegroup&&!npcRoyalMarch(g,team)){delete life.kingRegroup;clearKingNavigation(life);}
   if(home&&Math.hypot(e.x-home.x,e.z-home.z)<.2){delete life.kingScreenWait;delete life.kingPassedScreens;delete life.kingRegroup;delete life.kingMarchStage;delete life.kingRally;delete life.kingFormationBypass;delete life.kingNavigationProbe;delete life.kingNavigationJob;delete life.kingCampWaypoint;delete life.kingCampProbe;}
   else if(canPlan(g,e)&&stageReady(g,g.kingPersonalities[team])){
    if(!life.kingMarchStage&&camp&&Math.hypot(e.x-camp.x,e.z-camp.z)<.15)life.kingMarchStage='rally';
    if(life.kingMarchStage==='rally'&&kingRallyComplete(g,e,life)){life.kingMarchStage='post';delete life.kingRally;}
    if(life.kingMarchStage==='post'&&post&&Math.hypot(e.x-post.x,e.z-post.z)<=1e-7)life.kingMarchStage='local';
   }
   // The order can advance while the king regroups. Require three distinct
   // formation slots (or all remaining slots), not a lone rushing leader.
   // Monotonic release belongs to this king life and resets on a real return.
   if(g.scenario==='army'&&g.formationHero===true&&g.npcSensing===true&&g.active&&!battleEnded(g)&&home&&stageReady(g,g.kingPersonalities?.[team])){
    const away=Math.hypot(e.x-home.x,e.z-home.z)>=.2;
    if(!away&&life.armyMarchWasAway){delete life.armyMarchProgress;life.armyMarchWasAway=false;}else if(away)life.armyMarchWasAway=true;
    const forward=team==='ally'?-1:1,fronts=new Map();
    for(const troop of g.enemies)if(troop.alive&&troop.team===team&&troop.piece!=='king'&&troop.id!==g.playerId&&!troop.trainingGuard){const progress=Math.max(0,(troop.z-troop.homeZ)*forward);fronts.set(troop.slotKey,Math.max(fronts.get(troop.slotKey)||0,progress));}
    const progressed=[...fronts.values()].sort((a,b)=>b-a),group=progressed[Math.min(2,progressed.length-1)]||0;
    life.armyMarchProgress=Math.max(life.armyMarchProgress||0,Math.max(0,(e.z-home.z)*forward),group);
   }
  }
  // A real return to the castle ends the completed exit subtask even while
  // interception/return owns movement and no mobile target is queried.
  if(life.escortExitComplete||life.escortOffset!=null||life.escortExitAlignment||life.escortRear){const king=liveKing(g,team),slot=g.formationSlots?.find(q=>q.team===team&&q.slotKey===4);if(finite(king)&&slot&&Math.hypot(king.x-slot.x,king.z-slot.z)<.2){life.escortExitComplete=false;life.escortOffset=null;life.escortExitAlignment=null;delete life.escortRear;}}
  if(!alive||controlled||!npcRoyalGuardPiece(g,piece)||e.trainingGuard)s.records.delete(id);
 }
 for(const id of s.lives.keys())if(!present.has(id)){s.lives.delete(id);s.records.delete(id);}
 if(battleEnded(g))s.records.clear();
 return s;
}
function armyMarchProgress(g,king){return royalFrames.get(g)?.lives.get(king.id)?.armyMarchProgress||0;}
function royalLife(g,e){const id=e===g.player?g.playerId:e.id;return royalState(g).lives.get(id)?.key||`${id}:${e.team}:${e.piece}`;}
function royalKingKey(g,king){return king.id===g.playerId?royalLife(g,g.player):royalLife(g,king);}
function royalBodies(g,unit){
 const bodies=g.enemies.filter(e=>e!==unit&&e.alive&&(e.y||0)<ENEMY_HEIGHT).map(e=>({e,r:1.4}));
 if(g.hp>0&&g.player.alive!==false&&g.playerId!==unit.id&&(g.player.y||0)<ENEMY_HEIGHT&&!bodies.some(b=>b.e===g.player||b.e.id===g.playerId))bodies.push({e:g.player,r:1.6});
 return bodies;
}
function royalBodyId(g,e){return e===g.player?g.playerId:e.id;}
function endpointBlockers(g,unit,goal,reservations=[]){
 const blockers=royalBodies(g,unit).filter(({e,r})=>Math.hypot(e.x-goal.x,e.z-goal.z)<r+(goal.waypoint?0:.15)-1e-7).map(({e,r})=>({id:royalBodyId(g,e),x:e.x,z:e.z,y:e.y||0,r,controlled:e===g.player}));
 for(const q of reservations)if(q.id!==unit.id&&Math.hypot(q.x-goal.x,q.z-goal.z)<1.7-1e-7)blockers.push({reservation:q.id,x:q.x,z:q.z,r:1.7});
 return blockers;
}
function royalArrived(g,unit,goal,reservations=[]){
 return !goal.waypoint&&Math.hypot(unit.x-goal.x,unit.z-goal.z)<.15&&royalBodies(g,unit).every(({e,r})=>Math.hypot(unit.x-e.x,unit.z-e.z)>=r-1e-7)&&reservations.every(q=>q.id===unit.id||Math.hypot(q.x-goal.x,q.z-goal.z)>=1.7-1e-7);
}
function defenseClear(g,unit,a,b,query=null,bodies=null){
 if(!arenaContains(g,b)||!terrainPath(g,a,b))return false;
 for(const {e,r}of bodies||royalBodies(g,unit)){const start=Math.hypot(a.x-e.x,a.z-e.z);if(start<r+1e-7&&(a.x-e.x)*(b.x-a.x)+(a.z-e.z)*(b.z-a.z)>=-1e-9)continue;if(distanceSegment(e.x,e.z,a.x,a.z,b.x,b.z)<r-1e-7){if(query)query.set(royalBodyId(g,e),{id:royalBodyId(g,e),x:e.x,z:e.z,y:e.y||0,r,controlled:e===g.player});return false;}}
 return true;
}
function royalGeometryChanged(g,record){
 return !!record?.failureBodies?.some(b=>{if(b.reservation!=null)return false;const e=b.controlled?g.player:g.enemies.find(e=>e.id===b.id);return !e||!(b.controlled?g.hp>0&&g.player.alive!==false:e.alive)||(e.y||0)>=ENEMY_HEIGHT||Math.hypot(e.x-b.x,e.z-b.z)>1e-7||Math.abs((e.y||0)-b.y)>1e-7;});
}
// Decision-only evidence for a physical screen. Uses existing physical contact solvers;
// does not create a wave, move an actor, grant attacks, or change damage.
function royalScreenEvidence(g, screen, king, threat) {
 const grounded=e=>e&&Math.abs(e.y||0)<.001&&!e.airborne;
 if(!screen?.alive||(screen.hp??1)<=0||screen.stagger>0||screen.team!==king?.team||!grounded(screen)||!grounded(king)||!grounded(threat))return null;
 const d=Math.hypot(threat.x-king.x,threat.z-king.z),along=d?((screen.x-king.x)*(threat.x-king.x)+(screen.z-king.z)*(threat.z-king.z))/d:0;
 if(along<=1.4||along>=d||Math.hypot(screen.x-king.x,screen.z-king.z)>=5.5||distanceSegment(screen.x,screen.z,king.x,king.z,threat.x,threat.z)>=1.45)return null;
 // A detached slash from a completed action remains dangerous behind a body.
 if(g.waves.some(w=>w.sourceId===threat.id&&w.age<w.life&&!['thrust','charge'].includes(w.kind)))return null;
 const hero=threat.id===g.playerId,source=hero?g.player:threat,phase=hero?g.mode:threat.attack;
 const committed=hero?['windup','charge','thrust','sweep','jump','dragon'].includes(phase):['windup','charge','recover','leap'].includes(phase);
 const face=committed?(hero?{x:g.sweepDirection&&['thrust','sweep'].includes(phase)?g.sweepDirection.dx:source.dx,z:g.sweepDirection&&['thrust','sweep'].includes(phase)?g.sweepDirection.dz:source.dz}:{x:threat.aimDx,z:threat.aimDz}):npcAttackFacing(threat,king);
 const kind=committed?(hero?({windup:'charge',charge:'charge',thrust:'thrust',sweep:'sweep',jump:'jump',dragon:'sweep'})[phase]:threat.actionKind):npcAttackKind(threat,face,d,g);
 if(!['thrust','charge'].includes(kind)||!face||Math.abs(Math.hypot(face.x,face.z)-1)>1e-6)return null;
 if(!(hero?heroHasAbility(g,kind):actorHasAbility(g,threat,kind,'npc'))||!committed&&(d>=DIFFICULTIES[g.difficulty||'normal'].engage||!hero&&!npcActionWithinPost(g,threat,kind,face,d)))return null;
 const live=g.waves.find(w=>w.sourceId===threat.id&&w.kind===kind&&w.age<w.life);
 // A spent committed action is not a fresh hypothetical attack.
 if(phase==='recover'&&!live||phase==='charge'&&!live||hero&&phase==='thrust'&&!live&&(thrustTiming(g)?.canonicalElapsed??THRUST.duration-g.phase)>=THRUST.release)return null;
 const body=(e,r=ENEMY_RADIUS)=>({x:e.x,y:e.y||0,z:e.z,height:ENEMY_HEIGHT,radius:r});
 let guardTime,kingTime;
 if(kind==='thrust'){
  const w=live||{dx:face.x,dz:face.z,age:0,swingScale:hero?1:.24/.35};
  // Retain .05 units of lateral margin; a .8-unit miss is never a screen.
  if(Math.abs((screen.x-source.x)*w.dz-(screen.z-source.z)*w.dx)>ENEMY_RADIUS+THRUST.radius-.05)return null;
  const duration=(THRUST.activeEnd-THRUST.release)/(w.swingScale||1)-w.age;if(duration<=0)return null;
  const still=e=>{const p=body(e);return{start:p,end:p,moveDt:0,delay:0,frameDt:duration};},owner=still(source);
  guardTime=heldThrustContact(w,duration,owner,still(screen))?.t;
  kingTime=heldThrustContact(w,duration,owner,still(king))?.t;
 }else{
  let travel=hero?CHARGE_SPEED*(phase==='charge'?Math.max(0,g.phase):.38):Math.min(npcChargeTravel(g,threat,face),phase==='charge'?CHARGE_SPEED*Math.max(0,threat.attackTimer):Infinity);
  travel=terrainGroundDistance(g,source,face.x,face.z,arenaTravel(source.x,source.z,face.x,face.z,travel,g));
  const w={kind:'charge',x:source.x+face.x*.55,y:(source.y||0)+1.9,z:source.z+face.z*.55,dx:face.x,dz:face.z,rx:1.4,ry:1.9,rz:1.15},end={...w,x:w.x+face.x*travel,z:w.z+face.z*travel};
  // Shrink only the decision witness, never the actual collider.
  guardTime=chargeWaveContact(w,end,body(screen,ENEMY_RADIUS-.05),1);
  kingTime=chargeWaveContact(w,end,body(king),1);
 }
 if(!Number.isFinite(guardTime)||!Number.isFinite(kingTime)||guardTime>=kingTime-1e-6)return null;
 return{kind:'actor_screen',threatId:threat.id,action:kind,legalGeometry:true,committedAttack:committed,stationarySnapshot:true};
}

function royalUseful(g,unit,king){
 if(!king)return null;
 const foes=g.enemies.filter(e=>e.alive&&(e.hp??1)>0&&e.team!==unit.team),p=playerActor(g);if(unit.team==='enemy'&&p?.alive&&p.hp>0)foes.push(p);
 const combat=movementTicket(g,unit)?.combat;
 for(const foe of foes){if(Math.hypot(foe.x-king.x,foe.z-king.z)>13)continue;const face=npcAttackFacing(unit,foe),len=Math.hypot(foe.x-unit.x,foe.z-unit.z),kind=npcAttackKind(unit,face,len,g),legal=face&&len<DIFFICULTIES[g.difficulty||'normal'].engage&&npcActionMayReach(g,unit,foe,face,kind)&&npcActionWithinPost(g,unit,kind,face,len);
  if(legal&&combat?.time===g.time&&combat.targetId===foe.id&&combat.actionReach&&combat.attackGranted&&combat.cooldown<=combat.dt)return {kind:'legal_attack_opportunity',threatId:foe.id,legalGeometry:true,attackGranted:true,cooldown:combat.cooldown,dt:combat.dt};
  if(['windup','recover'].includes(unit.attack)&&unit.actionKind&&npcActionMayReach(g,unit,foe,{x:unit.aimDx,z:unit.aimDz},unit.actionKind))return {kind:'ongoing_combat_cycle',threatId:foe.id,committedAttack:true,phase:unit.attack};
 }
 for(const foe of foes){const screen=royalScreenEvidence(g,unit,king,foe);if(screen)return screen;}
 return null;
}
function royalSuspension(g,e){return battleEnded(g)?'terminal':!g.active?'inactive':e.stagger>0?'stagger':e.spawnProtection>0?'spawn-protection':Math.abs(e.y||0)>=.001?'airborne':e.attack!=='idle'?'committed-action':null;}
function escortAssignment(g,unit){
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities||!unit.alive||unit.id===g.playerId||!npcRoyalGuardPiece(g,unit.piece)||unit.trainingGuard)return null;
 const king=liveKing(g,unit.team),slot=g.formationSlots?.find(s=>s.team===unit.team&&s.slotKey===4);if(!finite(king)||!slot)return null;
 const guards=escorts(g,unit.team),index=guards.findIndex(e=>e.id===unit.id),atHome=Math.hypot(king.x-slot.x,king.z-slot.z)<.2,record=royalState(g).records.get(unit.id),established=record?.kind==='mobile_escort'&&record.lifeKey===royalLife(g,unit)&&record.kingKey===royalKingKey(g,king);if(index<0)return null;
 // Re-entering the home disk midway through an unfinished escort leg is not
 // task completion. Remember establishment independently of execution gates.
 if(atHome&&Math.hypot(unit.x-unit.homeX,unit.z-unit.homeZ)<.25&&(!established||!record.mobileStartedAtHome||record.mobileKingLeftHome||record.mobileFulfilled))return null;
 return {king,slot,guards,index,atHome};
}
function makeRoyalTicket(g,unit){
 const s=royalState(g),life=s.lives.get(unit.id);if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities)return null;if(!life||!life.alive||unit.id===g.playerId||!npcRoyalGuardPiece(g,unit.piece)||unit.trainingGuard)return null;
 const plan=g.royalDefense?.[unit.team],currentKing=liveKing(g,unit.team),selected=escorts(g,unit.team).some(e=>e===unit),validThreat=plan?.threatId==null||plan.threatId===g.playerId&&unit.team==='enemy'&&g.hp>0&&g.player.alive!==false||g.enemies.some(e=>e.id===plan?.threatId&&e.alive&&e.team!==unit.team);
 if(!selected&&!s.records.has(unit.id))return null;
 const royalGoal=!battleEnded(g)&&selected&&currentKing&&validThreat&&(!plan?.kingKey||plan.kingKey===royalKingKey(g,currentKing))?plan?.goals.find(q=>q.id===unit.id):null,escort=!battleEnded(g)&&!royalGoal&&escortAssignment(g,unit),king=royalGoal?currentKing:escort?.king;
 const goal=royalGoal?{...royalGoal}:escort?{...escortMovementGoal(g,unit),id:unit.id,intent:'mobile_escort'}:null;
 const kind=royalGoal?.intent||(escort?'mobile_escort':null),threat=royalGoal&&plan.threatId!=null?(plan.threatId===g.playerId?g.player:g.enemies.find(e=>e.id===plan.threatId)):null;
 const ownerKey=kind?[life.key,royalKingKey(g,king),kind,threat?royalLife(g,threat):'escort'].join('|'):null;
 const assignment=ownerKey?Object.freeze({ownerKey,lifeKey:life.key,kingId:king.id,kingKey:royalKingKey(g,king),threatId:threat?royalBodyId(g,threat):null,kind,goal:Object.freeze(goal),episodeKey:plan?.episode?.id||null}):null;
 let record=s.records.get(unit.id);
 if(!assignment){s.records.delete(unit.id);if(plan?.legs)delete plan.legs[unit.id];record=null;}
 else if(!record||record.ownerKey!==ownerKey){record={ownerKey,kind,lifeKey:life.key,kingId:king.id,kingKey:royalKingKey(g,king),mobileStartedAtHome:kind==='mobile_escort'?escort.atHome:null,mobileKingLeftHome:false,mobileFulfilled:false,team:unit.team,goalX:goal.x,goalZ:goal.z,leg:null,failureAt:null,retryAt:null,failureBodies:[],status:null};s.records.set(unit.id,record);}
 if(record&&kind==='mobile_escort'){if(!escort.atHome)record.mobileKingLeftHome=true;if(goal.hold&&Math.abs(unit.y||0)<.001&&Math.abs(king.y||0)<.001&&!king.airborne&&royalBodies(g,unit).every(({e,r})=>Math.hypot(unit.x-e.x,unit.z-e.z)>=r-1e-7))record.mobileFulfilled=true;}
 if(record&&royalGoal)plan.legs[unit.id]=record;
 const suspension=royalSuspension(g,unit)||(king&&(Math.abs(king.y||0)>=.001||king.airborne)?'king-airborne':null);
 return {id:unit.id,time:g.time,dt:s.frameDt||0,lifeKey:life.key,assignment,ownerKey,eligible:!suspension,spent:false,result:null,status:assignment?null:'NO_DUTY',outcome:suspension?{kind:'suspended',reason:suspension}:null,record};
}
function prepareMovement(g,dt=null){
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities)return;
 const s=syncRoyalLives(g);s.frameDt=Number.isFinite(dt)?dt:Math.max(0,Math.min(.05,g.time-(s.time??0)));s.time=g.time;s.tickets=new Map();
 for(const e of g.enemies){const t=makeRoyalTicket(g,e);if(t)s.tickets.set(e,t);}
 for(const plan of Object.values(g.royalDefense||{}))for(const id of Object.keys(plan.legs||{}))if(!plan.goals.some(q=>q.id===Number(id))||s.records.get(Number(id))!==plan.legs[id])delete plan.legs[id];
}
function movementTicket(g,e){const s=royalFrames.get(g);return s?.time===g.time?s.tickets.get(e):null;}
function ownsMovement(g,e){return !!movementTicket(g,e)?.assignment;}
function noteCombat(g,e,combat){if(e.piece==='king'&&combat.actionReach){const life=royalFrames.get(g)?.lives.get(e.id);if(life&&(life.kingFormationBypass?.precise||life.kingNavigationJob)){delete life.kingFormationBypass;delete life.kingNavigationProbe;delete life.kingNavigationJob;}}const t=movementTicket(g,e);if(t)t.combat={time:g.time,...combat};}
function movementSuspended(g,e){const t=movementTicket(g,e);return !!t&&!t.eligible;}
function hasMovementTicket(g,e){return !!movementTicket(g,e);}
function movementSpent(g,e){return !!movementTicket(g,e)?.spent;}
function spendMovement(g,e){const t=movementTicket(g,e);if(!t)return true;if(t.spent||!t.eligible)return false;t.spent=true;t.outcome={kind:'attempted',reason:t.assignment?.kind||'generic'};return true;}
function finishMovement(g,e,from,result){
 const t=movementTicket(g,e);if(!t)return result;const distance=Math.hypot(e.x-from.x,e.z-from.z);t.outcome={kind:distance>1e-9?'moved':'body-blocked',reason:t.assignment?.kind||'generic',distance};
 const r=t.record,leg=r?.leg;if(leg&&t.assignment&&t.result?.status==='ROUTE'){const before=Math.hypot(from.x-leg.x,from.z-leg.z),remaining=Math.hypot(e.x-leg.x,e.z-leg.z);leg.activeStall=(leg.activeStall||0)+t.dt;leg.voluntaryProgress=(leg.voluntaryProgress||0)+Math.max(0,before-remaining);if(leg.voluntaryProgress>.01&&remaining<leg.bestRemaining-.01){leg.bestRemaining=remaining;leg.movedAt=g.time;leg.voluntaryProgress=0;leg.activeStall=0;}if(!result){r.failureAt??=g.time;if(t.assignment.kind!=='mobile_escort')r.retryAt??=g.time+.55;}else if(t.assignment.kind==='mobile_escort'){r.failureAt=null;r.retryAt=null;}}
 return result;
}
function suspendMovement(g,e,reason){const t=movementTicket(g,e);if(t)t.outcome={kind:'suspended',reason};}
function suspendFrame(g,reason,dt=null){prepareMovement(g,dt);for(const t of royalState(g).tickets.values()){t.eligible=false;t.outcome={kind:'suspended',reason};}}
function guardDiagnostics(g){const s=royalFrames.get(g);if(!s)return {time:g.time,actors:[],pairs:[]};return JSON.parse(JSON.stringify({time:s.time,actors:[...s.tickets.values()].map(t=>({id:t.id,time:t.time,lifeKey:t.lifeKey,ownerKey:t.ownerKey,assignment:t.assignment,status:t.status,outcome:t.outcome,spent:t.spent,eligible:t.eligible,result:t.result,combat:t.combat,record:t.record})),pairs:s.pairs.filter(p=>p.time===s.time),episodes:Object.entries(g.royalDefense||{}).map(([team,p])=>({team,...p.episode,goals:p.goals}))}));}

// Royal screens are local defensive assignments, never an unbounded pursuit.
// Fixed legal legs survive target refreshes so silver cannot undo its first leg.
// Failure recovery only examines the current two guards and authored endpoints.
function royalPoints(g,king,threat){
 const dx=threat.x-king.x,dz=threat.z-king.z,d=Math.hypot(dx,dz),ux=dx/d,uz=dz/d,r=Math.max(1.8,Math.min(4,d*.55,d-1.6)),a=arenaBounds(g);
 const point=(along,side=0)=>({x:clamp(king.x+ux*along-uz*side,a.minX+1,a.maxX-1),z:clamp(king.z+uz*along+ux*side,a.minZ+1,a.maxZ-1)});
 const front=(d<3.4?[point(1.8,1.7),point(1.8,-1.7),point(0,2.2),point(0,-2.2)]:d<5?[point(r),point(1.8),point(1.8,1.7),point(1.8,-1.7)]:[r,Math.min(r,3.4),Math.min(r,2.8),2.2].map(r=>point(r))).map((q,slot)=>({...q,slot})).filter((q,i,all)=>!all.slice(0,i).some(p=>Math.hypot(q.x-p.x,q.z-p.z)<1e-9));
 // An advancing formation can occupy every center-line intercept post.
 // Keep two existing flank-sized front alternatives plus rear cover, only
 // for the bounded failed-pair retry. Both actual routes must be complete.
 const convoyFront=npcRoyalMarch(g,king.team)?[-1,1].map((side,i)=>({...point(1.8,side*1.7),slot:100+i})):[];
 return {front:[...front,...convoyFront],convoyFront,cover:side=>point(Math.abs(side)===2?-1.8:1.8,Math.sign(side)*1.7),side:guard=>{const cross=(guard.homeX-king.x)*-uz+(guard.homeZ-king.z)*ux;return Math.abs(cross)>1e-7?Math.sign(cross):Math.sign((guard.homeX-king.x)*(king.team==='ally'?1:-1))||1;}};
}
function royalCommit(g,plan,goals,results=null){
 plan.goals=goals;const s=royalState(g);
 for(const q of goals){const e=g.enemies.find(e=>e.id===q.id),r=s.records.get(q.id);if(r&&(r.ownerKey.split('|')[2]!==q.intent||Math.hypot(r.goalX-q.x,r.goalZ-q.z)>2)){r.leg=null;}if(results){plan.prepared||={};plan.prepared[q.id]={time:g.time,goal:{...q},result:results.get(`${q.id}:${q.x}:${q.z}`)};}}
}
function royalPairUseful(g,plan,king,guards){
 const threat=plan.threatId===g.playerId?g.player:g.enemies.find(e=>e.id===plan.threatId);
 return plan.goals.length===guards.length&&plan.goals.every(q=>{const e=guards.find(e=>e.id===q.id),r=royalState(g).records.get(q.id);if(!e)return false;const owner=[royalLife(g,e),royalKingKey(g,king),q.intent,threat?royalLife(g,threat):'escort'].join('|'),leg=r?.leg,progressing=leg&&r.ownerKey===owner&&leg.ownerKey===owner&&Math.hypot(leg.goalX-q.x,leg.goalZ-q.z)<=2&&(leg.activeStall||0)<=.3;return royalArrived(g,e,q,plan.goals)||progressing||royalUseful(g,e,king);});
}

function reevaluateRoyalPair(g,plan,king,threat,guards,points){
 const ep=plan.episode,primary=guards.find(e=>e.id===ep.primaryId)||guards[0],secondary=guards.find(e=>e!==primary),memo=new Map(),report={time:g.time,team:king.team,episodeKey:ep.id,semanticKey:ep.key,swapUsedBefore:ep.swapUsed,queries:[],pairCombinations:0,committed:false,reason:null};
 royalState(g).pairs.push(report);
 if(royalPairUseful(g,plan,king,guards)){report.reason='incumbent-useful-or-progressing';return;}
 const query=(e,q)=>{const key=`${e.id}:${q.x}:${q.z}`;if(memo.has(key))return memo.get(key);const blockers=endpointBlockers(g,e,q),arrived=royalArrived(g,e,q);let result;
  if(arrived)result={status:'ARRIVED',complete:true};else if(blockers.length)result={status:'DESTINATION_BLOCKED',blockers};else{const observed=new Map(),route=defenseRoute(g,e,q,observed);report.queries.push({id:e.id,x:q.x,z:q.z});result=route?{status:'ROUTE',route,complete:route.complete===true}:{status:'SEARCH_FAILED',blockers:[...observed.values()]};}memo.set(key,result);const incumbent=plan.goals.find(p=>p.id===e.id&&Math.hypot(p.x-q.x,p.z-q.z)<1e-9);if(incumbent){plan.prepared||={};plan.prepared[e.id]={time:g.time,goal:{...incumbent},result};}return result;};
 const fronts=points.front.filter(p=>p.slot<100||p.slot===ep.interceptSlot).sort((a,b)=>(a.slot===ep.interceptSlot?-1:0)-(b.slot===ep.interceptSlot?-1:0)||a.slot-b.slot);
 const mappings=[[primary,secondary,false]];if(secondary&&!ep.swapUsed&&guards.every(e=>canPlan(g,e)))mappings.push([secondary,primary,true]);
 for(const [frontGuard,coverGuard,swap]of mappings){const canonical=points.side(coverGuard||frontGuard),side=ep.coverSides[coverGuard?.id]??canonical;
  for(const front of fronts)for(const flank of coverGuard?[side,-side]:[side]){if(report.pairCombinations>=16)break;report.pairCombinations++;
   const q1={id:frontGuard.id,x:front.x,z:front.z,intent:'royal_intercept'},q2=coverGuard?{id:coverGuard.id,...points.cover(flank),intent:'royal_cover'}:null;
   if(q2&&Math.hypot(q1.x-q2.x,q1.z-q2.z)<1.7-1e-7)continue;
   const a=query(frontGuard,q1);if(!a.complete)continue;const b=q2?query(coverGuard,q2):{complete:true};if(!b.complete)continue;
   ep.primaryId=frontGuard.id;ep.interceptSlot=front.slot;if(coverGuard)ep.coverSides[coverGuard.id]=flank;if(swap)ep.swapUsed=true;ep.bothCompleted=false;
   royalCommit(g,plan,q2?[q1,q2]:[q1],memo);report.committed=true;report.reason=swap?'one-role-swap':'same-role-endpoint';report.swap=swap;report.swapUsedAfter=ep.swapUsed;report.goals=plan.goals.map(q=>({...q}));return;
  }
 }
 // Original front/cover combinations have failed. A local offset front
 // and a rear cover avoid demanding that ordinary forward-only troops vacate
 // an occupied marker. This remains a two-route proof, never a timed release.
 if(points.convoyFront.length)for(const [frontGuard,coverGuard,swap]of mappings){
  const side=points.side(coverGuard||frontGuard);
  for(const front of points.convoyFront)for(const flank of coverGuard?[side*2,-side*2]:[side]){
   report.pairCombinations++;
   const q1={id:frontGuard.id,x:front.x,z:front.z,intent:'royal_intercept'},q2=coverGuard?{id:coverGuard.id,...points.cover(flank),intent:'royal_cover'}:null;
   if(q2&&Math.hypot(q1.x-q2.x,q1.z-q2.z)<1.7-1e-7)continue;
   const a=query(frontGuard,q1);if(!a.complete)continue;const b=q2?query(coverGuard,q2):{complete:true};if(!b.complete)continue;
   ep.primaryId=frontGuard.id;ep.interceptSlot=front.slot;if(coverGuard)ep.coverSides[coverGuard.id]=flank;if(swap)ep.swapUsed=true;ep.bothCompleted=false;
   royalCommit(g,plan,q2?[q1,q2]:[q1],memo);report.committed=true;report.reason='convoy-body-clear-pair';report.swap=swap;report.swapUsedAfter=ep.swapUsed;report.goals=plan.goals.map(q=>({...q}));return;
  }
 }
 report.reason='bounded-pair-unfulfilled';report.swapUsedAfter=ep.swapUsed;
}
// A completed native forward-only screen can be obsolete after the king
// passes its source. This rear bound ignores temporary path/body blocks and
// lateral separation; re-evaluate current positions, piece and team each tick.
function royalThreatMayReach(g,king,threat){
 const hero=threat.id===g.playerId,piece=hero?pieceKey(g):threat.piece;
 if(!['pawn','lance'].includes(piece)||g.capabilityLoadout||g.promotionPulse)return true;
 // Preserve committed actions, forced movement and already released attacks.
 // Their geometry may belong to an earlier pose, piece or control owner.
 if((hero?g.mode!=='ready':threat.attack!=='idle')||threat.stagger>0||Math.abs(threat.y||0)>.001)return true;
 if(g.waves.some(w=>w.sourceId===threat.id&&w.age<w.life))return true;
 const forward=threat.team==='ally'?-1:1,radius=king.id===g.playerId?HERO_RADIUS:ENEMY_RADIUS;
 // The pawn's held thrust starts at THRUST.start and extends forwards.
 // The lance's only attack is charge, from .55 ahead with radius1.15.
 // Keep the attack rear half-plane, king body and boundary slack unchanged.
 const rear=piece==='lance'?.55-1.15-radius:THRUST.start-THRUST.radius-radius;
 return (king.z-threat.z)*forward>=rear-1e-7;
}
// A real unfulfilled forward-screen request may retire a passed-only decoy.
// Consume only the same king/target lives and unchanged geometry next frame;
// commitment, movement, replacement or newly supplied support invalidates it.
function kingScreenWaitCurrent(g,king,state){
 const life=state.lives.get(king.id),wait=life?.kingScreenWait;
 if(!wait||!canPlan(g,king)||!npcRoyalMarch(g,king.team)||wait.stage!==life.kingMarchStage||wait.x!==king.x||wait.z!==king.z)return false;
 const goal=kingAssaultGoal(g,king);if(!goal||goal.x!==wait.goalX||goal.z!==wait.goalZ||kingNavigationGeometry(g,king,goal)!==wait.geometry)return false;
 const ahead=wait.aheadId===g.playerId?playerActor(g):g.enemies.find(e=>e.id===wait.aheadId);
 if(!ahead?.alive||(ahead.hp??1)<=0||ahead.team===king.team||ahead.x!==wait.aheadX||ahead.z!==wait.aheadZ||royalLife(g,ahead.id===g.playerId?g.player:ahead)!==wait.aheadKey)return false;
 const d=Math.hypot(ahead.x-king.x,ahead.z-king.z);
 return d>1e-7&&d<11.5&&!escorts(g,king.team).some(e=>Math.hypot(e.x-king.x,e.z-king.z)<5.5&&((e.x-king.x)*(ahead.x-king.x)+(e.z-king.z)*(ahead.z-king.z))/d>1.4);
}
// After the actual camp rendezvous, retire a completed, incompatible screen
// whose native source is behind this king. Remember that target life while
// the proof remains true so
// the next fulfilled move cannot immediately reacquire the same stale duty.
function kingPassedScreens(g,king,state,old){
 const life=state.lives.get(king.id);if(!life)return null;
 if(!npcRoyalMarch(g,king.team)||!['post','local'].includes(life.kingMarchStage)){delete life.kingScreenWait;delete life.kingPassedScreens;return null;}
 let retired=life.kingPassedScreens;
 const actor=id=>id===g.playerId?playerActor(g):g.enemies.find(e=>e.id===id),key=e=>royalLife(g,e.id===g.playerId?g.player:e);
 if(retired)for(const [id,owner]of retired){const e=actor(id);if(!e?.alive||(e.hp??1)<=0||e.team===king.team||key(e)!==owner||royalThreatMayReach(g,king,e))retired.delete(id);}
 if(!kingScreenWaitCurrent(g,king,state)||!old||old.kingKey!==life.key||!old.goals.length)return retired;
 const threat=actor(old.threatId),wait=life.kingScreenWait;
 if(!threat?.alive||(threat.hp??1)<=0||threat.team===king.team||threat.id===wait.aheadId||royalThreatMayReach(g,king,threat))return retired;
 const guards=escorts(g,king.team),threatKey=key(threat);
 const complete=old.goals.every(q=>{const guard=guards.find(e=>e.id===q.id),duty=state.records.get(q.id);return guard&&canPlan(g,guard)&&duty?.status==='ARRIVED'&&duty.ownerKey===[royalLife(g,guard),life.key,q.intent,threatKey].join('|')&&royalArrived(g,guard,q,old.goals);});
 if(complete){retired??=life.kingPassedScreens=new Map();retired.set(threat.id,threatKey);}
 return retired;
}
function updateDefense(g){
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities)return;
 const state=syncRoyalLives(g);state.pairs=[];
 if(g?.difficulty==='easy'&&battleScenarioDefinition(g.battleScenario?.id)?.royalDefense!==true){if(g.royalDefense)delete g.royalDefense;return;}
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities||!g.active||battleEnded(g))return;
 g.royalDefense||={};
 for(const team of ['ally','enemy']){
  const king=liveKing(g,team),old=g.royalDefense[team];
  if(!finite(king)){delete g.royalDefense[team];continue;}
  // Air and committed actions suspend an assignment, never select withdrawal.
  if(Math.abs(king.y??0)>.001||king.airborne)continue;
  const available=escorts(g,team).filter(e=>!e.trainingGuard&&(e.hp??1)>0&&e.id!==g.playerId);
  if(!available.length){delete g.royalDefense[team];continue;}
  const foes=g.enemies.filter(e=>e.alive&&e.team===other(team));const p=playerActor(g);if(team==='enemy'&&p?.alive&&p.hp>0)foes.push(p);
  const retired=kingPassedScreens(g,king,state,old);
  const candidates=foes.filter(e=>finite(e)&&Math.hypot(e.x-king.x,e.z-king.z)<(old?.threatId===e.id?13:11.5)&&!retired?.has(e.id));
  candidates.sort((a,b)=>Math.hypot(a.x-king.x,a.z-king.z)-Math.hypot(b.x-king.x,b.z-king.z)-(a.id===old?.threatId?1:0)+(b.id===old?.threatId?1:0)||a.slotKey-b.slotKey||a.id-b.id);
  const threat=candidates[0];
  if(!threat){
   if(!old)continue;
   const slot=g.formationSlots.find(s=>s.team===team&&s.slotKey===4),atHome=slot&&Math.hypot(king.x-slot.x,king.z-slot.z)<2;
   const goals=atHome?available.filter(e=>old.goals.some(q=>q.id===e.id)&&!royalArrived(g,e,{id:e.id,x:e.homeX,z:e.homeZ},[])).map(e=>({id:e.id,x:e.homeX,z:e.homeZ,intent:'royal_return'})):[];
   if(goals.length)g.royalDefense[team]={kingId:king.id,kingKey:royalKingKey(g,king),threatId:null,until:g.time+.55,goals,legs:old.legs||{}};else delete g.royalDefense[team];
   continue;
  }
  // Distant replacements first leave their formation through legal mobile
  // routes. They join local interception only after reaching the king.
  const guards=available.filter(e=>Math.hypot(e.x-king.x,e.z-king.z)<(state.records.get(e.id)?.kind==='mobile_escort'?6:9));
  if(!guards.length){delete g.royalDefense[team];continue;}
  const dx=threat.x-king.x,dz=threat.z-king.z,d=Math.hypot(dx,dz);if(d<.1){delete g.royalDefense[team];continue;}
  const semanticKey=[team,royalKingKey(g,king),royalLife(g,threat),...guards.map(e=>royalLife(g,e)).sort(),'active-royal'].join('|'),same=old?.episode?.key===semanticKey;
  if(old?.hold&&old.holdKey===semanticKey&&g.time<old.until&&g.enemies.some(e=>e.id!==king.id&&royalScreenEvidence(g,e,king,threat)))continue;
  const failed=same&&old.goals.some(q=>['DESTINATION_BLOCKED','SEARCH_FAILED'].includes(state.records.get(q.id)?.status));
  // Pair enumeration retains the existing tactical cadence. A guard's own
  // cached failure still invalidates immediately when its blocker moves or
  // clears, inside defenseTarget; that does not require rebuilding the pair.
  if(same&&g.time<old.until){
   const points=royalPoints(g,king,threat),front=points.front.find(q=>q.slot===old.episode.interceptSlot)||points.front[0];
   old.goals=old.goals.map(q=>q.intent==='royal_intercept'?{...q,x:front.x,z:front.z}:{...q,...points.cover(old.episode.coverSides[q.id]??points.side(guards.find(e=>e.id===q.id)))});
   continue;
  }
  const screen=g.enemies.find(e=>e.id!==king.id&&royalScreenEvidence(g,e,king,threat));
  if((!old||old.hold)&&screen){g.royalDefense[team]={kingId:king.id,kingKey:royalKingKey(g,king),threatId:threat.id,until:g.time+.55,goals:[],legs:{},hold:true,holdKey:semanticKey};continue;}
  const points=royalPoints(g,king,threat),nominal=points.front[0],ordered=[...guards].sort((a,b)=>Math.hypot(a.x-nominal.x,a.z-nominal.z)-Math.hypot(b.x-nominal.x,b.z-nominal.z)||a.slotKey-b.slotKey||a.id-b.id);
  const episode=same?old.episode:{key:semanticKey,id:`${semanticKey}#${++state.serial}`,swapUsed:false,bothCompleted:false,primaryId:ordered[0].id,interceptSlot:0,coverSides:{}};
  const primary=guards.find(e=>e.id===episode.primaryId)||ordered[0],cover=guards.find(e=>e!==primary),preferred=points.front.find(q=>q.slot===episode.interceptSlot)||points.front[0];
  // An occupied choice remains explicitly failed. It is never an unchecked
  // route fallback; only the resolver may approve movement to a destination.
  const front=same?preferred:points.front.find(q=>q.slot<100&&!endpointBlockers(g,primary,q).length)||preferred;
  episode.interceptSlot=front.slot;const goals=[{id:primary.id,x:front.x,z:front.z,intent:'royal_intercept'}];
  if(cover){const side=episode.coverSides[cover.id]??points.side(cover);episode.coverSides[cover.id]=side;goals.push({id:cover.id,...points.cover(side),intent:'royal_cover'});}
  const plan={kingId:king.id,kingKey:royalKingKey(g,king),threatId:threat.id,until:g.time+.55,goals,legs:same?old.legs||{}:{},episode};g.royalDefense[team]=plan;
  const complete=goals.every(q=>{const e=guards.find(e=>e.id===q.id);return royalArrived(g,e,q,goals);});
  if(complete&&!episode.bothCompleted){episode.swapUsed=false;episode.bothCompleted=true;episode.id=`${semanticKey}#${++state.serial}`;}else if(!complete)episode.bothCompleted=false;
  if(failed||goals.some(q=>endpointBlockers(g,guards.find(e=>e.id===q.id),q,goals).length))reevaluateRoyalPair(g,plan,king,threat,guards,points);
 }
}

// Only this local royal assignment plans around stationary bodies. Existing
// collision clips every actual step; no blocker is moved or ignored to fit it.
function defenseRoute(g,unit,goal,query=null,kingAxes=false){
 const dirs=PIECES[unit.piece].dirs,king=liveKing(g,unit.team);
 const clear=(a,b)=>defenseClear(g,unit,a,b,query);
 const routes=(from,to)=>{
  const choices=[];
  for(const order of [dirs,[...dirs].reverse(),...(kingAxes?[C,[...C].reverse()]:[])]){let p={x:from.x,z:from.z},first=null,length=0,valid=true;
   for(let n=0;n<2&&Math.hypot(p.x-to.x,p.z-to.z)>1e-7;n++){const segment=nextLegalSegment(order,unit.team,to.x-p.x,to.z-p.z);if(!segment){valid=false;break;}const next={x:p.x+segment.x*segment.distance,z:p.z+segment.z*segment.distance};if(!clear(p,next)){valid=false;break;}if(segment.distance>1e-7)first||=next;length+=segment.distance;p=next;}
   if(valid&&first&&Math.hypot(p.x-to.x,p.z-to.z)<1e-6)choices.push({...first,length,complete:true});
  }
  return choices.sort((a,b)=>Math.abs(a.length-b.length)>1e-7?a.length-b.length:0)[0]||null;
 };
 const direct=routes(unit,goal);if(direct)return direct;
 if(terrainOn(g)){const leg=npcRoute(unit,goal.x,goal.z,g);if(leg){const point={x:unit.x+leg.x*leg.distance,z:unit.z+leg.z*leg.distance};if(clear(unit,point))return {...point,length:leg.distance,complete:false};}}
 let best=null;
 // One nearby body can be skirted with a stable waypoint. This is deliberately
 // bounded local routing, not pathfinding across the entire army.
 const centers=[...g.enemies];if(g.hp>0&&g.player.alive!==false&&(g.player.y||0)<ENEMY_HEIGHT&&g.playerId!==unit.id&&!centers.some(b=>b===g.player||b.id===g.playerId))centers.push(g.player);
 for(const b of centers){if((b===g.player?b.alive===false:!b.alive)||b===unit||Math.hypot(b.x-unit.x,b.z-unit.z)>6)continue;
  for(const radius of [1.65,2.2])for(let n=0;n<8;n++){const a=n*Math.PI/4,m=unit.team==='ally'?-1:1,via={x:b.x+Math.cos(a)*radius*m,z:b.z+Math.sin(a)*radius*m};if(king&&Math.hypot(via.x-king.x,via.z-king.z)>Math.max(7,Math.hypot(unit.x-king.x,unit.z-king.z)+2))continue;const first=routes(unit,via);if(!first)continue;const second=routes(via,goal);if(!second)continue;const length=first.length+second.length;if(!best||length<best.length-1e-6)best={...first,length};}
 }
 // The king may use a longer cardinal ordering when diagonal-shortest
 // legs intersect the moving formation. Try it only after the legacy
 // bounded query fails; every complete leg retains the same body checks.
 if(!best&&!kingAxes&&unit.piece==='king'&&npcRoyalMarch(g,unit.team))return defenseRoute(g,unit,goal,query,true);
 return best;
}
function defenseTarget(g,unit){
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities||!npcRoyalGuardPiece(g,unit.piece))return {status:'NO_DUTY',hold:false};
 let ticket=movementTicket(g,unit);if(!ticket){if(royalFrames.get(g)?.time===g.time)return {status:'NO_DUTY',hold:false};syncRoyalLives(g);ticket=makeRoyalTicket(g,unit);}if(!ticket?.assignment)return {status:'NO_DUTY',hold:false};if(ticket.result)return ticket.result;
 const a=ticket.assignment,goal=a.goal,record=ticket.record,plan=g.royalDefense?.[unit.team],king=liveKing(g,unit.team),reservations=a.kind==='mobile_escort'?[]:plan?.goals||[],blockers=endpointBlockers(g,unit,goal,reservations);
 const done=(status,data={})=>{record.status=status;ticket.status=status;return ticket.result={status,intent:a.kind==='mobile_escort'?'escort':a.kind,ownerKey:a.ownerKey,goal:{...goal},...data};};
 const hold=(status,reason,data={})=>{const useful=royalUseful(g,unit,king);ticket.outcome={kind:'held',reason,usefulEvidence:useful};return done(status,{hold:true,reason,usefulEvidence:useful,...data});};
 if(!ticket.eligible){ticket.outcome={kind:'suspended',reason:royalSuspension(g,unit)||'king-airborne'};return ticket.result={status:null,intent:a.kind,ownerKey:a.ownerKey,hold:true,suspended:true,reason:'execution-suspended-unqueried'};}
 // Mobile escort's authored task is an envelope, not the nominal waypoint.
 // Preserve its existing legal proposal and physical clipping. Royal point
 // assignments below still require the bounded body-clear endpoint resolver.
 if(a.kind==='mobile_escort'){
  if(ticket.combat?.actionReach&&Math.hypot(unit.x-king.x,unit.z-king.z)<5.5)return hold(null,'mobile-combat-in-reach',{executionGate:'combatTargetInReach'});
  const compatible=royalBodies(g,unit).every(({e,r})=>Math.hypot(unit.x-e.x,unit.z-e.z)>=r-1e-7);
  if(goal.hold){record.leg=null;const kingDistance=Math.hypot(unit.x-king.x,unit.z-king.z);if(kingDistance>=4.5)return hold(null,'frame-start-envelope-refresh',{kingDistance,frameStartEnvelope:true,bodyCompatible:compatible});if(compatible){record.mobileFulfilled=true;record.failureAt=null;record.retryAt=null;return hold('ARRIVED','escort-envelope',{x:unit.x,z:unit.z,arrivalKind:'escort-envelope',kingDistance:Math.hypot(unit.x-king.x,unit.z-king.z),bodyCompatible:true});}return hold('DESTINATION_BLOCKED','escort-envelope-body-overlap',{arrivalKind:'escort-envelope',bodyCompatible:false});}
  const material=Math.hypot((record.queryGoalX??goal.x)-goal.x,(record.queryGoalZ??goal.z)-goal.z)>2,changed=royalGeometryChanged(g,record);
  let leg=record.leg;
  if(leg){const next=nextLegalSegment(PIECES[unit.piece].dirs,unit.team,leg.x-unit.x,leg.z-unit.z),legal=next&&Math.hypot(unit.x+next.x*next.distance-leg.x,unit.z+next.z*next.distance-leg.z)<1e-6;
   if(material||Math.hypot(unit.x-leg.x,unit.z-leg.z)<.05||(leg.activeStall||0)>.3||!legal||!defenseClear(g,unit,unit,leg)){record.leg=null;leg=null;}
  }
  if(!leg){
   if(!changed&&!material&&record.status==='SEARCH_FAILED'&&record.retryAt>g.time)return hold('SEARCH_FAILED','mobile-bounded-retry',{failureAt:record.failureAt,retryAt:record.retryAt});
   record.leg=null;record.queryGoalX=goal.x;record.queryGoalZ=goal.z;const query=new Map(),mirror=unit.team==='ally'?1:-1,side=Math.sign(unit.x-king.x)||mirror,bounds=arenaBounds(g),candidates=[goal];
   for(const lateral of [side*2.2,-side*2.2,side*3.4,-side*3.4])candidates.push({x:clamp(king.x+lateral,bounds.minX+1.6,bounds.maxX-1.6),z:clamp(king.z-1.8*mirror,bounds.minZ+1.6,bounds.maxZ-1.6),escortOffset:lateral*mirror});
   // A crowded forward line can admit a complete legal rendezvous behind
   // the king. Keep the actual accepted post on this guard/king life.
   if(npcRoyalMarch(g,unit.team))for(const lateral of [side*2.2,-side*2.2])candidates.push({x:clamp(king.x+lateral,bounds.minX+1.6,bounds.maxX-1.6),z:clamp(king.z+1.8*mirror,bounds.minZ+1.6,bounds.maxZ-1.6),escortOffset:lateral*mirror,escortRear:true});
   let route=null;
   for(const point of candidates){const blocked=endpointBlockers(g,unit,point);for(const b of blocked)if(b.id!=null)query.set(b.id,b);if(blocked.length)continue;
    // A completed alternate flank is a real escort post. Keep that side on
    // this guard/king life rather than repeatedly attempting an occupied swap.
    if(point.escortOffset!=null&&royalArrived(g,unit,point)){
     const life=royalState(g).lives.get(unit.id);if(life){life.escortOffset=point.escortOffset;if(point.escortRear)life.escortRear=true;else delete life.escortRear;}record.mobileAcceptedOffset=point.escortOffset;record.mobileFulfilled=true;record.leg=null;record.failureAt=null;record.retryAt=null;record.failureBodies=[];
     return hold('ARRIVED','accepted-escort-rendezvous',{x:unit.x,z:unit.z,arrivalKind:'escort-envelope',acceptedGoal:{x:point.x,z:point.z},kingDistance:Math.hypot(unit.x-king.x,unit.z-king.z),bodyCompatible:true});
    }
    route=defenseRoute(g,unit,point,query);if(route)break;
   }
   if(!route){record.failureAt??=g.time;record.retryAt=g.time+.55;record.failureBodies=[...query.values()];return hold('SEARCH_FAILED','mobile-bounded-search-failed',{failureAt:record.failureAt,retryAt:record.retryAt,blockers:record.failureBodies});}
   leg=record.leg={...route,ownerKey:a.ownerKey,lifeKey:a.lifeKey,kingId:a.kingId,team:unit.team,goalX:goal.x,goalZ:goal.z,bestRemaining:Math.hypot(unit.x-route.x,unit.z-route.z),movedAt:g.time,createdAt:g.time,activeStall:0};record.failureAt=null;record.retryAt=null;record.failureBodies=[];
  }
  return done('ROUTE',{...leg,hold:false,bodyClearance:'bounded-local-route'});
 }
 if(royalArrived(g,unit,goal,reservations)){record.leg=null;record.failureAt=null;record.retryAt=null;record.failureBodies=[];return hold('ARRIVED','actual-goal-arrival',{x:unit.x,z:unit.z});}
 const material=Math.hypot((record.leg?.goalX??record.queryGoalX??record.goalX)-goal.x,(record.leg?.goalZ??record.queryGoalZ??record.goalZ)-goal.z)>2,changed=royalGeometryChanged(g,record);record.goalX=goal.x;record.goalZ=goal.z;
 const fail=(status,bodies,reason)=>{record.leg=null;record.failureAt??=g.time;if(record.retryAt==null||g.time>=record.retryAt||changed||material){record.retryAt=g.time+.55;record.queryGoalX=goal.x;record.queryGoalZ=goal.z;}record.failureBodies=bodies;return hold(status,reason,{blockers:bodies,failureAt:record.failureAt,retryAt:record.retryAt});};
 if(blockers.length)return fail('DESTINATION_BLOCKED',blockers,'destination-occupied');
 const wasOccupied=record.status==='DESTINATION_BLOCKED';
 let leg=record.leg;
 if(leg){const next=nextLegalSegment(PIECES[unit.piece].dirs,unit.team,leg.x-unit.x,leg.z-unit.z),legal=next&&Math.hypot(unit.x+next.x*next.distance-leg.x,unit.z+next.z*next.distance-leg.z)<1e-6;
  if(material||Math.hypot(unit.x-leg.x,unit.z-leg.z)<.05||(leg.activeStall||0)>.3||!legal||!defenseClear(g,unit,unit,leg)){record.leg=null;leg=null;}
 }
 if(!leg){
  const prepared=plan?.prepared?.[unit.id],freshPrepared=prepared?.time===g.time&&Math.hypot(prepared.goal.x-goal.x,prepared.goal.z-goal.z)<1e-9,preparedChanged=freshPrepared&&royalGeometryChanged(g,{failureBodies:prepared.result?.blockers});
  if(!freshPrepared&&!wasOccupied&&!changed&&!material&&record.status==='SEARCH_FAILED'&&record.retryAt>g.time)return hold('SEARCH_FAILED','bounded-retry-wait',{failureAt:record.failureAt,retryAt:record.retryAt,blockers:record.failureBodies});
  // Invalidate BEFORE querying. A failed query can never expose the old leg.
  record.leg=null;record.queryGoalX=goal.x;record.queryGoalZ=goal.z;const query=new Map();let route;
  if(freshPrepared&&!preparedChanged){route=prepared.result?.route||null;if(route&&!defenseClear(g,unit,unit,route,query))route=null;for(const b of prepared.result?.blockers||[])query.set(b.id,b);}else route=defenseRoute(g,unit,goal,query);
  if(!route)return fail('SEARCH_FAILED',[...query.values()],'bounded-search-failed');
  leg=record.leg={...route,ownerKey:a.ownerKey,lifeKey:a.lifeKey,kingId:a.kingId,team:unit.team,goalX:goal.x,goalZ:goal.z,bestRemaining:Math.hypot(unit.x-route.x,unit.z-route.z),movedAt:g.time,createdAt:g.time,activeStall:0};record.failureAt=null;record.retryAt=null;record.failureBodies=[];
 }
 return done('ROUTE',{...leg,hold:false});
}
function escortMovementGoal(g,unit){
 const king=liveKing(g,unit.team),mirror=unit.team==='ally'?1:-1,guards=escorts(g,unit.team).sort((a,b)=>(a.homeX-b.homeX)*mirror||a.id-b.id),index=guards.findIndex(e=>e.id===unit.id),slot=g.formationSlots.find(s=>s.team===unit.team&&s.slotKey===4),forward=-mirror,side=index===0?-1:1;
 // Formation exit is a completed subtask, not a positional toggle. Keep
 // it through royal-role changes for this guard/king life, and reset at home.
 const life=royalState(g).lives.get(unit.id),kingKey=royalKingKey(g,king);
 if(life&&(life.escortExitKingKey!==kingKey||Math.hypot(king.x-slot.x,king.z-slot.z)<.2)){life.escortExitKingKey=kingKey;life.escortExitComplete=false;life.escortOffset=null;life.escortExitAlignment=null;delete life.escortRear;}
 const target={x:clamp(king.x+(life?.escortOffset??side*2.2)*mirror,arenaBounds(g).minX+1.6,arenaBounds(g).maxX-1.6),z:clamp(king.z+(life?.escortRear?1.8:-1.8)*mirror,arenaBounds(g).minZ+1.6,arenaBounds(g).maxZ-1.6)};
 if(Math.hypot(king.x-slot.x,king.z-slot.z)<.2&&Math.hypot(unit.x-king.x,unit.z-king.z)<4.5||Math.hypot(unit.x-target.x,unit.z-target.z)<1e-7)return {...target,hold:true};
 if(life?.escortExitAlignment&&!life.escortExitComplete&&forward*(unit.z-king.z)>=2.6&&Math.hypot(unit.x-king.x,unit.z-king.z)<4.2-1e-7)return {x:unit.x,z:unit.z,hold:true,formationExitPaused:true};
 const pawnSlots=g.formationSlots.filter(s=>s.team===unit.team&&s.slotKey>=11),front=pawnSlots.length?(forward<0?Math.min(...pawnSlots.map(s=>s.z)):Math.max(...pawnSlots.map(s=>s.z))):(unit.team==='ally'?23:7),exitZ=g.arena?clamp(front+forward*2,arenaBounds(g).minZ,arenaBounds(g).maxZ):front+forward*2;
 if(life&&forward*(unit.z-front)>=2-1e-7)life.escortExitComplete=true;
 // The resolver owns every intermediate legal leg. Reissuing an X-only
 // waypoint here would undo a valid body-avoidance detour on the next frame.
 if(!life?.escortExitComplete&&(life?.escortExitAlignment||Math.hypot(king.x-slot.x,king.z-slot.z)>=2)&&forward*(king.z-slot.z)>=.2&&forward*(unit.z-front)<2){
  const royalGoal=campAdvanceGoal(g,king),toward=Math.sign(royalGoal.x-unit.homeX)||-mirror,laneX=clamp(unit.homeX+toward*1.7,arenaBounds(g).minX+1.6,arenaBounds(g).maxX-1.6);
  // Keep the castle's inner-lane alignment as a committed subgoal; a body
  // detour must not rebuild that subgoal from the actor's new position.
  if(life&&!life.escortExitAlignment){const dx=laneX-unit.x,z=unit.piece==='silver'?unit.z+forward*Math.abs(dx):unit.z;life.escortExitAlignment={x:laneX,z:clamp(z,arenaBounds(g).minZ,arenaBounds(g).maxZ),complete:Math.abs(dx)<=.04};}
  const alignment=life?.escortExitAlignment;
  if(alignment&&!alignment.complete){if(Math.hypot(unit.x-alignment.x,unit.z-alignment.z)<.05||forward*(unit.z-alignment.z)>.05)alignment.complete=true;else return {x:alignment.x,z:alignment.z,waypoint:true};}
  return {x:laneX,z:exitZ,waypoint:true};
 }
 return target;
}

function mobileEscort(g,unit){
 if(g?.scenario!=='army'||g.formationHero!==true||!g.kingPersonalities||!unit?.alive||!npcRoyalGuardPiece(g,unit.piece)||unit.trainingGuard)return false;
 // Every consumer observes the same established semantic task, including
 // refill/sensing checks before the next frame ticket is assembled.
 return !!(escortAssignment(g,unit)||g.royalDefense?.[unit.team]?.goals?.some(q=>q.id===unit.id));
}
function escortTarget(g,unit,combatTargetInReach=false){
 if(!canPlan(g,unit)||!npcRoyalGuardPiece(g,unit.piece)||combatTargetInReach)return null;
 const king=liveKing(g,unit.team);if(!finite(king)||Math.abs(king.y??0)>=.001||king.airborne)return null;
 const mirror=unit.team==='ally'?1:-1;
 const guards=escorts(g,unit.team).sort((a,b)=>(a.homeX-b.homeX)*mirror||a.id-b.id),index=guards.findIndex(e=>e.id===unit.id);if(index<0)return null;
 const slot=g.formationSlots.find(s=>s.team===unit.team&&s.slotKey===4);
 if(Math.hypot(king.x-slot.x,king.z-slot.z)<2&&Math.hypot(unit.x-unit.homeX,unit.z-unit.homeZ)<.25)return null;
 // A close escort is holding its royal post. Null would hand the same actor
 // back to ordinary pursuit, making it cross this boundary every other frame.
 if(Math.hypot(unit.x-king.x,unit.z-king.z)<4.5)return {x:unit.x,z:unit.z,hold:true};
 const forward=-mirror,side=index===0?-1:1;
 const target={x:clamp(king.x+side*3.4*mirror,arenaBounds(g).minX+1.6,arenaBounds(g).maxX-1.6),z:clamp(king.z+2.6*mirror,arenaBounds(g).minZ+1.6,arenaBounds(g).maxZ-1.6)};
 const pawnSlots=g.formationSlots.filter(s=>s.team===unit.team&&s.slotKey>=11);
 const front=pawnSlots.length?(forward<0?Math.min(...pawnSlots.map(s=>s.z)):Math.max(...pawnSlots.map(s=>s.z))):(unit.team==='ally'?23:7),exitZ=g.arena?clamp(front+forward*2,arenaBounds(g).minZ,arenaBounds(g).maxZ):front+forward*2;
 if(forward*(king.z-slot.z)>=2&&forward*(king.z-unit.z)>1&&forward*(unit.z-front)<2){
  const royalGoal=campAdvanceGoal(g,king),toward=Math.sign(royalGoal.x-unit.homeX)||-mirror;
  const laneX=clamp(unit.homeX+toward*1.7,arenaBounds(g).minX+1.6,arenaBounds(g).maxX-1.6),dx=laneX-unit.x;
  if(Math.abs(dx)>.04){const z=unit.piece==='silver'?unit.z+forward*Math.abs(dx):unit.z;return z>=arenaBounds(g).minZ&&z<=arenaBounds(g).maxZ?{x:laneX,z}:{x:laneX,z:exitZ};}
  return {x:laneX,z:exitZ};
 }
 // Backward silver travel requires two diagonal legs; repeatedly realigning
 // toward x after its first leg would undo that legal retreat forever.
 if(forward*(target.z-unit.z)<-1e-7)return target;
 if(Math.abs(target.x-unit.x)>.04){const z=unit.piece==='silver'?unit.z+forward*Math.abs(target.x-unit.x):unit.z;return z>=arenaBounds(g).minZ&&z<=arenaBounds(g).maxZ?{x:target.x,z}:target;}
 return Math.hypot(unit.x-target.x,unit.z-target.z)>.1?target:null;
}
const ROYAL_API={kingLandingAvoidance,armyMarchProgress,guardDiagnostics,noteCombat,prepareMovement,ownsMovement,hasMovementTicket,movementSpent,movementSuspended,spendMovement,finishMovement,suspendMovement,suspendFrame,RULESET,PERSONALITIES,PHASES,normalizePersonalities,playerActor,liveKing,initialPlan,stageReady,campAdvanceGoal,hostileNear,kingAdvanceTarget,escorts,updateDefense,defenseTarget,mobileEscort,escortTarget};
return ROYAL_API;
})();


const Invasion=(()=>{
// Candidate only. Observes the engine after EVERY simulation substep; never
// writes game state, victory, combat score, storage, or actor objects.
const INVASION_RULESET = 'army-invasion-ranks-v1';
const INVASION_RULES = Object.freeze({boundary:7,mirrorZ:30,rankSpacing:3.8,tiers:3,rankPoints:50,kingEntryBonus:150});
const validId=id=>Number.isSafeInteger(id)&&id>=0&&id<64;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function invasionTier(team,z){
 if(!['ally','enemy'].includes(team)||!Number.isFinite(z))return 0;
 const canonical=team==='ally'?z:INVASION_RULES.mirrorZ-z;
 if(canonical>INVASION_RULES.boundary+1e-9)return 0;
 return clamp(1+Math.floor((INVASION_RULES.boundary-canonical+1e-9)/INVASION_RULES.rankSpacing),1,INVASION_RULES.tiers);
}
function actors(g){
 const list=(g.enemies||[]).filter(e=>e&&validId(e.id)&&e.id!==g.playerId);
 if(g.player&&validId(g.playerId))list.push({...g.player,id:g.playerId,team:'ally',piece:g.piece,hp:g.hp,alive:g.hp>0});
 // Stable IDs are identities, never slot numbers or role indexes. Last wins
 // defensively if a malformed snapshot contains duplicate NPC references.
 return [...new Map(list.map(e=>[e.id,e])).values()];
}
function ownSide(){return {frontier:0,creditedRanks:0,points:0,kingBonus:0};}
function grounded(e){return Number.isFinite(e.y??0)&&Math.abs(e.y??0)<.001;}
function alive(e){return e.alive===true&&(e.hp==null||Number.isFinite(e.hp)&&e.hp>0);}
function forced(e){return (e.stagger||0)>0;}
function snapshotRecord(e){
 const r={id:e.id,king:e.piece==='king',team:e.team||'enemy',wasForced:forced(e),wasAirborne:!grounded(e),ally:ownSide(),enemy:ownSide()};
 r[r.team].frontier=invasionTier(r.team,e.z);return r;
}
function createInvasion(g){
 const records=new Map();for(const e of actors(g))if(['ally','enemy'].includes(e.team||'enemy'))records.set(e.id,snapshotRecord(e));
 return {ruleset:INVASION_RULESET,enabled:g.scenario==='army'&&g.invasionScoring===true,points:0,rankPoints:0,kingBonus:0,finished:!!(battleEnded(g)),lastTime:Number.isFinite(g.time)?g.time:0,records,current:{ally:0,enemy:0},frontier:{ally:0,enemy:0}};
}
function updateInvasion(s,g){
 const awards=[];
 if(!s.enabled||s.finished)return {awards,completed:false};
 const terminal=!!(battleEnded(g));
 if(!Number.isFinite(g.time)||g.time<s.lastTime||g.time===s.lastTime&&!terminal)return {awards,completed:false};
 s.lastTime=g.time;s.current={ally:0,enemy:0};
 for(const e of actors(g)){
  const r=s.records.get(e.id),team=e.team||'enemy';
  if(!r||!['ally','enemy'].includes(team)||!Number.isFinite(e.z))continue;
  const side=r[team],tier=invasionTier(team,e.z),nowForced=forced(e),nowAirborne=!grounded(e);
  const terminalCleanup=terminal&&(r.wasForced||r.wasAirborne);
  r.wasForced=nowForced;r.wasAirborne=nowAirborne;
  if(r.team!==team){
   // Conversion starts at an observed baseline, never grants spawn points.
   // Side ledgers survive every ally -> enemy -> ally cycle.
   side.frontier=Math.max(side.frontier,tier);r.team=team;
   continue;
  }
  if(!alive(e))continue;
  if(!nowAirborne&&tier>0)s.current[team]++;
  if((e.spawnProtection||0)>0||!g.active&&!terminal){
   // First-seen, protected spawn, and pre-battle positions are baselines.
   side.frontier=Math.max(side.frontier,tier);continue;
  }
  // Jumps and shoves count only after settling alive. Captured flying bodies
  // never count; repeat entry of the same body cannot refill any credit.
  // finishBattle zeroes y/stagger: a previously unsettled actor is ambiguous
  // on the terminal sample, so conservatively omit its final crossing.
  if(nowForced||nowAirborne||terminalCleanup)continue;
  s.frontier[team]=Math.max(s.frontier[team],tier);
  if(tier<=side.frontier)continue;
  const previous=side.frontier;side.frontier=tier;
  if(team!=='ally')continue;
  for(let n=previous+1;n<=tier;n++){
   const points=INVASION_RULES.rankPoints;
   side.creditedRanks++;side.points+=points;s.rankPoints+=points;s.points+=points;
   awards.push({type:'invasion',team,id:e.id,tier:n,points,time:g.time});
  }
  if(r.king&&previous===0){
   const points=INVASION_RULES.kingEntryBonus;
   side.kingBonus+=points;side.points+=points;s.kingBonus+=points;s.points+=points;
   awards.push({type:'invasion',team,id:e.id,tier:'king-entry',points,time:g.time});
  }
 }
 if(terminal)s.finished=true;
 return {awards,completed:terminal};
}
function invasionSummary(s){
 return {enabled:s.enabled,points:s.points,rankPoints:s.rankPoints,kingBonus:s.kingBonus,allyInEnemyTerritory:s.current.ally,enemyInAlliedTerritory:s.current.enemy,allyFrontier:s.frontier.ally,enemyFrontier:s.frontier.enemy,finished:s.finished};
}

return {INVASION_RULESET,INVASION_RULES,invasionTier,createInvasion,updateInvasion,invasionSummary};})();
const CONTROL_SWITCH=(()=>{
  const COOLDOWNS = ['cooldown', 'sweepCooldown', 'stepCooldown', 'jumpCooldown'];
  const remain = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const validId = id => Number.isInteger(id) && id >= 0 && id <= 39;
  const hasPiece = (E, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(E.PIECES, key);
  const ground = body => Number.isFinite(body.y ?? 0) && Math.abs(body.y ?? 0) < .001;

  function promotionState(piece, basePiece, promoted, E) {
    const inverse = Object.keys(E.PIECES).find(key => E.PIECES[key].promote === piece);
    let base = basePiece || inverse || piece;
    base = Object.keys(E.PIECES).find(key => E.PIECES[key].promote === base) || base;
    if (!hasPiece(E, base) || !hasPiece(E, piece)) return null;
    const isPromoted = !!inverse || !!promoted;
    const effective = isPromoted && E.PIECES[base].promote ? E.PIECES[base].promote : base;
    // Conflicting metadata must not silently change a unit's effective piece.
    if (effective !== piece) return null;
    return { base, promoted: !!E.PIECES[base].promote && isPromoted, effective };
  }

  // Older idle NPCs may still have the generic forward facing, which is not
  // legal for a bishop. Preserve legal facing; otherwise pick the nearest
  // normalized legal direction (stable piece-table order resolves ties).
  function switchFacing(unit, effectivePiece, E) {
    const x = Number.isFinite(unit.aimDx) ? unit.aimDx : Number.isFinite(unit.dx) ? unit.dx : 0;
    const z = Number.isFinite(unit.aimDz) ? unit.aimDz : Number.isFinite(unit.dz) ? unit.dz : -1;
    const dirs = E.PIECES[effectivePiece].dirs;
    if (effectivePiece === 'knight' || !dirs.length) return { x: 0, z: -1 };
    const length = Math.hypot(x, z);
    const legal = dirs.find(([dx, dz]) => dx === Math.sign(x) && dz === Math.sign(z));
    if (length > 0 && legal) {
      const legalLength = Math.hypot(...legal);
      if (Math.abs(x / length - legal[0] / legalLength) < 1e-9
          && Math.abs(z / length - legal[1] / legalLength) < 1e-9) {
        return Math.abs(length - 1) < 1e-9 ? { x, z } : { x: x / length, z: z / length };
      }
    }
    let best = null, bestDot = -Infinity;
    for (const [dx, dz] of dirs) {
      const n = Math.hypot(dx, dz), face = { x: dx / n, z: dz / n };
      const dot = length > 0 ? (face.x * x + face.z * z) / length : 0;
      if (!best || dot > bestDot + 1e-12) { best = face; bestDot = dot; }
    }
    return best;
  }

  /** Empty string means valid. Never mutates the game, including on rejection. */
  function switchControlReason(g, id, E) {
    if (!g || !E?.PIECES || typeof E.pieceKey !== 'function') return 'invalid-state';
    if (!['army','switch_trial'].includes(g.scenario) || g.formationHero !== true) return 'army-only';
    if (isSpectator(g)) return 'spectator';
    if (battleEnded(g)) return 'battle-ended';
    if (!g.player || !Array.isArray(g.enemies)) return 'invalid-state';
    if (!validId(g.playerId) || g.player.id !== g.playerId) return 'invalid-identity';
    if (!validId(id)) return 'invalid-target';
    if (id === g.playerId) return 'already-controlled';
    if (g.battleScenario?.objective === 'protect' && id === g.battleScenario.protectedId) return 'protected-king';
    if (!(g.hp > 0) || g.player.alive === false) return 'hero-dead';
    if (g.mode !== 'ready' || g.guarding || !ground(g.player) || g.player.stagger > 0) return 'hero-busy';
    const identities = [g.playerId, ...g.enemies.map(unit => unit.id)];
    if (identities.some(key => !validId(key)) || new Set(identities).size !== identities.length) return 'invalid-identity';
    const matches = g.enemies.filter(unit => unit.id === id);
    if (matches.length !== 1) return 'target-missing';
    const unit = matches[0];
    if (unit.team !== 'ally') return 'target-enemy';
    if (!unit.alive || !(unit.hp > 0)) return 'target-dead';
    if (unit.trainingGuard) return 'training-unit';
    if (unit.attack !== 'idle' || !ground(unit) || unit.stagger > 0 || unit.guarding) return 'target-busy';
    if (!hasPiece(E, g.piece) || !hasPiece(E, unit.piece)) return 'invalid-piece';
    const oldEffective = E.pieceKey(g);
    if (!hasPiece(E, oldEffective) || !promotionState(unit.piece, unit.basePiece, unit.promoted, E)) return 'invalid-piece';
    for (const body of [g.player, unit]) {
      if (![body.x, body.z, body.homeX, body.homeZ].every(Number.isFinite)
          || !Number.isInteger(body.slotKey)) return 'invalid-position';
    }
    if (![g.hp, g.maxHp, unit.hp, unit.maxHp].every(Number.isFinite)
        || g.maxHp <= 0 || unit.maxHp <= 0) return 'invalid-health';
    return '';
  }

  function canSwitchControl(g, id, E) { return switchControlReason(g, id, E) === ''; }

  /** Swap only the selected array entry. Returns false without mutation on rejection. */
  function switchControl(g, id, E) {
    if (!canSwitchControl(g, id, E)) return false;
    const index = g.enemies.findIndex(unit => unit.id === id);
    const selected = g.enemies[index];
    const previous = g.player;
    const oldId = g.playerId;
    const piece = promotionState(selected.piece, selected.basePiece, selected.promoted, E);
    const incomingFacing = switchFacing(selected, piece.effective, E);
    const oldCooldowns = Object.fromEntries(COOLDOWNS.map(key => [key, remain(g[key])]));
    const saved = selected.heroCooldowns;
    const hasSaved = saved && COOLDOWNS.every(key => Number.isFinite(saved[key]));
    const needsNPCFloor = !hasSaved || selected.npcCooldownUsed !== false;
    const restored = Object.fromEntries(COOLDOWNS.map(key => [key,
      Math.max(hasSaved ? remain(saved[key]) : 0, needsNPCFloor ? remain(selected.attackCooldown) : 0)
    ]));
    const outgoing = {
      ...previous,
      id: oldId, team: 'ally', alive: true,
      piece: E.pieceKey(g), effectivePiece: E.pieceKey(g), basePiece: g.piece, promoted: !!g.promoted,
      x: previous.x, y: previous.y ?? 0, z: previous.z,
      dx: previous.dx, dz: previous.dz, aimDx: previous.dx, aimDz: previous.dz,
      slotKey: previous.slotKey, homeX: previous.homeX, homeZ: previous.homeZ,
      hp: g.hp, maxHp: g.maxHp, equipment: previous.equipment || g.teamStats?.ally.equipment || 'light',
      hurtFlash: remain(g.damageFlash), invulnerable: remain(g.invulnerable),
      spawnProtection: remain(previous.spawnProtection), transformUntil: g.transformUntil ?? 0,
      phase: Number.isFinite(previous.phase) ? previous.phase : 0,
      age: 0, vx: 0, vy: 0, vz: 0, angle: 0, spin: 0,
      attack: 'idle', attackTimer: 0, attackCooldown: Math.max(...Object.values(oldCooldowns)), attackReadySince: null,
      heroCooldowns: oldCooldowns, npcCooldownUsed: false, knightSide: g.knightSide === -1 ? -1 : 1,
      stagger: 0, staggerLife: 0, shoveX: 0, shoveZ: 0,
      chainDepth: 0, chainHitIds: [], reinforceTarget: null,
      pendingTeam: null, respawnAt: null, approachDir: null,
      intentTargetId: null, intentUntil: 0, intent: 'hold', targetX: previous.x, targetZ: previous.z,
      guarding: false, trainingGuard: false, chargeContact: false, stopAfterContact: false, contactWait: false
    };
    const incoming = {
      ...selected,
      id, team: 'ally', alive: true,
      piece: piece.effective, effectivePiece: piece.effective, basePiece: piece.base, promoted: piece.promoted,
      dx: incomingFacing.x, dz: incomingFacing.z,
      aimDx: incomingFacing.x, aimDz: incomingFacing.z,
      // Player damage checks use g.invulnerable; a nonzero spawnProtection on
      // the player would never tick in the existing engine and create immunity.
      spawnProtection: 0,
      attack: 'idle', attackTimer: 0, attackReadySince: null, stagger: 0, guarding: false,
      reinforceTarget: null, approachDir: null, intentTargetId: null, intentUntil: 0,
      pendingTeam: null, respawnAt: null, intent: 'hold', targetX: selected.x, targetZ: selected.z,
      chargeContact: false, stopAfterContact: false, contactWait: false
    };

    // All rejection checks and construction finish before the first write.
    npcForgetPromotionPerception(g,null,true);
    if (selected.reinforceTarget != null) {
      if (!Array.isArray(g.vacancies)) g.vacancies = [];
      if (!g.vacancies.includes(selected.reinforceTarget)) g.vacancies.push(selected.reinforceTarget);
    }
    npcResetCastleState(g,selected);npcResetCastleState(g,previous);npcResetCastleState(g,outgoing);npcResetCastleState(g,incoming);
    inheritHandicapTransfer(previous,outgoing);inheritHandicapTransfer(selected,incoming);
    g.enemies[index] = outgoing;
    g.player = incoming;
    g.playerId = id;
    g.heroSlotKey = incoming.slotKey;
    g.piece = piece.base;
    g.promoted = piece.promoted;
    g.hp = selected.hp;
    g.maxHp = selected.maxHp;
    g.invulnerable = Math.max(remain(selected.invulnerable), remain(selected.spawnProtection));
    g.damageFlash = remain(selected.hurtFlash);
    g.transformUntil = selected.transformUntil ?? 0;
    g.knightSide = selected.knightSide === -1 ? -1 : 1;
    for (const key of COOLDOWNS) g[key] = restored[key];
    g.mode = 'ready'; g.phase = 0; g.guarding = false; g.guardFlash = 0;
    g.chargeContact = false; g.waveLaunched = false; g.moveBlocked = false;
    g.sweepDirection = null; g.stepStart = null; g.stepEnd = null;
    g.jumpStart = null; g.jumpEnd = null; g.jumpLanded = false; g.jumpIsKnight = false;
    g.guardCache = {};
    for (const unit of g.enemies) {
      unit.intentTargetId = null; unit.intentUntil = 0; unit.approachDir = null;
      unit.intent = unit.attack === 'idle' ? 'hold' : unit.attack;
      unit.targetX = unit.x; unit.targetZ = unit.z;
    }
    // Existing waves, promotionPulse, formationSlots, clocks, statistics,
    // victory/defeat fields, hitstop, events, and active state are untouched in army.
    if(g.scenario==='switch_trial'&&g.switchLesson){if(id===g.switchLesson.allyActorId)g.switchLesson.switched=true;}
    return true;
  }
return {switchControlReason,canSwitchControl,switchControl};})();
const API={capturedReturnSummary,requestCapturedReturn,cancelCapturedReturn,BATTLE_SCENARIOS,BATTLE_SCENARIO_RULESET,battleScenarioDefinition,protectedScenarioKing,LANCE_ACTION_RULESET,AUTOMATIC_AWAKENING_RULESET,AWAKENING_ZONE_MIRROR_Z,automaticAwakening,inAwakeningZone,pendingAwakening,EQUIPMENT_CADENCE_RULESET,LIGHT_ATTACK_CADENCE,npcEquipmentTiming,npcEquipmentReload,npcOrdinaryReload,isSpectator,battleEnded,jumpLanding,DEFAULT_ARENA,STANDARD_ARMY_ARENA,ARMY_ARENA_RULESET,isStandardArmyArena,terrainLayout,arenaBounds,arenaContains,arenaClip,validateArena,installArena,heroHasAbility,actorHasAbility,capabilityInfo,CapabilityRuntime:CAP,NPC_SENSING,npcTacticalState,npcPost,THRUST,THRUST_FOLLOWUP_TIMINGS,thrustTiming,thrustExtension,thrustPoint,thrustPoses,heldThrustContact,normalizeTeamTactics,npcTacticsPlan,npcTacticsTarget,Terrain,KingPersonality,Invasion,KING_PERSONALITIES:KingPersonality.PERSONALITIES,normalizeKingPersonalities:KingPersonality.normalizePersonalities,npcAttackFacing,npcAttackKind,npcActionMayReach,switchControlReason:(g,id)=>CONTROL_SWITCH.switchControlReason(g,id,API),canSwitchControl:(g,id)=>CONTROL_SWITCH.canSwitchControl(g,id,API),switchControl:(g,id)=>CONTROL_SWITCH.switchControl(g,id,API),arenaTravel,npcChargeTravel,STRATEGIES,normalizeStrategies,nextLegalSegment,npcRoute,npcTarget,npcPursuitLimit,ENEMY_ZONE_Z,canGuard,setGuard,canAwaken,awaken,AGILITY,normalizeTeamStats,equipmentTeamStats,movementSpeed,HANDICAPS,handicapAllows,ACTIONS,canAction,clipRush,separateNPCPair,clearHeroLanding,sweptWaveHitsBody,DIFFICULTIES,MAX_NPCS,RESPAWN_DELAY,WALK_SPEED,RUN_SPEED,CHARGE_SPEED,FILE_SPACING,RANK_SPACING,COUNT,STEP_DISTANCE,SWEEP_DURATION,SWEEP_WINDUP,SWEEP_HIT_START,SWEEP_HIT_END,PIECES,FORMATIONS,JUMP_DURATION,JUMP_HEIGHT,JUMP_DISTANCE,pieceKey,pieceInfo,allowed,enemyDirection,isStepDirection,direction,knightJump,create,cardinal,aim,cancel,charge,sweep,thrust,jump,dragonStep,step,MAX_WAVES,HERO_HEIGHT,HERO_RADIUS,ENEMY_HEIGHT,ENEMY_RADIUS,spawnWave,waveHitsBody,distanceSegment};if(typeof module!=='undefined')module.exports=API;root.BattleEngine=API;
})(typeof window!=='undefined'?window:globalThis);
