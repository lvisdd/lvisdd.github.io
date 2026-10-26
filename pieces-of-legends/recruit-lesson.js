// Isolated proposed sixth lesson. Army combat/capture rules remain authoritative.
export function createRecruitLesson(E,seed,options={}){
 const g=E.create(seed,'king','initial',{scenario:'army',formationHero:true,deferArmyArena:true,handicap:'solo',heroHp:3,difficulty:'normal',terrain:'plain',npcSensing:true,trainingLesson:'recruit',teamStats:{ally:{hp:1,equipment:'light',agility:'normal'},enemy:{hp:1,equipment:'light',agility:'normal'}},strategies:E.normalizeStrategies(null),teamTactics:E.normalizeTeamTactics(null),kingPersonalities:E.normalizeKingPersonalities(null)});
 // Author the lesson before sealing its own compact arena; it is not an army sortie.
 // Advance two enemy deployments; preserve their stable slots and every
 // corresponding reappearance destination. Their normal defensive posts
 // match these authored starts, so neither enemy's attack is disabled.
 g.enemies=g.enemies.filter(e=>e.id===15||e.id===9);
 Object.assign(g.enemies.find(e=>e.id===15),{x:0,z:15,homeX:0,homeZ:15});
 Object.assign(g.enemies.find(e=>e.id===9),{x:0,z:10.2,homeX:0,homeZ:10.2});
 Object.assign(g.player,{x:0,z:18,homeX:0,homeZ:18});
 if(options.arena!==undefined)E.installArena(g,options.arena);
 return g;
}
export function createRecruitRecord(){return {status:'playing',endedAt:null,joined:new Set(),waves:new Set(),contacts:new Set(),hits:0,hitEvent:null};}
export function updateRecruitRecord(record,g){
 if(!record||record.status!=='playing')return false;
 for(const ev of g.events){
  if(ev.type==='reinforce'&&ev.team==='ally')record.joined.add(ev.id);
  if(['npc_hit','npc_damage'].includes(ev.type)&&ev.team==='enemy'&&ev.personal===false&&record.joined.size>0&&Number.isInteger(ev.sourceId)&&Number.isInteger(ev.waveId)&&!record.contacts.has(ev.waveId+':'+ev.id)){
   record.contacts.add(ev.waveId+':'+ev.id);record.waves.add(ev.waveId);record.hits++;record.hitEvent={...ev};
  }
 }
 for(const w of g.waves)if(w.team==='player'&&w.ownerId!=null&&record.joined.size>0)record.waves.add(w.id);
 const status=g.lost?'failed':record.hits>0?'complete':g.score>0&&!g.enemies.some(e=>e.alive&&e.team==='enemy'||!e.alive&&e.pendingTeam==='enemy')?'exhausted':null;
 if(!status)return false;record.status=status;record.endedAt=g.time;return true;
}
export function recruitHint(g,record,E){
 if(!record||record.status!=='playing')return '';
 if(!g.score&&!record.joined.size)return '手前の歩兵を「攻撃」で斬る';
 const pending=g.enemies.find(e=>!e.alive&&e.pendingTeam==='ally'),allied=g.enemies.some(e=>e.alive&&e.team==='ally'),canProtect=!['pawn','lance','knight'].includes(E?E.pieceKey(g):g.piece);
 if(!allied&&pending){const slot=g.formationSlots.find(s=>s.team==='ally'&&s.slotKey===pending.slotKey);
  if(g.time>=pending.respawnAt&&slot&&Math.hypot(g.player.x-slot.x,g.player.z-slot.z)<2.3)return '横へ移動して、仲間の場所を空ける';
  return canProtect?'防御を長押しして仲間を待つ':'仲間の合流を待つ';
 }
 if(!allied)return '敵を倒して仲間を迎える';
 return canProtect?'防御で仲間の前を守る':'仲間の進路を空ける';
}
