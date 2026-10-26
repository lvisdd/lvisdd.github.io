// Presentation-side points and same-settings records. No simulation writes.
// Bump RULESET whenever scoring, speed, hit geometry or NPC rules change.
export const CHALLENGE_RULESET = 'capture-battle-royal-duty-v1';
export const ARMY_ROYAL_RULESET = 'capture-battle-royal-planning-v1';
export const ARMY_COORDINATION_RULESET = 'capture-battle-army-coordination-v1';
export const AUTOMATIC_AWAKENING_RULESET='automatic-enemy-camp-v1';
// Horse/dragon now walk in every direction; retain older record buckets.
export const ARMY_AUTOMATIC_AWAKENING_RULESET='capture-battle-auto-awakening-v4';
// Sensed strategy-driven armies use the recruited-assault march allowance.
export const ARMY_RECRUITED_MARCH_RULESET='capture-battle-recruited-march-v1';
export const RECRUIT_MARCH_RULESET='capture-battle-recruit-march-lesson-v1';
// Initial-assault continuation and return search change both armies; preserve old record buckets.
export const ARMY_ASSAULT_MARCH_SEARCH_RULESET='capture-battle-assault-march-search-v1';
export const RECRUIT_ASSAULT_MARCH_SEARCH_RULESET='capture-battle-recruit-march-search-lesson-v1';
// Visible knight target repair changes both armies; retain all prior generations.
export const ARMY_KNIGHT_VISIBLE_ADVANCE_RULESET='capture-battle-knight-visible-advance-v1';
export const RECRUIT_KNIGHT_VISIBLE_ADVANCE_RULESET='capture-battle-recruit-knight-visible-advance-v1';
// Live-king guard duty affects strategy armies with or without NPC sensing.
export const ARMY_LIVE_KING_GUARD_RULESET='capture-battle-live-king-guards-v1';
export const RECRUIT_LIVE_KING_GUARD_RULESET='capture-battle-recruit-live-king-guards-v1';
// Valid same-life perception persists across native NPC promotion in sensed automatic armies.
export const ARMY_PROMOTION_PERCEPTION_RULESET='capture-battle-promotion-perception-v1';
// Potential strict lateral royal alignment has its own combined AI generation.
export const ARMY_ROYAL_LATERAL_TRACKING_RULESET='capture-battle-royal-lateral-tracking-v1';
export const LESSON_AUTOMATIC_AWAKENING_RULESET='capture-battle-auto-awakening-lesson-v1';
export const EQUIPMENT_CADENCE_RULESET = 'light-hp2-cadence-v1';
export const LANCE_ACTION_RULESET = 'lance-charge-only-v1';
export const HANDICAP_RESERVE_RULESET='handicap-enemy-reserve-v2';
export const RECORDS_KEY = 'capture-battle-records-v1';
export const MAX_RECORDS = 40;
export const POINT_RULES = Object.freeze({hit:100, thrustStep:25, thrustBonusCap:75, slashExtra:50, comboSeconds:1.35});
const SCENARIO_V1_IDS=['first_sortie','two_raiders','three_bridges','lone_legend','royal_guard','pawn_rebellion'];
const SCENARIO_IDS=[...SCENARIO_V1_IDS,'lance_line','king_command'];
function validBattleScenarioTuple(a){if(!Array.isArray(a)||a.length!==7)return false;if(['final-siege-anaguma-pawn-followon-v1','final-siege-bogin-file2-v1'].includes(a[0]))return a[1]==='final_siege'&&a[2]==='king'&&a[3]===0&&a[4]===null&&a[5]===(a[0]==='final-siege-bogin-file2-v1'?8:6)&&a[6]===20;if(['final-siege-hp5-v1','final-siege-anaguma-hp3-v1'].includes(a[0]))return a[1]==='final_siege'&&a[2]==='king'&&a[3]===0&&a[4]===null&&a[5]===4&&a[6]===20;const current=(a[0]==='piece-scenarios-bishop-castle-duty-v1'&&a[1]==='lone_legend')||(a[0]==='piece-scenarios-pawn-bank-rook-v1'&&a[1]==='pawn_rebellion')||(a[0]==='piece-scenarios-bishop-crossfire-v1'&&a[1]==='lone_legend')||(a[0]==='piece-scenarios-knight-castle-v1'&&a[1]==='three_bridges')||(a[0]==='piece-scenarios-knight-files-v1'&&a[1]==='three_bridges')||(a[0]==='piece-scenarios-rook-castle-v1'&&a[1]==='first_sortie')||(a[0]==='piece-scenarios-early-castles-v1'&&a[1]==='two_raiders')||(a[0]==='piece-scenarios-pawn-front-v1'&&a[1]==='pawn_rebellion')||(a[0]==='piece-scenarios-castles-v1'&&['lance_line','lone_legend'].includes(a[1]))||a[0]==='piece-scenarios-v3'||a[0]==='piece-scenarios-v2',legacy=a[0]==='army-scenarios-v1';return (current||legacy)&&(current?SCENARIO_IDS:SCENARIO_V1_IDS).includes(a[1])&&a[2]===(a[1]==='royal_guard'?'protect':'king')&&a[3]===(a[1]==='royal_guard'?30:0)&&(a[1]==='royal_guard'?actorId(a[4]):a[4]===null)&&Number.isInteger(a[5])&&a[5]>=1&&a[5]<=(current?5:3)&&Number.isInteger(a[6])&&a[6]>=3&&a[6]<=20;}
function battleScenarioSnapshot(g){const d=Object.getOwnPropertyDescriptor(g,'battleScenario');if(!d)return null;if(!Object.hasOwn(d,'value')||!plain(d.value))return ['invalid'];const m=d.value,read=k=>{const p=Object.getOwnPropertyDescriptor(m,k);return p&&Object.hasOwn(p,'value')?p.value:undefined;};const a=['version','id','objective','duration','protectedId','initialAllies','initialEnemies'].map(read);return validBattleScenarioTuple(a)?a:['invalid'];}
const MAX_POINTS=1000000000, MAX_TIME_MS=604800000, MAX_WAVES=128, MAX_ACTORS=64;
const actorId=x=>Number.isSafeInteger(x)&&x>=0&&x<MAX_ACTORS;
const waveId=x=>Number.isSafeInteger(x)&&x>0;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const finiteTime=x=>Number.isFinite(x)&&x>=0&&x<=MAX_TIME_MS/1000;
const actionKind=x=>x==='sweep'?'slash':x;
const validKind=x=>['thrust','slash','charge','burst'].includes(x);
const scalar=x=>typeof x==='string'||typeof x==='boolean'||Number.isFinite(x)?x:null;
const invasionEnabled=g=>g.scenario==='army'&&g.invasionScoring===true;
const teamSnapshot=(g,team)=>{const s=g.teamStats?.[team];return s?[scalar(s.hp),scalar(s.equipment),scalar(s.agility)]:null;};

// Call only at create/reset, BEFORE control switching can change g.piece/heroSlotKey.
// Cosmetic seed, camera, audio and effects are deliberately excluded. Switching
// remains a legal player choice; automatic awakening belongs to the ruleset.
// A bounded, independent experimental namespace; never downgrade malformed
// follow-up metadata to the standard record identity.
function followupRecordSnapshot(g){
 const descriptor=Object.getOwnPropertyDescriptor(g,'followupLoadout');if(!descriptor)return null;if(!Object.hasOwn(descriptor,'value'))return ['invalid-followup-config'];const f=descriptor.value;if(!f||typeof f!=='object'||Array.isArray(f))return ['invalid-followup-config'];
 // Read only plain data descriptors; malformed metadata cannot invoke accessors
 // or silently borrow a standard challenge identity.
 const get=key=>{const d=Object.getOwnPropertyDescriptor(f,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
 const version=get('version'),id=get('actorId'),actions=get('actions'),limit=get('stageLimit'),buffer=get('bufferSeconds'),lifetime=get('queueLifetime');
 const valid=(version==='ground-followup-v1'||version==='ground-combo-v2'||version==='ground-combo-thrust-v3')&&actorId(id)&&Array.isArray(actions)&&actions.length>=1&&actions.length<=3&&new Set(actions).size===actions.length&&actions.every(a=>['thrust','sweep','charge'].includes(a))&&Number.isInteger(limit)&&limit>=2&&limit<=3&&Number.isFinite(buffer)&&buffer>=.05&&buffer<=.25&&Number.isFinite(lifetime)&&lifetime>=buffer&&lifetime<=(version!=='ground-followup-v1'?1.5:.75);
 if(!valid)return ['invalid-followup-config'];
 const base=[version,id,[...actions].sort(),limit,buffer,lifetime];
 if(version==='ground-followup-v1')return base;
 const chargeLimit=get('chargeStageLimit'),recovery=get('finisherRecovery'),window=get('queueWindow'),start=get('queueStart');
 if(!(chargeLimit===3&&window==='after-start'&&Number.isFinite(start)&&start>=.05&&start<=.2&&Number.isFinite(recovery)&&recovery>=0&&recovery<=.3))return ['invalid-followup-config'];
 const result=[...base,chargeLimit,recovery,window,start];if(version==='ground-combo-v2')return result;
 const timing=get('thrustTimingProfile'),thrustRecovery=get('profiledThrustFinisherRecovery'),clock=get('queueClock');
 return timing==='three-hit-thrust-v1'&&thrustRecovery===0&&clock==='profile-phase-v1'&&actions.includes('thrust')?[...result,timing,thrustRecovery,clock]:['invalid-followup-config'];
}
// Arena edges change legal choices. Keep each optional rectangle/version
// separate from old practice records, even when passed the full-size bounds.
function arenaRecordSnapshot(g){
 const d=Object.getOwnPropertyDescriptor(g,'arena');if(!d)return null;
 if(!Object.hasOwn(d,'value')||!d.value||typeof d.value!=='object'||Array.isArray(d.value))return ['invalid-arena-config'];
 const keys=['minX','maxX','minZ','maxZ'],a=d.value,values=[];
 for(const key of keys){const field=Object.getOwnPropertyDescriptor(a,key);if(!field||!Object.hasOwn(field,'value')||!Number.isFinite(field.value))return ['invalid-arena-config'];values.push(field.value);}
 return Reflect.ownKeys(a).length===4&&values[0]<values[1]&&values[2]<values[3]?values:['invalid-arena-config'];
}
// Timing/HP revisions use a new army-only identity. Existing records remain
// in the same book and tutorials keep their previous keys. Invalid declared
// metadata must not silently fall back to an older balance namespace.
function equipmentCadenceSnapshot(g){
 if(g.scenario!=='army')return null;
 const d=Object.getOwnPropertyDescriptor(g,'equipmentCadenceRuleset');if(!d)return null;
 return Object.hasOwn(d,'value')&&d.value===EQUIPMENT_CADENCE_RULESET?d.value:'invalid-equipment-cadence';
}
// Potential activation, not the current phase or controlled/live king. A king
// can become autonomous after a control swap; equipment/strategy do not gate it.
function armyCoordinationEligible(g){
 return g.scenario==='army'&&g.formationHero===true&&g.npcSensing===true&&['ally','enemy'].some(team=>['midgame','endgame'].includes(g.kingPersonalities?.[team]));
}
// Automatic entry changes army decisions and the awakening lesson objective.
// Read actual immutable engine metadata; absent legacy rules keep their keys.
// Malformed declarations get a quarantined key, never a legacy record identity.
// Native normal-lance action changes affect both NPC teams and controlled actors.
function lanceActionSnapshot(g){
 if(g.scenario!=='army')return null;
 const d=Object.getOwnPropertyDescriptor(g,'lanceActionRuleset');if(!d)return null;
 return Object.hasOwn(d,'value')&&d.value===LANCE_ACTION_RULESET?d.value:'invalid-lance-actions';
}
function automaticAwakeningSnapshot(g){
 if(g.scenario!=='army'&&g.scenario!=='awaken_trial')return null;
 const d=Object.getOwnPropertyDescriptor(g,'automaticAwakeningRuleset');if(!d)return null;
 return Object.hasOwn(d,'value')&&d.value===AUTOMATIC_AWAKENING_RULESET?d.value:'invalid-automatic-awakening';
}
// The optional initial handicap transfer changes only its own record bucket.
// All three immutable engine fields must be present together; malformed declarations
// never fall back to an OFF record, and getters are never evaluated here.
const HANDICAP_RESERVE_COUNTS=Object.freeze({lance:1,bishop:1,rook:1,rook_lance:2,two:2,four:4,six:6,eight:8,ten:10,nineteen:19});
function handicapReserveCount(handicap,piece){return handicap==='solo'?(piece==='king'?19:18):Object.hasOwn(HANDICAP_RESERVE_COUNTS,handicap)?HANDICAP_RESERVE_COUNTS[handicap]:null;}
function validHandicapReserveConfig(scenario,formationHero,handicap,piece,heroSlotKey,allies,count){return scenario==='army'&&formationHero===true&&Number.isInteger(heroSlotKey)&&heroSlotKey>=0&&heroSlotKey<20&&Number.isInteger(count)&&count===handicapReserveCount(handicap,piece)&&(handicap!=='nineteen'||piece==='king')&&allies===(handicap==='solo'?0:19-count);}
function handicapReserveSnapshot(g){
 const rules=Object.getOwnPropertyDescriptor(g,'handicapReserveRuleset'),count=Object.getOwnPropertyDescriptor(g,'initialEnemyReserveCount'),mode=Object.getOwnPropertyDescriptor(g,'handicapEnemyDeployment');
 if(!rules&&!count&&!mode&&!('handicapReserveRuleset' in g)&&!('initialEnemyReserveCount' in g)&&!('handicapEnemyDeployment' in g))return null;
 const immutable=d=>d&&Object.hasOwn(d,'value')&&d.writable===false&&d.configurable===false&&d.enumerable===true;
 return immutable(rules)&&immutable(count)&&immutable(mode)&&['reserve','promoted-start'].includes(mode.value)&&rules.value===HANDICAP_RESERVE_RULESET&&g.controlMode!=='spectator'&&!('battleScenario' in g)&&g.trainingLesson==null&&validHandicapReserveConfig(g.scenario,g.formationHero,g.handicap,g.piece,g.heroSlotKey,g.allyCount,count.value)?[rules.value,count.value,mode.value]:['invalid-handicap-reserve'];
}
// OFF preserves the selected AI generation through a bounded prefix map; the
// normal key must first pass the unchanged validator. Unknown/accessor/mutable metadata and explicit custom rulesets are
// quarantined with a non-string prefix, so they cannot borrow normal records.
const CAPTURED_RETURN_RULESET='capture-battle-v124-held-ally-v1';
const PROMOTION_CAPTURED_RETURN_RULESET='capture-battle-promotion-perception-held-ally-v1';
const ROYAL_TRACKING_CAPTURED_RETURN_RULESET='capture-battle-royal-lateral-tracking-held-ally-v1';
function capturedReturnRecordRuleset(ruleset){return ruleset===ARMY_ROYAL_LATERAL_TRACKING_RULESET?ROYAL_TRACKING_CAPTURED_RETURN_RULESET:ruleset===ARMY_PROMOTION_PERCEPTION_RULESET?PROMOTION_CAPTURED_RETURN_RULESET:CAPTURED_RETURN_RULESET;}
function capturedReturnPolicySnapshot(g){
 const d=Object.getOwnPropertyDescriptor(g,'capturedReturnPolicy');if(!d)return 'capturedReturnPolicy' in g?false:null;
 if(!Object.hasOwn(d,'value')||d.writable!==false||d.configurable!==false||d.enumerable!==true||!plain(d.value)||!Object.isFrozen(d.value)||Reflect.ownKeys(d.value).length!==3||g.scenario!=='army'||g.formationHero!==true||g.controlMode==='spectator')return false;
 const expected={version:'held-ally-v1',ally:'manual-type',enemy:'automatic-v124'};
 return Object.keys(expected).every(key=>{const field=Object.getOwnPropertyDescriptor(d.value,key);return field&&Object.hasOwn(field,'value')&&field.value===expected[key]&&field.enumerable===true&&field.writable===false&&field.configurable===false;});
}
export function challengeKey(g,ruleset=CHALLENGE_RULESET){
 // Arbitrary explicit custom rulesets retain their identity. The one known
 // recruitment lesson shares army AI and gets its own non-saving replay key.
 const automatic=automaticAwakeningSnapshot(g),liveKingGuards=g.scenario==='army'&&!!g.strategies,promotionPerception=g.scenario==='army'&&g.npcSensing===true&&automatic===AUTOMATIC_AWAKENING_RULESET;
 const recordRuleset=ruleset!==CHALLENGE_RULESET?(liveKingGuards&&ruleset==='capture-battle-v49-recruit-lesson-v1'?RECRUIT_LIVE_KING_GUARD_RULESET:ruleset):armyCoordinationEligible(g)?ARMY_ROYAL_LATERAL_TRACKING_RULESET:promotionPerception?ARMY_PROMOTION_PERCEPTION_RULESET:liveKingGuards?ARMY_LIVE_KING_GUARD_RULESET:automatic?(g.scenario==='army'?ARMY_AUTOMATIC_AWAKENING_RULESET:LESSON_AUTOMATIC_AWAKENING_RULESET):armyCoordinationEligible(g)?ARMY_COORDINATION_RULESET:g.scenario==='army'&&g.formationHero===true&&g.kingPersonalities&&equipmentCadenceSnapshot(g)===EQUIPMENT_CADENCE_RULESET?ARMY_ROYAL_RULESET:ruleset;
 const roster=(g.enemies||[]).map(e=>[scalar(e.id),scalar(e.slotKey),scalar(e.team||'enemy'),scalar(e.piece),scalar(e.maxHp??e.hp??1)]).sort((a,b)=>a[0]-b[0]);
 const key=[recordRuleset,scalar(g.scenario),scalar(g.piece),!!g.formationHero,scalar(g.heroSlotKey),scalar(g.handicap),scalar(g.allyCount),scalar(g.allyFormation),scalar(g.formationKey),scalar(g.difficulty),scalar(g.maxHp),teamSnapshot(g,'ally'),teamSnapshot(g,'enemy'),g.strategies?[scalar(g.strategies.ally),scalar(g.strategies.enemy)]:null,roster,!!g.kingFlags,g.kingPersonalities?[scalar(g.kingPersonalities.ally),scalar(g.kingPersonalities.enemy)]:null,invasionEnabled(g)];if(g.controlMode==='spectator')key.push('spectator-unsaved-v1');if(g.terrain==='three_bridges')key.push('three_bridges');const t=g.teamTactics;if(g.scenario==='army'&&t&&['ally','enemy'].some(team=>t[team]?.cellSize!==1||t[team]?.focus!=='balanced'))key.push(['tactics',t.ally.cellSize,t.ally.focus,t.enemy.cellSize,t.enemy.focus]);if(g.scenario==='army'&&g.npcSensing===true)key.push('sensing-v1');if(g.capabilityLoadout)key.push(['experimental-capabilities',g.capabilityLoadout.canonical]);const followup=followupRecordSnapshot(g);if(followup)key.push(['experimental-ground-followup',followup]);const arena=arenaRecordSnapshot(g);if(arena){const standard=g.scenario==='army'&&g.formationHero===true&&g.armyArenaRuleset==='standard-square-army-v1'&&JSON.stringify(arena)==='[-19,19,-4,34]';if(!standard)key.push(['experimental-authored-arena-v1',arena]);}const equipment=equipmentCadenceSnapshot(g);if(equipment)key.push(['equipment-cadence',equipment]);if(automatic)key.push(['automatic-awakening',automatic]);const lance=lanceActionSnapshot(g);if(lance)key.push(['lance-actions',lance]);const mission=battleScenarioSnapshot(g);if(mission)key.push(['battle-scenario',mission]);const reserve=handicapReserveSnapshot(g);if(reserve)key.push(['handicap-enemy-reserve',...reserve]);const encoded=JSON.stringify(key),held=capturedReturnPolicySnapshot(g);if(held===null)return encoded;key[0]=held&&ruleset===CHALLENGE_RULESET&&validKey(encoded)?capturedReturnRecordRuleset(recordRuleset):['unsavable-held-ally-v1',key[0]];return JSON.stringify(key);
}
export function createChallenge(g,ruleset=CHALLENGE_RULESET){
 const held=capturedReturnPolicySnapshot(g);return {...(g.controlMode==='spectator'||held!==null&&(!held||ruleset!==CHALLENGE_RULESET)?{recordEligible:false}:{}),key:challengeKey(g,ruleset),points:0,hitPoints:0,thrustBonus:0,slashBonus:0,invasionPoints:0,invasionEnabled:invasionEnabled(g),invasionSeen:new Set(),invasionActors:new Set([g.playerId,...(g.enemies||[]).map(e=>e.id)].filter(actorId)),invasionKings:new Set([...(g.piece==='king'?[g.playerId]:[]),...(g.enemies||[]).filter(e=>e.piece==='king').map(e=>e.id)].filter(actorId)),hits:0,bestThrust:0,bestSlash:0,elapsed:0,finished:false,won:false,finishMs:null,chain:0,lastThrust:null,lastRelease:null,waves:new Map(),retired:new Set(),expiredWaveId:0};
}
function breakChain(s){s.chain=0;s.lastThrust=null;}
// This input-side hint covers immediate step-slash release events which the
// engine clears at the next step. Call only after an action actually succeeds.
export function noteChallengeAction(s,kind){if(!s.finished&&kind!=='thrust')breakChain(s);}
function getWave(s,event){
 if(!waveId(event.waveId)||event.waveId<=s.expiredWaveId||!actorId(event.sourceId))return null;
 const kind=actionKind(event.action??event.kind);if(!validKind(kind))return null;
 let w=s.waves.get(event.waveId);
 if(w)return w.kind===kind&&w.sourceId===event.sourceId?w:null;
 w={kind,sourceId:event.sourceId,hits:new Set(),released:false};s.waves.set(event.waveId,w);
 if(s.waves.size>MAX_WAVES){const oldest=Math.min(...s.waves.keys());s.expiredWaveId=Math.max(s.expiredWaveId,oldest);s.waves.delete(oldest);if(oldest===event.waveId)return null;}
 return w;
}
function add(s,field,value){const increment=Math.max(0,Math.min(value,MAX_POINTS-s.points));s[field]+=increment;s.points+=increment;return increment;}

// Events must carry their own simulated timestamp so render batching does not
// change streaks. The engine's hit/HP checks remain the sole damage authority.
export function consumeChallengeEvents(s,events){
 const bonuses=[];if(s.finished)return bonuses;
 for(const ev of events||[]){
  // Army progress is an independent bounded subtotal, not a personal hit.
  // Stable IDs survive switching/conversion; each allied actor/tier pays once.
  if(ev.type==='invasion'){
   if(!s.invasionEnabled||ev.team!=='ally'||!actorId(ev.id)||!s.invasionActors.has(ev.id)||!finiteTime(ev.time))continue;
   const king=ev.tier==='king-entry',expected=king?150:[1,2,3].includes(ev.tier)?50:null;
   if(expected===null||ev.points!==expected||king&&!s.invasionKings.has(ev.id))continue;
   const key=`${ev.id}:${ev.tier}`;if(s.invasionSeen.has(key))continue;
   s.invasionSeen.add(key);const points=add(s,'invasionPoints',expected);
   if(points)bonuses.push({type:'invasion',points,id:ev.id,tier:ev.tier,time:ev.time});
   continue;
  }
  if(ev.type==='player_hit'){breakChain(s);continue;}
  if(ev.type==='attack_release'&&ev.personal===true){
   const w=getWave(s,ev);if(!w||w.released)continue;w.released=true;
   const previous=s.lastRelease&&s.waves.get(s.lastRelease);
   if(w.kind!=='thrust'||previous&&previous.hits.size===0)breakChain(s);
   s.lastRelease=ev.waveId;continue;
  }
  const capture=ev.type==='hit'||ev.type==='npc_hit';
  if(!capture&&ev.type!=='npc_damage')continue;
  // An actor's first enemy life is the scoring budget. Repeated conversion
  // captures cannot farm points; a friendly NPC's enemy capture retires it too.
  if(ev.team!=='enemy'||!actorId(ev.id))continue;
  const retired=s.retired.has(ev.id);
  if(!retired&&ev.type!=='npc_hit'&&ev.personal===true&&finiteTime(ev.time)){
   const w=getWave(s,ev);
   if(w&&!w.hits.has(ev.id)){
    // A thrust/charge wave can damage only one actor; reject malformed extras.
    if(!(['thrust','charge'].includes(w.kind)&&w.hits.size)){
     w.hits.add(ev.id);s.hits++;add(s,'hitPoints',POINT_RULES.hit);
     if(w.kind==='thrust'){
      const last=s.lastThrust,gap=last?ev.time-last.time:Infinity;
      const follows=last&&last.sourceId===ev.sourceId&&last.waveId!==ev.waveId&&gap>=-1e-9&&gap<=POINT_RULES.comboSeconds+1e-9;
      s.chain=follows?s.chain+1:1;s.lastThrust={sourceId:ev.sourceId,waveId:ev.waveId,time:ev.time};s.bestThrust=Math.max(s.bestThrust,s.chain);
      const points=add(s,'thrustBonus',Math.min(POINT_RULES.thrustBonusCap,(s.chain-1)*POINT_RULES.thrustStep));
      if(points)bonuses.push({type:'thrust',points,count:s.chain,time:ev.time,waveId:ev.waveId,sourceId:ev.sourceId});
     }else{
      breakChain(s);
      if(w.kind==='slash'){
       s.bestSlash=Math.max(s.bestSlash,w.hits.size);
       if(w.hits.size>1){const points=add(s,'slashBonus',POINT_RULES.slashExtra);if(points)bonuses.push({type:'slash',points,count:w.hits.size,time:ev.time,waveId:ev.waveId,sourceId:ev.sourceId});}
      }
     }
    }
   }
  }
  if(capture)s.retired.add(ev.id);
 }
 return bonuses;
}

// g.time already includes hitstop and pre-input waiting after sortie. Pause,
// settings, map, background and lobby do not step. >.25s render stalls are
// clipped upstream: this is simulated battle time, not a wall-clock stopwatch.
export function updateChallenge(s,g){
 if(s.finished)return {bonuses:[],completed:false};
 const bonuses=consumeChallengeEvents(s,g.events);
 const terminal=!!(g.won||g.lost||g.draw),time=terminal?(g.draw?g.drawTime:g.won?g.winTime:g.lossTime):g.time;
 if(finiteTime(time))s.elapsed=time;
 if(terminal){s.finished=true;s.won=!!g.won;s.finishMs=finiteTime(time)?Math.round(time*1000):null;breakChain(s);return {bonuses,completed:true};}
 return {bonuses,completed:false};
}
export function formatBattleTime(seconds){
 if(!finiteTime(seconds))return '—';
 const tenths=Math.floor((seconds+1e-8)*10),minutes=Math.floor(tenths/600);
 return `${minutes}:${String(Math.floor(tenths/10)%60).padStart(2,'0')}.${tenths%10}`;
}
export function bonusText(bonus){if(bonus.type==='invasion')return `${bonus.tier==='king-entry'?'王の進軍':'軍勢の侵攻'} +${bonus.points}`;return bonus.type==='thrust'?`突き ${bonus.count}連続 +${bonus.points}`:`斬る ${bonus.count}体 +${bonus.points}`;}
export function challengeBreakdown(s){const parts=[`命中 ${s.hitPoints}`];if(s.thrustBonus)parts.push(`連続突き ${s.thrustBonus}`);if(s.slashBonus)parts.push(`斬る・複数命中 ${s.slashBonus}`);if(s.invasionPoints)parts.push(`軍勢の侵攻 ${s.invasionPoints}`);return parts.join(' ＋ ');}

const PIECES=['pawn','lance','knight','silver','gold','bishop','rook','king','tokin','promoted_lance','promoted_knight','promoted_silver','horse','dragon'];
const FORMATIONS=['initial','yagura','mino','anaguma'], SCENARIOS=['army','duel','squad','thrust_trial','slash_trial','charge_trial','jump_trial'];
const HANDICAPS=['solo','even','lance','bishop','rook','rook_lance','two','four','six','eight','ten','nineteen'];
const hp=x=>Number.isSafeInteger(x)&&x>0&&x<=100;
const slot=x=>x===null||Number.isSafeInteger(x)&&x>=0&&x<20;
const teamStats=x=>x===null||Array.isArray(x)&&x.length===3&&[1,2,3,5].includes(x[0])&&['light','heavy'].includes(x[1])&&['slow','normal','fast'].includes(x[2]);
const tacticsKey=x=>Array.isArray(x)&&x.length===5&&x[0]==='tactics'&&[1,2,3].includes(x[1])&&[1,2,3].includes(x[3])&&[x[2],x[4]].every(v=>['balanced','center','left','right'].includes(v));
function validExtras(a){if(a.length<18||a.length>26)return false;let i=18,mission=false;if(a[i]==='three_bridges')i++;if(tacticsKey(a[i])){if(a[1]!=='army')return false;i++;}if(a[i]==='sensing-v1'){if(a[1]!=='army')return false;i++;}if(Array.isArray(a[i])&&a[i].length===2&&a[i][0]==='equipment-cadence'&&a[i][1]===EQUIPMENT_CADENCE_RULESET){if(a[1]!=='army')return false;i++;}if(Array.isArray(a[i])&&a[i].length===2&&a[i][0]==='automatic-awakening'&&a[i][1]===AUTOMATIC_AWAKENING_RULESET){if(a[1]!=='army')return false;i++;}if(Array.isArray(a[i])&&a[i].length===2&&a[i][0]==='lance-actions'&&a[i][1]===LANCE_ACTION_RULESET){if(a[1]!=='army')return false;i++;}if(Array.isArray(a[i])&&a[i].length===2&&a[i][0]==='battle-scenario'){const m=a[i][1];if(a[1]!=='army'||!validBattleScenarioTuple(m))return false;mission=true;i++;}if(Array.isArray(a[i])&&a[i].length===4&&a[i][0]==='handicap-enemy-reserve'&&a[i][1]===HANDICAP_RESERVE_RULESET&&['reserve','promoted-start'].includes(a[i][3])){if(mission||!validHandicapReserveConfig(a[1],a[3],a[5],a[2],a[4],a[6],a[i][2]))return false;i++;}return i===a.length;}
function validKey(k){
 if(typeof k!=='string'||k.length>8192)return false;
 try{
  const a=JSON.parse(k);
  return Array.isArray(a)&&(validExtras(a)&&typeof a[17]==='boolean'||a.length===17&&a[0]==='capture-battle-v22-combat-points-v1')&&JSON.stringify(a)===k&&typeof a[0]==='string'&&/^capture-battle-[a-zA-Z0-9-]{1,80}$/.test(a[0])&&SCENARIOS.includes(a[1])&&PIECES.includes(a[2])&&typeof a[3]==='boolean'&&slot(a[4])&&(a[5]===null||HANDICAPS.includes(a[5]))&&Number.isSafeInteger(a[6])&&a[6]>=0&&a[6]<=20&&FORMATIONS.includes(a[7])&&FORMATIONS.includes(a[8])&&['easy','normal','hard'].includes(a[9])&&hp(a[10])&&teamStats(a[11])&&teamStats(a[12])&&(a[13]===null||Array.isArray(a[13])&&a[13].length===2&&a[13].every(x=>['balanced','aggressive','defensive'].includes(x)))&&Array.isArray(a[14])&&a[14].length<=MAX_ACTORS&&a[14].every(r=>Array.isArray(r)&&r.length===5&&actorId(r[0])&&slot(r[1])&&['ally','enemy'].includes(r[2])&&PIECES.includes(r[3])&&hp(r[4]))&&new Set(a[14].map(r=>r[0])).size===a[14].length&&typeof a[15]==='boolean'&&(a[16]===null||Array.isArray(a[16])&&a[16].length===2&&a[16].every(x=>['defensive','midgame','endgame'].includes(x)));
 }catch{return false;}
}
const validScore=x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX_POINTS;
const validTime=x=>x===null||Number.isSafeInteger(x)&&x>=0&&x<=MAX_TIME_MS;
function validRecord(r){return plain(r)&&validKey(r.key)&&validScore(r.bestScore)&&validTime(r.bestTimeMs);}
function validBook(b){return plain(b)&&b.version===1&&Array.isArray(b.records)&&b.records.length<=MAX_RECORDS&&b.records.every(validRecord)&&new Set(b.records.map(r=>r.key)).size===b.records.length;}
const emptyBook=()=>({version:1,records:[]});
export function loadChallengeRecords(storage){
 try{const raw=storage?.getItem(RECORDS_KEY);if(typeof raw!=='string'||raw.length>400000)return emptyBook();const book=JSON.parse(raw);if(!validBook(book))return emptyBook();return {version:1,records:book.records.map(({key,bestScore,bestTimeMs})=>({key,bestScore,bestTimeMs}))};}catch{return emptyBook();}
}
export function saveChallengeRecords(storage,book){
 if(!validBook(book)||typeof storage?.setItem!=='function')return false;
 try{storage.setItem(RECORDS_KEY,JSON.stringify(book));return true;}catch{return false;}
}
export function challengeRecord(book,key){return validBook(book)?book.records.find(r=>r.key===key)||null:null;}
// Score best includes completed defeats; speed best requires victory. Aborted
// retries/menu exits cannot submit. Return a new bounded MRU book, without I/O.
export function recordChallenge(book,s){
 if(s?.recordEligible===false)return {book:validBook(book)?book:emptyBook(),record:null,accepted:false,newScore:false,newTime:false};
 const previous=challengeRecord(book,s.key),valid=s.finished&&validKey(s.key)&&validScore(s.points)&&Number.isSafeInteger(s.finishMs)&&validTime(s.finishMs);
 if(!valid)return {book:validBook(book)?book:emptyBook(),record:previous,newScore:false,newTime:false,accepted:false};
 const newScore=!previous||s.points>previous.bestScore,newTime=!!s.won&&(previous?.bestTimeMs==null||s.finishMs<previous.bestTimeMs);
 const record={key:s.key,bestScore:Math.max(previous?.bestScore??0,s.points),bestTimeMs:newTime?s.finishMs:previous?.bestTimeMs??null};
 const records=[record,...(validBook(book)?book.records:[]).filter(r=>r.key!==s.key)].slice(0,MAX_RECORDS);
 return {book:{version:1,records},record,newScore,newTime,accepted:true};
}
