// Tutorial objectives observe ordinary combat. They never mutate the engine.
export function createActionLessonRecord(kind){
 if(!['guard_trial','awaken_trial'].includes(kind))throw new RangeError('Unknown action lesson');
 return {kind,status:'playing',endedAt:null,blocks:0,awakened:false,awakenedAt:null,hits:0,hitEvent:null};
}
// Credit only an actual automatic entry-promotion event emitted by the engine.
// Merely assigning a promoted flag or an NPC promotion is never lesson credit.
export function noteLessonAwakening(record,g){
 if(record?.kind!=='awaken_trial'||record.status!=='playing'||record.awakened||g.scenario!==record.kind||g.piece!=='pawn'||!g.promoted||!g.events.some(e=>e.type==='promote'&&e.automatic===true&&e.id===g.playerId&&e.team==='ally'&&e.from==='pawn'&&e.piece==='tokin'))return false;
 record.awakened=true;record.awakenedAt=g.time;return true;
}
export function updateActionLessonRecord(record,g){
 if(!record||record.status!=='playing'||g.scenario!==record.kind)return false;
 if(record.kind==='awaken_trial')noteLessonAwakening(record,g);
 if(record.kind==='guard_trial')record.blocks+=g.events.filter(e=>e.type==='guard_block').length;
 if(record.kind==='awaken_trial'&&record.awakened&&g.promoted){
  const hit=g.events.find(e=>(e.type==='hit'||e.type==='npc_damage')&&e.personal===true&&e.team==='enemy'&&e.action==='slash'&&Number.isInteger(e.waveId)&&e.sourceId===g.playerId);
  if(hit){record.hits++;record.hitEvent={...hit};}
 }
 const complete=record.kind==='guard_trial'?record.blocks>0:record.awakened&&record.hits>0;
 const status=g.lost?'failed':complete?'complete':!g.enemies.some(e=>e.alive&&e.team==='enemy')?'exhausted':null;
 if(!status)return false;record.status=status;record.endedAt=g.time;return true;
}
export function actionLessonHint(record,g,E){
 if(!record||record.status!=='playing')return '';
 if(record.kind==='guard_trial')return g.guarding?'そのまま長押しで攻撃を防ぐ':'「防御」を長押しして待つ';
 if(!record.awakened)return E.pendingAwakening(g)?'動作・着地の後に自動覚醒':g.player.z>E.ENEMY_ZONE_Z?'↑で赤い線を越えると自動覚醒':'成金へ自動覚醒';
 if(g.promotionPulse)return '「攻撃」が斬りに変化・防御が解禁';
 return '敵に近づいて「攻撃」で斬る';
}
export function actionLessonMission(record,g){
 if(record.status==='complete')return record.kind==='guard_trial'?'防御成功！':'覚醒後の斬るが命中！';
 if(record.status==='failed')return '体力がなくなった';
 if(record.status==='exhausted')return '課題はまだ未達成';
 return record.kind==='guard_trial'?'防御で攻撃を1回受け止める':record.awakened?'新しい「攻撃」で斬るを1回当てる':'敵陣に入って自動覚醒する';
}
export function actionLessonResult(record){
 const guard=record.kind==='guard_trial',complete=record.status==='complete';
 return {
  title:complete?(guard?'攻撃を受け止めた。':'覚醒の一撃、命中。'):record.status==='exhausted'?(guard?'倒す前に、防御しよう。':'覚醒後の「攻撃」で斬るを試そう。'):'もう一度、挑もう。',
  reason:complete?'':record.status==='failed'?'操作中の駒の体力がなくなりました。':guard?'敵がいなくなりました。防御で受け止めた回数はまだ0回です。':'敵がいなくなりました。覚醒後の斬るの命中はまだ0回です。',
  detail:guard?'防御成功 '+record.blocks+'回 · 長押し中は移動・攻撃できません。':'自動覚醒 '+(record.awakened?1:0)+'回 · 覚醒後の斬る '+record.hits+'回命中。'
 };
}
