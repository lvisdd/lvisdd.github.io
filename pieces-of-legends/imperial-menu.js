// Read-only preparation preview, using the same map as the paused tactical view.
import {createCompactLesson,COMPACT_LESSON_BOARDS} from './compact-lesson-boards.mjs';
import {tacticalMapState,tacticalMapLayout,tacticalMapMarkup} from './tactical-map.mjs';
export const LESSON_PIECES=Object.freeze(Object.fromEntries(Object.entries(COMPACT_LESSON_BOARDS).map(([id,board])=>[id,board.piece])));
export function makePreview(E,values){
 const practice=values.scenario!=='army',scenario=practice&&LESSON_PIECES[values.scenario]?values.scenario:'army';
 const piece=practice?LESSON_PIECES[scenario]||'pawn':values.piece;
 const g=scenario!=='army'?createCompactLesson(E,1,scenario):E.create(1,piece,values.enemyFormation,{scenario,battleScenario:values.battleScenario,controlMode:values.controlMode,formationHero:true,handicap:values.handicap,allyFormation:values.allyFormation,terrain:values.terrain,heroHp:3,difficulty:'normal',handicapToEnemyReserve:values.handicapToEnemyReserve===true,handicapEnemyDeployment:values.handicapEnemyDeployment==='promoted-start'?'promoted-start':'reserve'});
 return {enemyReserveCount:g.handicapEnemyDeployment==='reserve'?(g.initialEnemyReserveCount||0):0,scenario,arena:E.arenaBounds(g),piece:g.piece,terrain:g.terrain||'plain',bodyRadius:E.HERO_RADIUS,hero:g.player?{...g.player}:null,units:g.enemies.filter(e=>e.alive).map(e=>({x:e.x,z:e.z,piece:e.piece,team:e.team||'enemy'})),name:E.PIECES[g.piece].name,bridges:E.Terrain.BRIDGES,river:E.Terrain.LAYOUT.river,mapState:tacticalMapState(E,g)};
}
export function previewLayout(m){
 const layout=tacticalMapLayout(m.mapState),{point,scaleX,scaleZ}=layout;
 return {...layout,board:m.arena,scale:scaleX,x:v=>point(v,m.arena.minZ).x,y:v=>point(m.arena.minX,v).y,bodyRadius:m.bodyRadius*Math.min(scaleX,scaleZ)};
}
export function previewLocator(m){if(!m.hero)return null;const q=tacticalMapLayout(m.mapState).point(m.hero.x,m.hero.z);return [[q.x,q.y-5],[q.x-4,q.y+4],[q.x+4,q.y+4]];}
export function previewKings(m){
 const kings=m.units.filter(u=>u.piece==='king').map(u=>({...u,hero:false}));
 if(m.hero&&m.piece==='king')kings.push({x:m.hero.x,z:m.hero.z,piece:'king',team:'ally',hero:true});
 return kings;
}
// Retain the read-only position helper. Kings are now drawn at their actual
// positions, without detached badges or leader lines.
export function previewKingBadges(m,layout=previewLayout(m)){return previewKings(m).map(k=>({...k,anchor:{x:layout.x(k.x),y:layout.y(k.z)},centre:{x:layout.x(k.x),y:layout.y(k.z)},box:null,size:8,radius:4*Math.SQRT2}));}
export function previewKingLabel(king,m){
 const A=m.arena,cx=(A.minX+A.maxX)/2,cz=(A.minZ+A.maxZ)/2;
 const horizontal=Math.abs(king.x-cx)<(A.maxX-A.minX)/6?'中央':king.x<cx?'左':'右';
 const vertical=Math.abs(king.z-cz)<(A.maxZ-A.minZ)/6?'中央':king.z<cz?'上':'下';
 return `${king.team==='ally'?'味方':'敵'}の王将${king.hero?'（自分）':''}：図の${vertical}${horizontal==='中央'&&vertical==='中央'?'':horizontal}`;
}
// Equal painted area (36 map units²) balances the sparse lesson markers:
// a 6×6 soldier, a rotated 6×6 king, and the canonical 8×9 player triangle.
// Full-army preparation and the actual tactical Canvas retain their old sizes.
export const LESSON_PREVIEW_MARKERS=Object.freeze({unitSize:6,kingRadius:3});
export function previewMarkup(m){return tacticalMapMarkup(m.mapState,120,144,null,m.scenario==='army'?undefined:LESSON_PREVIEW_MARKERS);}
export function bindImperialMenu(doc,E,Observer=globalThis.MutationObserver){
 const lobby=doc.getElementById('lobby'),figure=doc.getElementById('campaign-preview'),map=doc.getElementById('campaign-map');
 if(!lobby||!figure||!map||!E)return null;
 const value=id=>doc.getElementById(id)?.value;
 let last='',hintScenario=null;
 function update(){
  // Keep optional map refreshes from closing a hint within the same chapter.
  const context=lobby.hidden?null:value('scenario-choice')==='army'?value('battle-scenario-choice'):null;
  if(context!==hintScenario){const hints=doc.getElementById('battle-scenario-hints');if(hints)hints.open=false;hintScenario=context;}
  if(lobby.hidden)return;
  const values={handicapToEnemyReserve:doc.getElementById('handicap-reserve')?.checked===true&&!doc.getElementById('handicap-reserve')?.disabled,handicapEnemyDeployment:value('handicap-enemy-deployment'),battleScenario:value('scenario-choice')==='army'?value('battle-scenario-choice')||'free':undefined,controlMode:value('control-mode'),scenario:value('scenario-choice'),piece:value('piece-choice'),enemyFormation:value('formation-choice'),allyFormation:value('ally-formation'),handicap:value('handicap-choice'),terrain:value('terrain-choice')};
  const signature=JSON.stringify(values);if(signature===last)return;
  try{
   const m=makePreview(E,values),allies=m.units.filter(u=>u.team==='ally').length,enemies=m.units.filter(u=>u.team==='enemy').length;
   const practice=m.scenario!=='army';lobby.dataset.menuRoute=practice?'tutorial':'preparation';
   doc.getElementById('campaign-caption').textContent=practice?'練習の配置':'開始配置';
   doc.getElementById('map-ally-count').textContent=String(allies);
   doc.getElementById('map-enemy-count').textContent=String(enemies)+(m.enemyReserveCount?' ＋待機'+m.enemyReserveCount:'');
   doc.getElementById('map-piece-name').textContent=m.name;const heroKey=doc.getElementById('map-hero-key');if(heroKey)heroKey.hidden=!m.hero;
   doc.getElementById('map-terrain-name').textContent=m.terrain==='three_bridges'?'川と3つの橋':'平地';
   const terrainKey=doc.getElementById('map-terrain-key');if(terrainKey)terrainKey.hidden=m.terrain!=='three_bridges';
   const kings=previewKings(m),markedKings=kings.filter(k=>!k.hero);
   const kingKey=doc.getElementById('map-king-key');if(kingKey)kingKey.hidden=!markedKings.length;
   map.setAttribute('aria-label',`${practice?'練習':'出撃'}の開始配置。味方NPC${allies}枚、敵NPC${enemies}枚。${m.enemyReserveCount?'敵の持ち駒として待機'+m.enemyReserveCount+'枚。':''}${m.hero?'主人公1枚は'+m.name+'（NPC数には含みません）':'観戦（全員NPC）'}。青は味方、朱赤は敵。四角は兵、ひし形は王将、白い三角は自分（王将を操作するときも三角）。${m.terrain==='three_bridges'?'濃い青が川、黄土色が橋。':''}${kings.map(k=>previewKingLabel(k,m)).join('。')}${!practice&&!kings.some(k=>k.team==='ally')?'。味方の王将はいません。':''}`);
   map.innerHTML=previewMarkup(m);figure.hidden=false;last=signature;
  }catch(error){last='';figure.hidden=true;console.warn('Optional starting-position diagram is unavailable.',error);}
 }
 const change=e=>{if(lobby.contains(e.target))update();};doc.addEventListener('change',change);
 const observer=Observer?new Observer(update):null;observer?.observe(lobby,{attributes:true,attributeFilter:['hidden']});
 update();return {update,disconnect(){doc.removeEventListener('change',change);observer?.disconnect();}};
}


// Existing battle.js owns route changes and its initial focus. This layer only
// keeps keyboard navigation in the currently visible modal and restores the
// underlying document when both menus close.
export function bindMenuFocus(doc,Observer=globalThis.MutationObserver){
 const game=doc.getElementById('game'),menus=['start-menu','lobby'].map(id=>doc.getElementById(id));
 if(!game||menus.some(n=>!n))return null;
 let active=null,lastOutside=null,redirecting=false;const previousInert=new Map();
 const visible=el=>{
  if(!el||el.disabled)return false;
  for(let p=el;p;p=p.parentElement){
   if(p.hidden||p.hasAttribute?.('inert'))return false;
   if(p.tagName==='DETAILS'&&!p.open){const summary=Array.from(p.children).find(c=>c.tagName==='SUMMARY');if(!summary?.contains(el))return false;}
  }
  return typeof el.getClientRects!=='function'||el.getClientRects().length>0;
 };
 const items=menu=>Array.from(menu.querySelectorAll('button,a[href],select,input,textarea,summary,[tabindex]')).filter(el=>el.tabIndex>=0&&visible(el));
 function release(){for(const [el,had]of previousInert){if(had)el.setAttribute('inert','');else el.removeAttribute('inert');}previousInert.clear();}
 function isolate(menu){for(const child of Array.from(game.children)){if(!previousInert.has(child))previousInert.set(child,child.hasAttribute('inert'));if(child===menu){if(!previousInert.get(child))child.removeAttribute('inert');}else child.setAttribute('inert','');}}
 function focusFirst(menu,last=false){const targets=items(menu);(last?targets.at(-1):targets[0])?.focus({preventScroll:true});}
 function update(){
  const error=doc.getElementById('error'),next=error&&!error.hidden?null:menus.find(n=>!n.hidden)||null;
  if(next===active)return;
  const old=active;release();active=next;
  if(active){
   const current=doc.activeElement;if(current&&!menus.some(m=>m.contains(current))&&current!==doc.body)lastOutside=current;
   isolate(active);if(!active.contains(doc.activeElement))focusFirst(active);
  }else if(old&&(!error||error.hidden)&&(!doc.activeElement||doc.activeElement===doc.body||old.contains(doc.activeElement))){
   // Leaving preparation starts a sortie. A focused menu-opening button
   // would steal Space from the game's charge shortcut.
   let target=old.id==='lobby'?doc.getElementById('world'):(visible(lastOutside)?lastOutside:doc.getElementById('world'));
   if(target&&visible(target)){const temporaryTabindex=target.tagName==='CANVAS'&&!target.hasAttribute('tabindex');if(temporaryTabindex)target.setAttribute('tabindex','-1');target.focus({preventScroll:true});if(temporaryTabindex)target.removeAttribute('tabindex');}
  }
 }
 function keydown(e){
  if(e.key!=='Tab'||e.altKey||e.ctrlKey||e.metaKey)return;
  update();if(!active)return;
  const targets=items(active);if(!targets.length)return;
  const i=targets.indexOf(doc.activeElement),next=e.shiftKey?(i<=0?targets.length-1:i-1):(i+1)%targets.length;
  e.preventDefault();targets[next].focus();
 }
 function focusin(e){
  update();if(!active){if(e.target!==doc.body)lastOutside=e.target;return;}
  if(!active.contains(e.target)&&!redirecting){redirecting=true;focusFirst(active);redirecting=false;}
 }
 doc.addEventListener('keydown',keydown);doc.addEventListener('focusin',focusin);
 const observer=Observer?new Observer(update):null;for(const menu of menus)observer?.observe(menu,{attributes:true,attributeFilter:['hidden']});
 const error=doc.getElementById('error');if(error)observer?.observe(error,{attributes:true,attributeFilter:['hidden']});
 update();return {update,disconnect(){release();observer?.disconnect();doc.removeEventListener('keydown',keydown);doc.removeEventListener('focusin',focusin);active=null;}};
}
if(typeof document!=='undefined'){bindImperialMenu(document,globalThis.BattleEngine);bindMenuFocus(document);}
