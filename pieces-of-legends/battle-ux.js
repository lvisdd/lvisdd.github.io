// Pure presentation helpers; never alter simulation or enable a prohibited action.
export function actionReadiness(E,g,action){
 const key=E.pieceKey(g),names={sweep:'斬る',thrust:'突く',charge:'突撃',jump:'跳ぶ'},name=names[action];
 const enabled=E.heroHasAbility?E.heroHasAbility(g,action):E.ACTIONS[key].includes(action);
 if(!enabled&&E.ACTIONS[key].includes(action))return {state:'disabled',label:'設定で OFF',name,remaining:0};
 if(!enabled)return {state:'unavailable',label:'この駒では不可',name,remaining:0};
 if(g.won||g.lost)return {state:'ended',label:'終了',name,remaining:0};
 if(g.guarding)return {state:'guarding',label:'防御中',name,remaining:0};
 if(action==='charge'&&!E.canAction(g,action))return {state:'direction',label:key==='horse'?'斜めを向く':'縦横を向く',name,remaining:0};
 const cooldown=action==='charge'?g.cooldown:action==='jump'?g.jumpCooldown:g.sweepCooldown;
 const busy=action==='charge'?['windup','charge','dragon','jump','thrust'].includes(g.mode):action==='jump'?g.mode!=='ready':['dragon','jump'].includes(g.mode);
 const remaining=Math.max(cooldown||0,busy?(g.phase||0):0);
 if(remaining>0)return {state:'cooldown',label:(Math.ceil(remaining*10)/10).toFixed(1)+'秒',name,remaining};
 if(action==='jump'&&E.jumpLanding){const landing=E.jumpLanding(g);if(!landing.allowed)return {state:'blocked',label:landing.reason==='outside-arena'?'着地点が場外':'着地点が無効',name,remaining:0};}
 return {state:'ready',label:{sweep:'範囲内の複数',thrust:'最初の1体',charge:'駒で停止',jump:'前衛を越える'}[action],name,remaining:0};
}
export function kingGuide(g){
 if(g.controlMode==='spectator'){const kings=['ally','enemy'].map(team=>{const k=g.enemies.find(e=>e.alive&&e.team===team&&e.piece==='king');return k?(team==='ally'?'味方王 ':'敵王 ')+(k.hp??1)+'/'+(k.maxHp||1):'';}).filter(Boolean);return {text:kings.join(' ／ '),danger:false};}
 if(g.won||g.lost)return {text:g.won?'勝利':'敗北',danger:false};
 if(g.scenario==='switch_trial')return {text:g.playerId===g.switchLesson?.allyActorId?'金将で敵の歩兵を倒す':'戦況から金将へ操作を交代する',danger:false};
 if(g.scenario==='guard_trial')return {text:'防御で攻撃を1回受け止める',danger:false};
 if(g.scenario==='awaken_trial')return {text:g.promoted?'覚醒後の斬るを当てる':'敵陣に入ると自動覚醒',danger:false};
 if(g.scenario!=='army')return {text:'敵を全て倒す',danger:false};
 if(g.battleScenario?.objective==='protect'){const k=g.playerId===g.battleScenario.protectedId?{...g.player,hp:g.hp,maxHp:g.maxHp}:g.enemies.find(e=>e.id===g.battleScenario.protectedId),danger=!!k&&g.enemies.some(e=>e.alive&&e.team==='enemy'&&['windup','charge','leap'].includes(e.attack)&&Math.hypot(e.x-k.x,e.z-k.z)<8);const index=k?(Math.round(Math.atan2(k.x-g.player.x,g.player.z-k.z)/(Math.PI/4))+8)%8:0;return {text:k&&k.alive?'護衛する王 '+(g.playerId===g.battleScenario.protectedId?'自分 ':['↑','↗','→','↘','↓','↙','←','↖'][index]+' ')+(k.hp??1)+'/'+(k.maxHp||1)+(danger?' · 危険':''):'王将が倒れた',danger};}
 const king=g.enemies.find(e=>e.alive&&e.team==='enemy'&&e.piece==='king');if(!king)return {text:g.won?'敵王討ち取り':'敵王を探す',danger:false};
 const dx=king.x-g.player.x,dz=king.z-g.player.z,index=(Math.round(Math.atan2(dx,-dz)/(Math.PI/4))+8)%8;
 const ownKing=g.piece==='king'?g.player:g.enemies.find(e=>e.alive&&e.team==='ally'&&e.piece==='king');
 const danger=!!ownKing&&g.enemies.some(e=>e.alive&&e.team==='enemy'&&['windup','charge','leap'].includes(e.attack)&&Math.hypot(e.x-ownKing.x,e.z-ownKing.z)<8);
 const arrows=['↑','↗','→','↘','↓','↙','←','↖'],ownIndex=ownKing?(Math.round(Math.atan2(ownKing.x-g.player.x,g.player.z-ownKing.z)/(Math.PI/4))+8)%8:0;
 // Keep royal HP beside the existing destination, even when its model is offscreen.
 // The controlled king already has the main hero health display.
 const health=unit=>(unit.hp??1)+'/'+(unit.maxHp||1);
 return {text:'敵王 '+arrows[index]+' '+health(king)+(ownKing&&ownKing!==g.player?'\n味方王 '+arrows[ownIndex]+' '+health(ownKing):'')+(danger?'\n味方王が危険':''),danger};
}
const MAP_ARENA=Object.freeze({minX:-19,maxX:19,minZ:-24,maxZ:34});
// Callers rendering an actual game pass E.arenaBounds(g). Four-argument
// callers retain the historical default projection.
export function mapPoint(x,z,width,height,arena=null,uniform=false){const a=arena||MAP_ARENA,dx=a.maxX-a.minX,dz=a.maxZ-a.minZ,px=Math.max(a.minX,Math.min(a.maxX,x))-a.minX,pz=Math.max(a.minZ,Math.min(a.maxZ,z))-a.minZ;if(uniform){const scale=Math.min((width-12)/dx,(height-12)/dz);return {x:(width-dx*scale)/2+px*scale,y:(height-dz*scale)/2+pz*scale};}return {x:6+px/dx*(width-12),y:6+pz/dz*(height-12)};}
export function reinforcementSummary(g){if(g.won||g.lost||g.draw||g.scenario!=='army')return '';return ['ally','enemy'].map(team=>{const pending=g.enemies.filter(e=>!e.alive&&e.pendingTeam===team);if(!pending.length)return '';const seconds=Math.max(0,Math.min(...pending.map(e=>(e.respawnAt||0)-g.time)));return (team==='ally'?'味方':'敵')+'待ち '+pending.length+'体（次：'+(seconds<=0?'配置待ち':Math.ceil(seconds)+'秒')+'）';}).filter(Boolean).join(' ／ ');}
export function loadPreferences(storage){try{const p=JSON.parse(storage?.getItem('capture-battle-preferences-v1')||'null');return p&&p.version===1&&typeof p==='object'?p:{};}catch{return {};}}
export function savePreferences(storage,p){try{storage?.setItem('capture-battle-preferences-v1',JSON.stringify({version:1,...p}));return true;}catch{return false;}}

// OFF-only presentation reads the public ticket snapshot, never actor ownership.
// A ready selection is reserved until the next native revival phase; if its
// canonical home is blocked, describe that wait without promising a safe spawn.
export const CAPTURED_RETURN_TYPES=Object.freeze(['pawn','lance','knight','silver','gold','bishop','rook']);
export function capturedReturnPresentation(E,g,summary){
 if(!summary?.enabled)return {enabled:false,total:0,types:[],selected:null,state:'automatic',text:''};
 const tickets=summary.tickets,selected=tickets.find(t=>t.token===summary.selectedToken)||null;
 const types=CAPTURED_RETURN_TYPES.map(piece=>({piece,count:tickets.filter(t=>t.piece===piece).length,selected:selected?.piece===piece}));
 let state='held',text=tickets.length?'種類を選ぶと1体を出撃予約':'捕獲した駒はまだありません';
 if(selected){
  const remaining=Math.max(0,selected.readyAt-g.time),homes=g.formationSlots?.filter(h=>h.team===selected.owner&&h.slotKey===selected.slotKey)||[],home=homes.length===1?homes[0]:null;
  const legal=!!home&&(!g.arena||E.arenaContains(g,home))&&(g.terrain!=='three_bridges'||E.Terrain.passable(home,'river'))&&(!g.player||Math.hypot(home.x-g.player.x,home.z-g.player.z)>=2.3)&&!g.enemies.some(e=>e.id!==selected.id&&e.alive&&Math.hypot(e.x-home.x,e.z-home.z)<1.5);
  state=remaining>0?'preparing':legal?'reserved':'blocked';
  text=E.PIECES[selected.piece].name+' · '+(state==='preparing'?'出撃予約・準備中 '+Math.ceil(remaining)+'秒':state==='blocked'?'出撃予約・配置待ち':'出撃予約・自動配置を待っています');
 }
 return {enabled:true,total:tickets.length,types,selected,state,text};
}
