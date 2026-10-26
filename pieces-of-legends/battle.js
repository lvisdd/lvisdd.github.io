// Production entrypoint: development-only controls cannot be enabled by saved settings.
const DEVELOPMENT_OPTIONS=false;
import {createTacticalControlMap} from './tactical-control-map.mjs';
import {createEscortBraceTelegraph} from './escort-brace-telegraph.mjs';
import {tacticalMapState,drawTacticalMap} from './tactical-map.mjs';
import {COMPACT_LESSON_BOARDS} from './compact-lesson-boards.mjs';
import {createDioramaBoard} from './diorama-board.mjs';
import {applyImperialTexture,applyImperialCombatInk} from './imperial-materials.mjs';
import {createFollowupRuntime} from './followup-runtime.mjs';
import {createUiFollowupPolicy} from './ui-followup-policy.mjs';
import {samuraiMotionProfile} from './samurai-motion-profile.js';
import {createActionLessonRecord,updateActionLessonRecord,actionLessonHint,actionLessonMission,actionLessonResult} from './action-lessons.mjs';
import {createRecruitLesson,createRecruitRecord,updateRecruitRecord,recruitHint} from './recruit-lesson.js';
import {createNpcFacing,npcCombatFacingTargets} from './npc-facing.js';
import {createHeroHitFeedback} from './hero-hit-feedback.js';
import {createEnvironmentArt,createBoundaryArt} from './environment-art.mjs';
import {createNpcHitReactions} from './npc-hit-reaction.js';
import {npcBodyColor} from './npc-body-color.js';
import {createMasteryFeedback,selectMasteryFeedback} from './battle-rewards.js';
import {createChallenge,noteChallengeAction,updateChallenge,loadChallengeRecords,saveChallengeRecords,challengeRecord,recordChallenge,formatBattleTime,bonusText,challengeBreakdown} from './battle-challenges.js';
import {advanceSimulation} from './battle-clock.js';
import {actionReadiness,kingGuide,reinforcementSummary,loadPreferences,savePreferences,CAPTURED_RETURN_TYPES,capturedReturnPresentation} from './battle-ux.js';
import * as THREE from './vendor/three.module.min.js';
import { createHandEffects } from './hand-effects.js';
import {createWeaponAccents} from './weapon-accents.js';
import { loadSamuraiModels } from './samurai-models.js';
const $=id=>document.getElementById(id),E=window.BattleEngine;
let preferenceStorage;try{preferenceStorage=window.localStorage;}catch{}
function showFailure(message){$('model-loading').hidden=true;$('lobby').hidden=true;$('start-menu').hidden=true;$('tactics-panel').hidden=true;$('error').hidden=false;$('error-text').textContent=message;}
let renderer;try{renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance',alpha:false});}catch(error){showFailure('3D描画を開始できませんでした。Safariを更新して、再読み込みしてください');throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
let renderDirty=true;const scene=new THREE.Scene();scene.background=new THREE.Color('#202938');scene.fog=null;
const escortBraceTelegraph=createEscortBraceTelegraph(THREE,scene);
let selectedDevEscortBrace=false;
$('dev-escort-brace').checked=false;$('dev-escort-brace').disabled=!DEVELOPMENT_OPTIONS;
const camera=new THREE.PerspectiveCamera(47,1,.15,150);scene.add(new THREE.HemisphereLight('#c1cbe1','#353846',1.7));const sun=new THREE.DirectionalLight('#ffe0b2',2.6);sun.position.set(-14,24,8);scene.add(sun);
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.89,metalness:0,...extra});
const wood=mat('#d3b98a'),heroWood=mat('#e8bd71'),limb=mat('#59473b'),iron=mat('#263b3c'),red=mat('#88392e'),gold=mat('#caa254',{roughness:.45,metalness:.38}),steel=mat('#f2ead9',{roughness:.28,metalness:.7});
const armor=mat('#294e50',{roughness:.6,metalness:.28}),armorLight=mat('#447476',{roughness:.62,metalness:.2}),ink=mat('#171e20'),ivory=mat('#ffefc4');
const groundCanvas=document.createElement('canvas');groundCanvas.width=groundCanvas.height=256;let ctx=groundCanvas.getContext('2d');ctx.fillStyle='#51596b';ctx.fillRect(0,0,256,256);let rs=23;function random(){rs=(Math.imul(rs,1664525)+1013904223)>>>0;return rs/4294967296;}for(let i=0;i<9500;i++){const q=random();ctx.fillStyle=q>.5?'#eee5d1':'#cfc2a6';ctx.globalAlpha=.08+random()*.17;ctx.fillRect(random()*256,random()*256,1+random()*3,1+random()*2);}const groundTex=new THREE.CanvasTexture(groundCanvas);groundTex.wrapS=groundTex.wrapT=THREE.RepeatWrapping;groundTex.repeat.set(22,22);groundTex.colorSpace=THREE.SRGBColorSpace;
const boardArt=createDioramaBoard(THREE,{layout:{...E.Terrain.LAYOUT,arena:E.STANDARD_ARMY_ARENA},onReady:()=>{renderDirty=true;}});scene.add(boardArt.root);
const groundMaterial=mat('#ffffff',{map:groundTex,roughness:1}),hazeRGB=new THREE.Vector3(116/255,122/255,104/255);groundMaterial.customProgramCacheKey=()=> 'diorama-ground-v1';const ground=terrainSurface([[boardArt.top.minX,boardArt.top.maxX,boardArt.top.minZ,boardArt.top.maxZ]],-.025,groundMaterial);ground.name='finite-board-playing-surface';scene.add(ground);boardArt.bindSurface(ground);
boardArt.styleGround(groundMaterial);
// Slate and square cell seams are supplied by boardArt; no tiled grid image.
let terrainScene=null,terrainArt=null;
function terrainSurface(rects,y,material){const positions=[],uv=[];for(const [x0,x1,z0,z1] of rects){for(const [x,z] of [[x0,z0],[x0,z1],[x1,z1],[x0,z0],[x1,z1],[x1,z0]]){positions.push(x,y,z);uv.push((x+110)/220,(110-z)/134);}}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();return new THREE.Mesh(geo,material);}
function syncTerrainScene(){boardArt.setArena(E.arenaBounds(g));const active=g.terrain==='three_bridges';if(active&&!terrainScene){terrainArt=createEnvironmentArt(THREE,{layout:E.terrainLayout(g),groundMaterial,surface:terrainSurface,boardBounds:boardArt.top,onReady:()=>{renderDirty=true;}});terrainScene=terrainArt.root;scene.add(terrainScene);}ground.visible=!active;if(terrainScene)terrainScene.visible=active;renderDirty=true;lastTactics=-1;}
let backdropState='ready';const backdrop=new THREE.Group();backdrop.name='diorama-surround';scene.add(backdrop);
// The arena has physical perimeter markers and a real perspective horizon.
const box=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(.16,.2,1,6),sphere=new THREE.IcosahedronGeometry(1,0);
function mesh(geo,material,x,y,z,sx=1,sy=1,sz=1){const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);o.scale.set(sx,sy,sz);scene.add(o);return o;}
// The finite carved frame replaces distant outcrops; no added playable obstacle.
function glyphTexture(glyph,color='#322416',protectedLabel=false){const c=document.createElement('canvas');c.width=protectedLabel?192:128;c.height=128;const t=c.getContext('2d');if(protectedLabel){
 // A cached, static shield stays legible in quiet mode without another sprite.
 // Side padding leaves the glyph and its existing HP-strip clearance unchanged.
 t.fillStyle=color;t.beginPath();t.moveTo(150,4);t.lineTo(180,13);t.lineTo(178,54);t.lineTo(169,69);t.lineTo(150,81);t.lineTo(131,69);t.lineTo(122,54);t.lineTo(120,13);t.closePath();t.moveTo(150,12);t.lineTo(128,19);t.lineTo(130,52);t.lineTo(137,63);t.lineTo(150,72);t.lineTo(163,63);t.lineTo(170,52);t.lineTo(172,19);t.closePath();t.strokeStyle='#302c24';t.lineWidth=4;t.stroke();t.fill('evenodd');
 }t.fillStyle=color;t.textAlign='center';t.textBaseline='middle';t.font='900 86px "Hiragino Mincho ProN", "Noto Serif CJK JP", serif';t.strokeStyle='#302c24';t.lineWidth=7;t.lineJoin='round';t.strokeText(glyph,64,71);t.fillText(glyph,64,71);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;}
const dummy=new THREE.Object3D(),rootDummy=new THREE.Object3D();
let models;
try { models=await loadSamuraiModels(scene,E.MAX_NPCS,E.HERO_HEIGHT); }
catch(error){ $('model-loading').hidden=true; window.battleReady='failed'; showFailure('読み込めませんでした。通信を確認して再読み込みしてください'); console.error(error); throw error; }
const hero=models.hero,torso=models.figure,actions=models.controller,handEffects=createHandEffects(scene,{models});
const npcFacing=createNpcFacing(),npcHitReactions=createNpcHitReactions(),heroHitFeedback=createHeroHitFeedback();
const heroMaterials=[];hero.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])if(m?.emissive&&!heroMaterials.some(v=>v.material===m))heroMaterials.push({material:m,color:m.emissive.clone(),intensity:m.emissiveIntensity});});
const transformShell=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial({color:'#ffd76b',transparent:true,opacity:0,wireframe:true,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(transformShell);
const npcColors={ally:new THREE.Color('#20cfff'),enemy:new THREE.Color('#ff4935')},npcBodyTint=new THREE.Color();
const teamMarkers=new THREE.InstancedMesh(new THREE.RingGeometry(.68,.88,24).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false}),E.MAX_NPCS);teamMarkers.name='npc-team-markers';teamMarkers.frustumCulled=false;scene.add(teamMarkers);
const pieceLabels=Array.from({length:E.MAX_NPCS},()=>{const o=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthTest:false,depthWrite:false}));o.scale.set(.85,.85,1);scene.add(o);return o;});const pieceMaps={};for(const key of Object.keys(E.PIECES))for(const [team,color] of [['enemy','#ffb4a7'],['ally','#9beeff']]){pieceMaps[team+'_'+key]=glyphTexture(E.PIECES[key].glyph,color);pieceMaps[team+'_'+key+'_protected']=glyphTexture(E.PIECES[key].glyph,color,true);}
const npcHpBars=Array.from({length:E.MAX_NPCS},()=>{const group=new THREE.Group(),back=new THREE.Mesh(new THREE.PlaneGeometry(1.05,.11),new THREE.MeshBasicMaterial({color:'#17272d',depthTest:false,depthWrite:false,transparent:true,opacity:.9})),fill=new THREE.Mesh(new THREE.PlaneGeometry(1,.07),new THREE.MeshBasicMaterial({color:'#ff715f',depthTest:false,depthWrite:false}));fill.position.z=.001;group.add(back,fill);scene.add(group);group.visible=false;return {group,fill};});
const weaponAssets=createWeaponAccents(THREE),heroWeaponAssets=createWeaponAccents(THREE,{presentationOwner:'hero'}),heroSword=weaponAssets.createSword('#b8f6ff'),heroSpear=heroWeaponAssets.createHeldSpear('#b8f6ff'),weaponDirection=new THREE.Vector3(),weaponAxis=new THREE.Vector3(1,0,0),spearAxis=new THREE.Vector3(0,0,1);scene.add(heroSword,heroSpear);
let heroPose=null,walking=false;
$('model-loading').hidden=true;
const shadowMat=new THREE.MeshBasicMaterial({color:'#322616',transparent:true,opacity:.23,depthWrite:false});const shadowGeo=new THREE.CircleGeometry(.82,18);shadowGeo.rotateX(-Math.PI/2);const shadows=new THREE.InstancedMesh(shadowGeo,shadowMat,E.MAX_NPCS+1);shadows.frustumCulled=false;scene.add(shadows);
const aura=new THREE.Mesh(new THREE.RingGeometry(1.62,1.68,48),new THREE.MeshBasicMaterial({color:'#47dfff',transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));aura.rotation.x=-Math.PI/2;scene.add(aura);
const guardShell=new THREE.Mesh(new THREE.SphereGeometry(1,18,12),new THREE.MeshBasicMaterial({color:'#97efff',transparent:true,opacity:.15,depthWrite:false,wireframe:true}));guardShell.scale.set(1.05,2.05,1.05);guardShell.visible=false;scene.add(guardShell);
const enemyBoundary=new THREE.Mesh(new THREE.PlaneGeometry(38,.14),new THREE.MeshBasicMaterial({color:'#ff7954',transparent:true,opacity:.7,depthWrite:false}));enemyBoundary.rotation.x=-Math.PI/2;enemyBoundary.position.set(0,.025,E.ENEMY_ZONE_Z);scene.add(enemyBoundary);
const landing=new THREE.Mesh(new THREE.RingGeometry(.75,.92,40),new THREE.MeshBasicMaterial({color:'#8aeeff',transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false}));landing.rotation.x=-Math.PI/2;landing.visible=false;scene.add(landing);
const pathGeo=new THREE.BufferGeometry();pathGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.24,0,.9,.24,0,.9,0,0,2.0],3));pathGeo.computeVertexNormals();const pathMat=new THREE.MeshBasicMaterial({color:'#76eaff',transparent:true,opacity:.15,side:THREE.DoubleSide,depthWrite:false});const path=new THREE.Mesh(pathGeo,pathMat);scene.add(path);
const slash=new THREE.Mesh(new THREE.RingGeometry(1.5,3.9,40,1,-Math.PI-.15,Math.PI+.3),new THREE.MeshBasicMaterial({color:'#ffe9a0',transparent:true,opacity:.42,side:THREE.DoubleSide,depthWrite:false}));slash.name='spear-sweep-arc';slash.rotation.x=-Math.PI/2;scene.add(slash);

const trails=[];for(let i=0;i<12;i++){const trail=new THREE.Mesh(new THREE.PlaneGeometry(.09,3.5),new THREE.MeshBasicMaterial({color:'#ffe8a9',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));trail.rotation.x=-Math.PI/2;scene.add(trail);trails.push(trail);}
const PARTICLES=160,particles=[];const dust=new THREE.InstancedMesh(sphere,new THREE.MeshBasicMaterial({color:'#dbbb83',transparent:true,opacity:.42,depthWrite:false}),PARTICLES);dust.frustumCulled=false;scene.add(dust);let particleIndex=0;
applyImperialCombatInk(THREE,{scene,teamMarkers,aura});
function burst(x,z,num=8){for(let i=0;i<num;i++){const a=random()*Math.PI*2,speed=2+random()*6;particles[particleIndex]={x,z,y:.4,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,vy:1+random()*3,age:0,life:.55+random()*.45,size:.2+random()*.36};particleIndex=(particleIndex+1)%PARTICLES;}}
let recruitLesson=null,actionLesson=null;
function recruitEnded(){return selectedScenario==='squad'&&!!recruitLesson&&recruitLesson.status!=='playing';}
function actionLessonEnded(){return !!actionLesson&&actionLesson.status!=='playing';}
function lessonEnded(){return recruitEnded()||actionLessonEnded();}
function showEndedLesson(force=false){if(actionLesson)showActionLessonResult();else showRecruitResult(force);}
let selectedCapabilities;
let selectedControlMode='manual';
// Initial ON is a prototype default. Keep the preference while forced-ON modes run.
let selectedAutomaticAllyReturn=true,stagedAutomaticAllyReturn=true;
let selectedHandicapReserve=false,stagedHandicapReserve=false,selectedHandicapDeployment='reserve',stagedHandicapDeployment='reserve';
function manualCapturedReturnSelected(){return selectedScenario==='army'&&selectedAutomaticAllyReturn===false&&(selectedBattleScenario!=='free'||selectedControlMode!=='spectator');}
let selectedBattleScenario='first_sortie',selectedMissionPiece='rook',freeStagedSettings=null,stagedBattleScenario='first_sortie';
let selectedTerrain='plain',selectedDifficulty='normal',inLobby=true,selectedScenario='army',selectedPiece='king',selectedArmyPiece='king',selectedFormation='initial',selectedHandicap='ten',selectedTeamStats=E.equipmentTeamStats(null),selectedStrategies=E.normalizeStrategies(null),selectedTeamTactics=E.normalizeTeamTactics(null),selectedKingPersonalities=E.normalizeKingPersonalities(null),selectedAllyFormation='initial',g=E.create(1,selectedPiece,selectedFormation,{controlMode:selectedScenario==='army'?selectedControlMode:'manual',npcSensing:selectedScenario==='army',teamTactics:selectedScenario==='army'?selectedTeamTactics:undefined,strategies:selectedStrategies,teamStats:selectedTeamStats,handicap:selectedHandicap,allyFormation:selectedAllyFormation,scenario:selectedScenario,difficulty:selectedScenario==='army'?selectedDifficulty:'normal',formationHero:true,terrain:selectedScenario==='army'?selectedTerrain:'plain',heroHp:3,kingPersonalities:selectedKingPersonalities,invasionScoring:true}),keys=new Set(),keyCodes=new Map(),padId=null,guardId=null,guardKeys=new Set(),guardActorId=null,input={x:0,z:0},pad={x:0,z:0},destination=null,paused=true,settingsOpen=false,intense=true,shake=false,impactUntil=0,comboUntil=0,promotionUntil=0,shakePower=0,shownScore=-1,shownMode='',shownPromoted=null,uiSnapshot='',last=performance.now(),slowFrames=0;
// Isolated opt-in follow-up adapter. Standard preparation keeps every box OFF.
let stagedFollowups=new Set(),selectedFollowups=[],followupActorId=null,followupGame=null,followupClickSerial=0;
const followupPolicy=createUiFollowupPolicy(E,()=>({actorId:followupActorId,actions:selectedFollowups,game:selectedScenario==='army'?followupGame:null,stageLimit:3,chargeStageLimit:3}));
const followup=createFollowupRuntime(E,{enabled:true,resolveActorFor:followupPolicy.resolve,finisherRecovery:.12,maxCharges:3,queueWindow:'after-start',queueStart:.08,queueLifetime:1.2,thrustTimingProfile:'three-hit-thrust-v1'});
const ordinaryAttackCycle=followup.ordinaryPresentation;
function renderAttackPresentation(){return followup.presentation(g)||ordinaryAttackCycle.view(g);}
function contactPresentationStage(event){return followup.contactStage(g,event)||ordinaryAttackCycle.contactStage(g,event);}
function followupActive(){return !E.isSpectator(g)&&selectedScenario==='army'&&g===followupGame&&g.scenario==='army'&&selectedFollowups.length>0;}
function followupOffer(action){const v=followup.view(g,action);return {...v,canBuffer:v.canBuffer&&!guardHeld()&&!paused&&!settingsOpen&&!lessonEnded()};}
const followupEngine={...E,step(game,dt,controls){const firstAudioWave=game.nextWaveId;const ordinaryAcceptedFrame=ordinaryAttackCycle.view(game),before={thrust:game.thrusts,sweep:game.sweeps,charge:game.charges};if(E.isSpectator(game))E.step(game,dt);else followup.step(game,dt,controls);window.BattleAudio.observeNpcWaves?.(game,firstAudioWave);ordinaryAttackCycle.noteFrame(game,ordinaryAcceptedFrame);for(const [action,count] of Object.entries(before))if(game[{thrust:'thrusts',sweep:'sweeps',charge:'charges'}[action]]>count)noteChallengeAction(challenge,action);if(game===g)dispatchOrdinaryAttackBuffer();return game;}};
window.shogiFollowup={state:()=>followup.snapshot(),trace:()=>followup.trace(),presentation:()=>followup.presentation(g)};
let ordinaryAttackBuffer=null;
let assistiveAttackDirection=null;let attackInputEpoch=0;const attackPointerOwners=new Map(),attackButtonKeys=new Map();
// This non-modal dock owns only its own input streams. Opening/closing it never
// pauses, clears combat input, or uses the tactics overlay. Only keyboard Escape
// returns focus from inside the closed panel to its toggle. Successful automatic
// closure also returns panel focus to the toggle, never to a combat action.
let capturedReturnOpen=false,capturedReturnEpoch=0,capturedReturnEpochStartedAt=0,capturedReturnPending=null;
const capturedReturnPointers=new Map(),capturedReturnKeys=new Map(),capturedReturnEnvelopes=new WeakMap(),capturedReturnKeyboardClicks=new WeakMap();
function capturedReturnAvailable(){return !!g.capturedReturnPolicy&&!inLobby&&!paused&&!settingsOpen&&!tacticalOpen&&!E.battleEnded(g)&&!lessonEnded()&&g.active&&!E.isSpectator(g)&&g.scenario==='army';}
function capturedReturnEnvelope(summary){return {game:g,epoch:capturedReturnEpoch,gameId:summary.gameId,revision:summary.revision};}
function validCapturedReturnEnvelope(envelope,revisionRequired=true){
 if(!envelope||envelope.game!==g||envelope.epoch!==capturedReturnEpoch||!capturedReturnAvailable())return false;
 const summary=E.capturedReturnSummary(g);return summary.enabled&&summary.gameId===envelope.gameId&&(!revisionRequired||summary.revision===envelope.revision);
}
function releaseCapturedReturnPointer(pointerId){
 const owner=capturedReturnPointers.get(pointerId);if(!owner)return;
 capturedReturnPointers.delete(pointerId);try{if(owner.node.hasPointerCapture?.(pointerId))owner.node.releasePointerCapture(pointerId);}catch{}
}
function closeCapturedReturn(){
 capturedReturnOpen=false;capturedReturnPending=null;capturedReturnEpoch++;capturedReturnEpochStartedAt=performance.now();
 for(const id of [...capturedReturnPointers.keys()])releaseCapturedReturnPointer(id);
 capturedReturnKeys.clear();$('captured-return-panel').hidden=true;$('captured-return-toggle').setAttribute('aria-expanded','false');
}
function activateCapturedReturn(action,envelope){
 // Opening only reads current inventory; game and panel epoch still guard stale input.
 if(!validCapturedReturnEnvelope(envelope,action!=='toggle'||capturedReturnOpen))return;
 if(action==='toggle'){
  if(capturedReturnOpen)closeCapturedReturn();else{capturedReturnOpen=true;capturedReturnEpoch++;capturedReturnEpochStartedAt=performance.now();}
 }else if(action==='close'){if(!capturedReturnOpen)return;closeCapturedReturn();}
 else{
  if(!capturedReturnOpen)return;
  const expected={gameId:envelope.gameId,revision:envelope.revision};
  if(action==='cancel')E.cancelCapturedReturn(g,expected);else E.requestCapturedReturn(g,action,expected);
 }
 renderCapturedReturn();
}
function suppressCapturedReturnEvent(e){e?.preventDefault?.();e?.stopPropagation?.();}
function bindCapturedReturnButton(id,action){
 const node=$(id);
 node.addEventListener('pointerdown',e=>{
  suppressCapturedReturnEvent(e);
  if(!Number.isSafeInteger(e.pointerId)||e.pointerId<0||e.button!=null&&e.button!==0||node.hidden||node.disabled||capturedReturnPointers.has(e.pointerId)||e.pointerId===padId||e.pointerId===guardId||attackPointerOwners.has(e.pointerId))return;
  const envelope=capturedReturnEnvelopes.get(node);if(!validCapturedReturnEnvelope(envelope))return;
  capturedReturnPointers.set(e.pointerId,{node,envelope,action});try{node.setPointerCapture(e.pointerId);}catch{}
 });
 node.addEventListener('pointerup',e=>{
  suppressCapturedReturnEvent(e);const owner=capturedReturnPointers.get(e.pointerId);if(!owner||owner.node!==node)return;
  releaseCapturedReturnPointer(e.pointerId);if(!node.hidden&&!node.disabled)activateCapturedReturn(owner.action,owner.envelope);
 });
 for(const type of ['pointercancel','lostpointercapture'])node.addEventListener(type,e=>{suppressCapturedReturnEvent(e);if(capturedReturnPointers.get(e.pointerId)?.node===node)releaseCapturedReturnPointer(e.pointerId);});
 node.addEventListener('keydown',e=>{
  if(![' ','Enter'].includes(e.key)||ignoreGameKey(e))return;showInputHints('keyboard');suppressCapturedReturnEvent(e);
  if(e.repeat||node.hidden||node.disabled||capturedReturnKeys.has(e.key))return;
  const envelope=capturedReturnEnvelopes.get(node);if(validCapturedReturnEnvelope(envelope))capturedReturnKeys.set(e.key,{node,envelope,action});
 });
 node.addEventListener('keyup',e=>{
  if(![' ','Enter'].includes(e.key))return;suppressCapturedReturnEvent(e);
  const owner=capturedReturnKeys.get(e.key);if(!owner||owner.node!==node)return;capturedReturnKeys.delete(e.key);
  capturedReturnKeyboardClicks.set(node,performance.now()+500);if(!node.hidden&&!node.disabled)activateCapturedReturn(owner.action,owner.envelope);
 });
 node.addEventListener('blur',()=>{for(const [key,owner] of capturedReturnKeys)if(owner.node===node)capturedReturnKeys.delete(key);});
 // Click listeners are rebound to the rendered revision below. Saved old handlers
 // cannot select from a new game/panel/revision. Pointer clicks never activate.
 node.capturedReturnAction=action;
}
for(const [id,action] of [['captured-return-toggle','toggle'],['captured-return-close','close'],['captured-return-cancel','cancel'],...CAPTURED_RETURN_TYPES.map(piece=>['captured-return-'+piece,piece])])bindCapturedReturnButton(id,action);
window.addEventListener('pointerup',e=>{const owner=capturedReturnPointers.get(e.pointerId);if(owner&&e.target!==owner.node&&!owner.node.contains?.(e.target))releaseCapturedReturnPointer(e.pointerId);},true);
window.addEventListener('pointercancel',e=>releaseCapturedReturnPointer(e.pointerId),true);
$('captured-return-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){suppressCapturedReturnEvent(e);const restoreFocus=$('captured-return-panel').contains?.(document.activeElement);closeCapturedReturn();renderCapturedReturn();if(restoreFocus&&capturedReturnAvailable())$('captured-return-toggle').focus({preventScroll:true});}});
for(const type of ['pointerdown','pointerup','click','dblclick','contextmenu'])$('captured-return-dock').addEventListener(type,e=>{e.stopPropagation();if(type==='dblclick'||type==='contextmenu')e.preventDefault();});
function renderCapturedReturn(){
 const visible=capturedReturnAvailable();$('captured-return-dock').hidden=!visible;
 if(!visible){if(capturedReturnOpen||capturedReturnPointers.size||capturedReturnKeys.size)closeCapturedReturn();return;}
 const summary=E.capturedReturnSummary(g);
 // A reservation is not a deployment. Close only after its consumed ticket has
 // produced a living ally; cancellation, cooldown and blocked homes stay open.
 if(capturedReturnOpen&&capturedReturnPending?.game===g&&capturedReturnPending.gameId===summary.gameId&&!summary.tickets.some(t=>t.token===capturedReturnPending.token)&&g.enemies.some(e=>e.id===capturedReturnPending.id&&e.alive&&e.team==='ally')){
  const restoreFocus=$('captured-return-panel').contains?.(document.activeElement);closeCapturedReturn();if(restoreFocus)$('captured-return-toggle').focus({preventScroll:true});
 }
 const selected=summary.tickets.find(t=>t.token===summary.selectedToken);
 capturedReturnPending=capturedReturnOpen&&selected?{game:g,gameId:summary.gameId,token:selected.token,id:selected.id}:null;
 const view=capturedReturnPresentation(E,g,summary),envelope=capturedReturnEnvelope(summary);
 const toggleText='持ち駒 '+view.total;if($('captured-return-toggle').textContent!==toggleText)$('captured-return-toggle').textContent=toggleText;$('captured-return-toggle').setAttribute('aria-expanded',String(capturedReturnOpen));$('captured-return-panel').hidden=!capturedReturnOpen;
 if($('captured-return-status').textContent!==view.text)$('captured-return-status').textContent=view.text;$('captured-return-status').setAttribute('data-state',view.state);
 $('captured-return-cancel').hidden=!view.selected;
 for(const item of view.types){const node=$('captured-return-'+item.piece);node.hidden=item.count===0;node.disabled=item.selected;const label=E.PIECES[item.piece].glyph+' '+item.count;if(node.textContent!==label)node.textContent=label;node.setAttribute('aria-pressed',String(item.selected));node.setAttribute('aria-label',E.PIECES[item.piece].name+' '+item.count+'体'+(item.selected?'、出撃予約中':'、1体を出撃予約'));}
 for(const id of ['captured-return-toggle','captured-return-close','captured-return-cancel',...CAPTURED_RETURN_TYPES.map(piece=>'captured-return-'+piece)]){
  const node=$(id);capturedReturnEnvelopes.set(node,envelope);
  node.onclick=e=>{suppressCapturedReturnEvent(e);if(e?.detail!==0||Number.isSafeInteger(e.pointerId)&&e.pointerId>=0||node.hidden||node.disabled||(capturedReturnKeyboardClicks.get(node)||0)>performance.now()||e.timeStamp>0&&e.timeStamp<capturedReturnEpochStartedAt)return;activateCapturedReturn(node.capturedReturnAction,envelope);};
 }
}
const reducedQuery=matchMedia('(prefers-reduced-motion: reduce)'),quiet=()=>reducedQuery.matches||!intense;
// The camera looks straight along -z, so screen arrows and rook axes agree.
const diagonalButtons=[['diag-nw',-1,-1],['diag-ne',1,-1],['diag-sw',-1,1],['diag-se',1,1]],moveButtons=[['move-up',0,-1],['move-down',0,1],['move-left',-1,0],['move-right',1,0],...diagonalButtons];
// Safari gesture safeguards are scoped to the canvas and action pad, never
// a maximum-scale viewport or a document-wide pinch-zoom lock.
for(const id of ['world','dpad','sweep','charge','thrust','jump','guard']){const surface=$(id);surface.addEventListener('touchstart',e=>{if(id==='world'&&(e.targetTouches?.length||0)>1)clearInput();},{passive:true});surface.addEventListener('dblclick',e=>e.preventDefault());surface.addEventListener('contextmenu',e=>e.preventDefault());}
for(const event of ['touchstart','touchmove'])$('battle-controls').addEventListener(event,e=>{if(e.cancelable)e.preventDefault();},{passive:false});
let masteryFeedback=createMasteryFeedback(),challenge=createChallenge(g),challengeRecords=loadChallengeRecords(preferenceStorage),challengeResult=null,challengeSaved=true;
let padSnapshot='';
function showPad(){const snapshot=Math.sign(pad.x)+','+Math.sign(pad.z);if(snapshot===padSnapshot)return;padSnapshot=snapshot;for(const [id,x,z] of moveButtons)$(id).classList[Math.sign(pad.x)===x&&Math.sign(pad.z)===z?'add':'remove']('pressed');}
function clearInput(){ordinaryAttackBuffer=null;assistiveAttackDirection=null;for(const key of [...attackButtonKeys.keys()])releaseAttackButtonKey(key);ordinaryAttackCycle.breakChain();attackInputEpoch++;clearAttackPointerOwners();followup.interrupt(g,'clear-input');renderDirty=true;E.setGuard(g,false);guardId=null;guardKeys.clear();guardActorId=null;keyCodes.clear();keys.clear();pad.x=pad.z=0;padId=null;destination=null;input.x=input.z=0;input.maxDistance=undefined;showPad();}
function stop(){closeCapturedReturn();advanceSimulation.reset(g);paused=true;clearInput();window.BattleAudio.pause();if(settingsOpen)settingsWasPaused=true;if(tacticalOpen)tacticalWasPaused=true;if(!inLobby&&lessonEnded()){showEndedLesson(true);$('paused').hidden=true;return;}if(!inLobby&&!$('result').hidden){$('paused').hidden=true;return;}if(!settingsOpen&&!tacticalOpen&&!inLobby){$('paused').hidden=false;$('resume').focus({preventScroll:true});}}
function hideCombo(){comboUntil=0;$('combo').hidden=true;$('combo').classList.remove('show');$('combo-count').textContent='0';}
// Keep recruitment notices beside its ongoing lesson guide, clear of nearby actors.
// Move the existing node so notice priority, lifetime and announcement logic stay shared.
function placeBattleNotice(){$('game').setAttribute('data-lesson',selectedScenario);const notice=$('battle-event'),host=$(selectedScenario==='squad'?'hint':'combo').parentElement;if(host&&notice.parentElement!==host)host.appendChild(notice);}
function reset(){$('final-challenge').hidden=true;if(!DEVELOPMENT_OPTIONS){selectedDevEscortBrace=false;selectedCapabilities=undefined;selectedFollowups=[];}closeCapturedReturn();escortBraceTelegraph.reset();setSortieVictorySummary(false);ordinaryAttackCycle.reset();advanceSimulation.reset(g);placeBattleNotice();npcFacing.reset();heroHitFeedback.reset();npcHitReactions.reset();models.npcAnimations?.reset();models.npcLocomotion?.reset();lastTactics=-1;eventUntil=0;eventPriority=0;$('battle-event').hidden=true;$('battle-event').setAttribute('data-reward-tier','0');actions.reset();handEffects.reset();heroPose=null;const nextSeed=g.seed+1;g=selectedScenario==='squad'?createRecruitLesson(E,nextSeed,{arena:COMPACT_LESSON_BOARDS.squad.arena}):E.create(nextSeed,selectedPiece,selectedFormation,{...(selectedScenario==='army'&&selectedBattleScenario==='free'&&selectedHandicapReserve?{handicapToEnemyReserve:true,handicapEnemyDeployment:selectedHandicapDeployment}:{}),...(manualCapturedReturnSelected()?{automaticAllyReturn:false}:{}),...(selectedScenario==='army'&&selectedDevEscortBrace?{devEscortBrace:true}:{}),controlMode:selectedScenario==='army'?(manualCapturedReturnSelected()&&selectedBattleScenario!=='free'?'manual':selectedControlMode):'manual',npcSensing:selectedScenario==='army',teamTactics:selectedScenario==='army'?selectedTeamTactics:undefined,strategies:selectedStrategies,teamStats:selectedTeamStats,handicap:selectedHandicap,allyFormation:selectedAllyFormation,scenario:selectedScenario,battleScenario:selectedScenario==='army'?selectedBattleScenario:undefined,difficulty:selectedScenario==='army'?selectedDifficulty:'normal',formationHero:true,terrain:selectedScenario==='army'?selectedTerrain:'plain',...(selectedScenario!=='army'?{arena:COMPACT_LESSON_BOARDS[selectedScenario].arena}:{}),heroHp:3,kingPersonalities:selectedKingPersonalities,invasionScoring:true,capabilities:selectedScenario==='army'?selectedCapabilities:undefined});followupActorId=g.playerId;followupGame=g;if(!E.isSpectator(g)&&selectedScenario==='army'&&selectedFollowups.length){const actions=Object.freeze(['thrust','sweep','charge'].filter(action=>selectedFollowups.includes(action)));Object.defineProperty(g,'followupLoadout',{value:Object.freeze({version:actions.includes('thrust')?'ground-combo-thrust-v3':'ground-combo-v2',actorId:g.playerId,actions,stageLimit:3,chargeStageLimit:3,bufferSeconds:.18,queueLifetime:1.2,queueWindow:'after-start',queueStart:.08,finisherRecovery:.12,...(actions.includes('thrust')?{thrustTimingProfile:'three-hit-thrust-v1',profiledThrustFinisherRecovery:0,queueClock:'profile-phase-v1'}:{})}),enumerable:true});}recruitLesson=selectedScenario==='squad'?createRecruitRecord():null;actionLesson=['guard_trial','awaken_trial'].includes(selectedScenario)?createActionLessonRecord(selectedScenario):null;g.active=selectedScenario==='army'||selectedScenario==='guard_trial';syncTerrainScene();challenge=createChallenge(g,selectedScenario==='squad'?'capture-battle-v49-recruit-lesson-v1':undefined);masteryFeedback=createMasteryFeedback();challengeResult=null;challengeSaved=true;shakePower=0;clearInput();particles.length=0;$('result').hidden=true;hideCombo();$('impact').classList.remove('show');$('hint').classList.remove('hide');$('hint').setAttribute('data-tutorial',String(selectedScenario!=='army'));$('hint').setAttribute('data-lesson',selectedScenario);$('hint').textContent=E.isSpectator(g)?'観戦（全員NPC）':selectedScenario==='army'?'移動ボタンで動き、攻撃ボタンで攻撃。PCは矢印/WASDとSpace/J。':lessonHelp[selectedScenario];$('tactics-toggle').textContent=selectedScenario==='army'&&!E.isSpectator(g)?'戦況・交代':'戦況';$('tactics-toggle').setAttribute('aria-label',selectedScenario==='army'&&!E.isSpectator(g)?'戦況を開く・操作する味方を交代':'戦況を開く');$('mission').textContent=E.isSpectator(g)?'観戦（全員NPC）':selectedScenario==='army'?(g.devEscortBrace===true?'護衛防御ON：横・後ろ・隙を狙え':'敵の王将を討ち取れ'):drills[selectedScenario].title;shownScore=-1;shownMode='';shownPromoted=null;uiSnapshot='';impactUntil=comboUntil=promotionUntil=0;paused=false;$('paused').hidden=true;last=performance.now();updateUI();}
const keyDirections={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0],q:[-1,-1],e:[1,-1],z:[-1,1],c:[1,1]};
function setDestination(x,z){if(E.isSpectator(g))return;
 const A=E.arenaBounds(g);
 if(E.pieceKey(g)==='knight')return;
 if(E.pieceKey(g)==='rook'){destination={x:Math.max(A.minX,Math.min(A.maxX,x)),z:Math.max(A.minZ,Math.min(A.maxZ,z))};return;}
 const dx=x-g.player.x,dz=z-g.player.z,d=E.direction(g,dx,dz);if(!d.x&&!d.z){destination=null;return;}
 let length=Math.max(0,dx*d.x+dz*d.z);
 if(d.x)length=Math.min(length,((d.x>0?A.maxX:A.minX)-g.player.x)/d.x);
 if(d.z)length=Math.min(length,((d.z>0?A.maxZ:A.minZ)-g.player.z)/d.z);
 destination={x:g.player.x+d.x*length,z:g.player.z+d.z*length};
}
const drills={switch_trial:{piece:'king',title:'金将に交代して、敵の歩兵を倒す'},duel:{piece:'pawn',title:'突きで敵1体を狙う'},squad:{piece:'king',title:'仲間の攻撃を1回当てる'},thrust_trial:{piece:'pawn',title:'反撃しない歩・銀・金を、1体ずつ突く'},slash_trial:{piece:'king',title:'密集した歩・銀・金をまとめて斬る'},charge_trial:{piece:'rook',title:'青い味方を避け、空いた進路から突撃'},jump_trial:{piece:'knight',title:'青い前衛を飛び越え、右前の敵を踏む'},guard_trial:{piece:'king',title:'防御で攻撃を1回受け止める'},awaken_trial:{piece:'pawn',title:'敵陣に入って自動覚醒し、斬るを当てる'}};
const lessonHelp={switch_trial:'①「戦況・交代」で金将を選び、操作を切り替える',duel:'↑で近づき、正面の敵に「攻撃」で突く',thrust_trial:'反撃しない標的。手前の歩→銀→金の順に「攻撃」で突く',slash_trial:'敵が重なる向きから「攻撃」で斬る',charge_trial:'青い味方を避けてから方向＋「攻撃」で突撃',jump_trial:'↗で右前へ跳ぶ。後退不可',squad:'手前の歩兵を「攻撃」で斬る',guard_trial:'「防御」を長押しして待つ',awaken_trial:'↑で赤い線を越えると自動覚醒'};
function syncEquipmentStats(){const stats=E.equipmentTeamStats(Object.fromEntries(['ally','enemy'].map(team=>[team,{equipment:$(team+'-equipment').value}])));for(const team of ['ally','enemy']){$(team+'-hp').value=String(stats[team].hp);$(team+'-agility').value=stats[team].agility==='slow'?'ゆっくり':'標準';}return stats;}
let heavyChallengeStaged=false;
// This prototype only stages bounded, implemented capabilities for the initial hero.
// No capability preferences are written to the standard settings namespace.
const abilityIds=['thrust','sweep','charge','jump','guard','step_attack'];
const abilityNames={thrust:'突く',sweep:'斬る',charge:'突撃',jump:'跳ぶ',guard:'防御',step_attack:'1歩攻撃'};
let stagedAbilityPiece=null,stagedDisabled=new Set(),stagedForwardHop=false;
function baseAbilities(piece){return [...E.ACTIONS[piece],...(!['pawn','lance','knight'].includes(piece)?['guard']:[]),...(['dragon','horse'].includes(piece)?['step_attack']:[])];}
function restoreAbilityStage(){stagedFollowups=new Set(selectedFollowups.filter(action=>baseAbilities(selectedArmyPiece).includes(action)));const hero=selectedCapabilities?.hero;stagedAbilityPiece=selectedArmyPiece;stagedDisabled=new Set(hero?.basePiece===stagedAbilityPiece?hero.disabled:[]);stagedForwardHop=!!(hero?.basePiece===stagedAbilityPiece&&hero.forwardHop);}
function syncAbilityPanel(){
 if(!DEVELOPMENT_OPTIONS){$('abilities-options').hidden=true;$('abilities-unavailable').hidden=true;stagedDisabled.clear();stagedForwardHop=false;stagedFollowups.clear();for(const id of [...abilityIds.map(id=>'ability-'+id),'ability-forward-hop',...['thrust','sweep','charge'].map(id=>'ability-followup-'+id)])$(id).disabled=true;return;}
 const piece=$('piece-choice').value,practice=$('scenario-choice').value!=='army'||$('control-mode').value==='spectator',runtimeReady=!!E.CapabilityRuntime;$('abilities-options').hidden=practice||!runtimeReady;$('abilities-unavailable').hidden=practice||runtimeReady;
 if(practice||!runtimeReady)return;
 if(stagedAbilityPiece!==piece){stagedAbilityPiece=piece;stagedDisabled.clear();stagedForwardHop=false;stagedFollowups.clear();}
 const available=baseAbilities(piece),dependent=stagedDisabled.has('sweep');
 for(const id of abilityIds){const visible=available.includes(id),node=$('ability-'+id);$('ability-'+id+'-row').hidden=!visible;node.checked=!stagedDisabled.has(id)&&!(id==='step_attack'&&dependent);node.disabled=!visible||(id==='step_attack'&&dependent);}
 $('ability-forward-hop-row').hidden=piece!=='pawn';$('ability-forward-hop').checked=piece==='pawn'&&stagedForwardHop;$('ability-forward-hop').disabled=piece!=='pawn';
 for(const action of ['thrust','sweep','charge']){const node=$('ability-followup-'+action),visible=available.includes(action);$('ability-followup-'+action+'-row').hidden=!visible;node.disabled=!visible||stagedDisabled.has(action);node.checked=visible&&!node.disabled&&stagedFollowups.has(action);}
 const modified=stagedDisabled.size>0||stagedForwardHop||stagedFollowups.size>0;$('abilities-summary').textContent=modified?'変更あり':'';
 const notes=[];if(piece==='knight'&&stagedDisabled.has('jump'))notes.push('跳ぶ OFF：桂馬は移動・攻撃できません。');
 if(['dragon','horse'].includes(piece)&&(stagedDisabled.has('step_attack')||dependent))notes.push((piece==='dragon'?'斜め':'縦横')+'の1歩攻撃は OFF。全方向への移動はできます。');
 if(stagedForwardHop)notes.push('操作中のこの兵に前方跳躍を追加（方向＋攻撃）。自動操作中は跳びません。');
 $('abilities-status').textContent=(notes.length?notes.join(' ')+' ':'')+(modified?'出撃時に反映。この設定では得点・タイム記録を保存しません。':'標準の技を使用します。変更は出撃時に反映します。');
}
for(const id of abilityIds)$('ability-'+id).onchange=()=>{if(!inLobby||$('lobby').hidden||$('abilities-options').hidden)return;if($('ability-'+id).disabled)return;if($('ability-'+id).checked)stagedDisabled.delete(id);else stagedDisabled.add(id);syncAbilityPanel();};
$('ability-forward-hop').onchange=()=>{if(!inLobby||$('lobby').hidden||$('piece-choice').value!=='pawn'||$('abilities-options').hidden)return;stagedForwardHop=$('ability-forward-hop').checked===true;syncAbilityPanel();};
$('abilities-reset').onclick=()=>{if(!inLobby||$('lobby').hidden)return;stagedDisabled.clear();stagedForwardHop=false;stagedFollowups.clear();syncAbilityPanel();};
for(const action of ['thrust','sweep','charge'])$('ability-followup-'+action).onchange=()=>{if(!inLobby||$('lobby').hidden||$('abilities-options').hidden||$('ability-followup-'+action).disabled)return;if($('ability-followup-'+action).checked)stagedFollowups.add(action);else stagedFollowups.delete(action);syncAbilityPanel();};
function stagedAbilityManifest(){if(!DEVELOPMENT_OPTIONS)return undefined;
 if(!E.CapabilityRuntime)return undefined;
 const basePiece=$('piece-choice').value,available=baseAbilities(basePiece),disabled=abilityIds.filter(id=>available.includes(id)&&stagedDisabled.has(id));
 const forwardHop=basePiece==='pawn'&&stagedForwardHop===true;
 return disabled.length||forwardHop?{version:'poe-runtime-capabilities/1',hero:{basePiece,disabled,forwardHop,rig:'original-samurai'},actors:[]}:undefined;
}
// Successful sorties and lessons share prominent result lines.
// Practice keeps its learning feedback and never advertises saved records.
// Shared result nodes and record emphasis reset on every new battle.
let sortieVictoryReceipt=null;
function setSortieVictorySummary(compact,practice=false){
 $('result').setAttribute('data-sortie-summary',String(compact));
 $('result').setAttribute('data-result-kind',compact?(practice?'practice':'victory'):'');
 $('result').setAttribute('data-victory-motion',String(compact&&!quiet()));
 for(const id of ['result-kicker','result-score-line','result-detail','result-metrics','result-points-detail','result-record'])$(id).hidden=compact;
 $('sortie-summary').hidden=!compact;
 const updated=!!(compact&&!practice&&challengeSaved&&challengeResult?.accepted&&challengeResult.newTime);
 $('sortie-summary-time').setAttribute('data-record-updated',String(updated));
 $('sortie-summary-time').setAttribute('data-record-flash',String(updated&&sortieVictoryReceipt!==challengeResult));
 $('sortie-summary-record').hidden=!updated;
 if(compact){
  $('sortie-summary-score').textContent=practice&&selectedScenario==='guard_trial'?'防御成功 '+actionLesson.blocks+'回':challenge.points+'点';
  $('sortie-summary-time').textContent=formatBattleTime(challenge.elapsed);
  if(practice){
   $('result-title').textContent=({duel:'突き、成功。',thrust_trial:'突き、成功。',slash_trial:'斬撃、成功。',charge_trial:'突撃、成功。',jump_trial:'跳躍、成功。',guard_trial:'防御、成功。',awaken_trial:'覚醒の一撃、成功。',squad:'仲間の一撃、成功。'})[selectedScenario]||$('result-title').textContent;
   if(selectedScenario==='guard_trial')$('result-detail').textContent='敵の一撃を受け止めた。';
   $('result-detail').hidden=false;
  }else{
   $('result-title').textContent=g.battleScenario?.objective==='protect'?'王将、守り抜いた！':'王将討ち取り！';
   $('result-record').textContent=challengeSaved?'':'記録を保存できません';
   $('result-record').hidden=challengeSaved;
  }
  if(updated)sortieVictoryReceipt=challengeResult;
 }else sortieVictoryReceipt=null;
}
function finishChallengeRecord(){
 if(E.isSpectator(g)||g.arena&&!E.isStandardArmyArena(g)||g.capabilityLoadout||followupActive()||g.devEscortBrace===true){challengeResult=null;challengeSaved=false;return;}
 challengeResult=recordChallenge(challengeRecords,challenge);challengeRecords=challengeResult.book;challengeSaved=saveChallengeRecords(preferenceStorage,challengeRecords);
}
// One visible 成金 choice retains its actual promoted origin for canonical slots,
// saved settings and actor-bound optional capabilities. Never merge engine keys.
const promotedGoldPieces=Object.freeze(['tokin','promoted_lance','promoted_knight','promoted_silver']);
const isPromotedGold=piece=>promotedGoldPieces.includes(piece);
function promotedGoldOption(){return Array.from($('piece-choice').options||[]).find(option=>isPromotedGold(option.value));}
function stagePieceChoice(piece){const option=promotedGoldOption();if(option&&isPromotedGold(piece))option.value=piece;$('piece-choice').value=piece;}
function syncPromotedGoldChoice(handicap){
 const select=$('piece-choice'),option=promotedGoldOption();if(!option)return false;
 const previous=select.value,selected=isPromotedGold(previous),origin=selected?previous:option.value;
 const next=E.handicapAllows(handicap,origin)?origin:promotedGoldPieces.find(piece=>E.handicapAllows(handicap,piece));
 if(!next)return false;option.value=next;if(selected)select.value=next;
 return selected&&origin!==next;
}
// Guard only visible chapter IDs the loaded engine cannot execute. This does
// not certify a whole release version or change an already-running battle.
function syncBattleScenarioSelectionGuard(){
 const unavailable=$('scenario-choice').value==='army'&&Array.from($('battle-scenario-choice').options||[]).some(option=>option.value!=='free'&&!E.battleScenarioDefinition(option.value));
 $('start-battle').disabled=unavailable;
 if(unavailable)$('hero-adjustment').textContent='更新されています。再読み込みしてください';
 return unavailable;
}
// Practice and spectator always execute legacy ON without erasing the manual choice.
function syncAutomaticAllyReturnSetting(){
 const forced=$('scenario-choice').value!=='army'||$('control-mode').value==='spectator';
 $('automatic-ally-return').disabled=forced;$('automatic-ally-return').checked=forced||stagedAutomaticAllyReturn;
 $('automatic-ally-return-status').textContent=forced?'観戦・練習は ON 固定。敵も自動出撃。':stagedAutomaticAllyReturn?'ON：倒して仲間にした兵が、自動で戦場に出ます。敵の兵は常に自動出撃します。':'OFF：「持ち駒」を開き、種類を選んで1体ずつ出します。出る位置は自動です。敵の兵は自動出撃します。';
}
$('automatic-ally-return').onchange=()=>{if(!inLobby||$('lobby').hidden||$('automatic-ally-return').disabled)return;stagedAutomaticAllyReturn=$('automatic-ally-return').checked===true;syncAutomaticAllyReturnSetting();};
function syncHandicapReserveSetting(){const h=E.HANDICAPS[$('handicap-choice').value],available=$('scenario-choice').value==='army'&&!E.battleScenarioDefinition($('battle-scenario-choice').value)&&$('control-mode').value!=='spectator'&&!!h&&(h.solo===true||h.remove.length>0);$('handicap-reserve').disabled=!available;$('handicap-reserve').checked=available&&stagedHandicapReserve;$('handicap-enemy-deployment').disabled=!available||!stagedHandicapReserve;$('handicap-enemy-deployment').value=stagedHandicapDeployment;$('handicap-reserve-status').textContent=available?(stagedHandicapReserve?(stagedHandicapDeployment==='promoted-start'?'ON：王を除く駒落ち分が、元の味方位置に成駒の敵として並びます（金はそのまま）。':'ON：王を除く駒落ち分を敵の待機駒へ渡し、空き次第補充します。'):'OFF：駒落ち分は従来どおり盤上から除外。敵には渡しません。'):'自由設定の駒落ち・単騎だけで選べます。平手・観戦・固定シナリオ・練習には適用しません。';}
$('handicap-reserve').onchange=()=>{if(!inLobby||$('lobby').hidden||$('handicap-reserve').disabled)return;stagedHandicapReserve=$('handicap-reserve').checked===true;syncHandicapReserveSetting();};
$('handicap-enemy-deployment').onchange=()=>{if(!inLobby||$('lobby').hidden||$('handicap-enemy-deployment').disabled)return;stagedHandicapDeployment=$('handicap-enemy-deployment').value==='promoted-start'?'promoted-start':'reserve';syncHandicapReserveSetting();};
const scenarioSettingIds=['control-mode','terrain-choice','handicap-choice','ally-formation','formation-choice','piece-choice','difficulty-choice','ally-equipment','enemy-equipment','ally-strategy','enemy-strategy','ally-king-personality','enemy-king-personality','ally-cell-size','enemy-cell-size','ally-focus','enemy-focus'];
let scenarioHintContext=null;
function campaignTitle(id){const m=E.battleScenarioDefinition(id);return m?m.order+'. '+m.name:'10. 群雄、天下布武';}
function syncBattleScenarioPanel(m){
 const context=m?.id||null;if(context!==scenarioHintContext){$('battle-scenario-hints').open=false;scenarioHintContext=context;}
 const practice=$('scenario-choice').value!=='army';$('battle-scenario-picker').hidden=practice;$('battle-scenario-briefing').hidden=!m;$('lobby').setAttribute('data-battle-scenario',m?.id||'free');if(!m)return;
 if(!m.pieces.includes($('piece-choice').value))stagePieceChoice(m.pieces[0]);
 $('control-mode').value='manual';$('handicap-choice').value='even';$('terrain-choice').value=m.terrain;$('formation-choice').value=m.formation;$('ally-formation').value=m.allyFormation;$('difficulty-choice').value=m.difficulty;
 for(const team of ['ally','enemy']){$(team+'-equipment').value=team==='enemy'?(m.enemyEquipment||'light'):'light';$(team+'-strategy').value=m[team+'Strategy'];$(team+'-cell-size').value='1';$(team+'-focus').value='balanced';$(team+'-king-personality').value=m[team+'KingPersonality']||'defensive';}
 $('battle-scenario-title').textContent=campaignTitle(m.id);$('battle-scenario-background').textContent=m.level+'。'+m.background;
 $('battle-scenario-orders').textContent='作戦：味方 '+E.STRATEGIES[m.allyStrategy].name+'／敵 '+E.STRATEGIES[m.enemyStrategy].name+'。'+(m.allyKingPersonality==='midgame'?' 自動操作の味方王は中盤から進軍。':'')+(m.id==='final_siege'?' 難易度：標準固定。':'');
 $('battle-scenario-objective').textContent=m.objective==='protect'?'勝利：王を'+m.duration+'秒守る、または王が生存したまま敵を全て退ける。王は自動操作・切替不可。敗北：王か操作中の駒が倒れる。':(['king_command','final_siege'].includes(m.id)?'勝利：敵の王将を討ち取る。敗北：味方の王か操作中の駒が倒れる。操作を切り替えても王を守る。':'勝利：敵の王将を討ち取る。敗北：操作中の駒が倒れる。');$('battle-scenario-hint').textContent=m.hint;
}
$('battle-scenario-choice').value=selectedBattleScenario;
$('battle-scenario-choice').onchange=()=>{const next=E.battleScenarioDefinition($('battle-scenario-choice').value)?$('battle-scenario-choice').value:'free';if(stagedBattleScenario==='free'&&next!=='free')freeStagedSettings=Object.fromEntries(scenarioSettingIds.map(id=>[id,$(id).value]));if(next==='free'){if(freeStagedSettings)for(const [id,value]of Object.entries(freeStagedSettings))$(id).value=value;else stagePieceChoice(selectedArmyPiece);}stagedBattleScenario=next;$('battle-scenario-choice').value=next;lobbySummary();};
// Move the existing start control with the active selector; never clone its state or handler.
function syncStartBattlePosition(practice){
 const anchor=practice?$('lesson-choice-label'):$('battle-scenario-choice').parentElement,start=$('start-battle');
 if(anchor.nextElementSibling===start)return;
 const focused=document.activeElement===start;anchor.insertAdjacentElement('afterend',start);
 if(focused)start.focus({preventScroll:true});
}
function lobbySummary(){const mission=$('scenario-choice').value==='army'?E.battleScenarioDefinition($('battle-scenario-choice').value):null;syncBattleScenarioPanel(mission);syncHandicapReserveSetting();syncAutomaticAllyReturnSetting();const equipmentStats=syncEquipmentStats();const scenario=$('scenario-choice').value,practice=scenario!=='army',handicap=$('handicap-choice').value;$('hero-adjustment').textContent=syncPromotedGoldChoice(handicap)?'駒落ちに合わせて、成金の開始位置を変更しました。':'';for(const option of $('piece-choice').options||[])option.disabled=mission?!mission.pieces.includes(option.value):!E.handicapAllows(handicap,option.value);if(!practice&&!E.handicapAllows(handicap,$('piece-choice').value)){const old=E.PIECES[$('piece-choice').value]?.name||'選択した駒';$('piece-choice').value='king';$('hero-adjustment').textContent=old+'はこの駒落ちに含まれないため、主人公を王将に変更しました。';}
 syncStartBattlePosition(practice);
 $('solo-guidance').hidden=true;$('control-mode').disabled=practice;$('hero-choice-title').textContent=!practice&&$('control-mode').value==='spectator'?'主人公（NPC・体力'+equipmentStats.ally.hp+'）':'主人公（体力3）';syncAbilityPanel();
 $('army-preparation').hidden=practice;$('terrain-choice').disabled=practice;$('terrain-help').hidden=true;$('match-options').hidden=practice;$('team-attributes').hidden=practice;$('match-summary').textContent='';$('lesson-choice-label').hidden=!practice;$('tutorial-guide').hidden=$('scenario-choice').value!=='switch_trial';$('lobby-title').textContent=practice?'チュートリアル':campaignTitle($('battle-scenario-choice').value);$('start-battle').textContent=practice?'この練習を始める':$('control-mode').value==='spectator'?'この設定で観戦':'この設定で出撃';$('handicap-choice').disabled=$('ally-formation').disabled=$('formation-choice').disabled=$('piece-choice').disabled=practice; if(mission){$('control-mode').disabled=$('handicap-choice').disabled=$('ally-formation').disabled=$('formation-choice').disabled=$('terrain-choice').disabled=true;$('match-options').hidden=$('abilities-options').hidden=$('abilities-unavailable').hidden=true;$('lobby-title').textContent=campaignTitle(mission.id);$('start-battle').textContent='このシナリオに挑む';}
 $('tutorial-instruction').textContent=$('scenario-choice').value==='switch_trial'?'①「戦況・交代」で金将を選び、操作を切り替える。②金将で正面の敵に近づき「攻撃」で倒す。交代前に倒したら再挑戦できます。':'';$('lobby-summary').hidden=true;$('lobby-summary').textContent='';$('lobby-rule').hidden=true;$('lobby-rule').textContent='';if(!practice&&heavyChallengeStaged&&$('enemy-equipment').value==='heavy'){$('lobby-rule').hidden=false;$('lobby-rule').textContent='敵を重装に変更：体力3・移動はゆっくり。'+($('piece-choice').value==='king'?'赤い予告を防御し、攻撃後の隙を狙おう。':'敵の攻撃を避け、隙を狙おう。');}syncBattleScenarioSelectionGuard();}
function prepareOverlay(){$('final-challenge').hidden=true;closeCapturedReturn();advanceSimulation.reset(g);heroHitFeedback.reset();hideTactics();hideCombo();settingsOpen=false;settingsWasPaused=false;$('settings').hidden=true;$('options').setAttribute('aria-expanded','false');inLobby=true;paused=true;clearInput();window.BattleAudio.prepare?.();$('paused').hidden=true;$('result').hidden=true;}
function openLobby(route='preparation'){stagedHandicapReserve=selectedHandicapReserve;stagedHandicapDeployment=selectedHandicapDeployment;stagedAutomaticAllyReturn=selectedAutomaticAllyReturn;$('battle-scenario-hints').open=false;heavyChallengeStaged=false;freeStagedSettings=null;stagedBattleScenario=selectedBattleScenario;$('battle-scenario-choice').value=selectedBattleScenario;restoreAbilityStage();$('abilities-options').open=false;$('match-options').open=false;prepareOverlay();$('start-menu').hidden=true;$('lobby').hidden=false;$('lobby').scrollTop=0;$('scenario-choice').value=route==='tutorial'?(selectedScenario!=='army'?selectedScenario:'duel'):'army';$('handicap-choice').value=selectedHandicap;$('ally-formation').value=selectedAllyFormation;$('formation-choice').value=selectedFormation;stagePieceChoice(selectedArmyPiece);$('control-mode').value=selectedControlMode;$('difficulty-choice').value=selectedDifficulty;$('terrain-choice').value=selectedTerrain;for(const team of ['ally','enemy']){$(team+'-strategy').value=selectedStrategies[team];$(team+'-cell-size').value=String(selectedTeamTactics[team].cellSize);$(team+'-focus').value=selectedTeamTactics[team].focus;$(team+'-king-personality').value=selectedKingPersonalities[team];}for(const team of ['ally','enemy'])$(team+'-equipment').value=selectedTeamStats[team].equipment;freeStagedSettings=Object.fromEntries(scenarioSettingIds.map(id=>[id,$(id).value]));if(selectedBattleScenario!=='free'&&selectedMissionPiece)stagePieceChoice(selectedMissionPiece);lobbySummary();$('lobby-back').focus({preventScroll:true});}
// Initial entry focuses the labelled dialog, leaving both choices unselected.
// Later returns keep the first choice focused for keyboard navigation.
function openMenu(initial=false){heavyChallengeStaged=false;prepareOverlay();$('lobby').hidden=true;$('start-menu').hidden=false;$('start-menu').scrollTop=0;$(initial===true?'start-menu':'menu-tutorial').focus({preventScroll:true});}
for(const id of ['control-mode','terrain-choice','scenario-choice','handicap-choice','ally-formation','formation-choice','piece-choice','difficulty-choice','ally-equipment','enemy-equipment','ally-strategy','enemy-strategy','ally-king-personality','enemy-king-personality','ally-cell-size','enemy-cell-size','ally-focus','enemy-focus'])$(id).onchange=lobbySummary;
$('menu-tutorial').onclick=()=>openLobby('tutorial');$('menu-preparation').onclick=()=>openLobby('preparation');$('lobby-back').onclick=openMenu;
$('start-battle').onclick=()=>{if($('lobby').hidden||syncBattleScenarioSelectionGuard())return;lobbySummary();selectedScenario=$('scenario-choice').value;selectedDevEscortBrace=DEVELOPMENT_OPTIONS&&$('dev-escort-brace').checked===true;selectedAutomaticAllyReturn=stagedAutomaticAllyReturn;selectedHandicapReserve=stagedHandicapReserve;selectedHandicapDeployment=stagedHandicapDeployment;if(selectedScenario==='army')selectedBattleScenario=E.battleScenarioDefinition($('battle-scenario-choice').value)?$('battle-scenario-choice').value:'free';const mission=selectedScenario==='army'?E.battleScenarioDefinition(selectedBattleScenario):null;if(!mission)selectedDifficulty=$('difficulty-choice').value;if(selectedScenario==='army'&&!mission){selectedControlMode=$('control-mode').value==='spectator'?'spectator':'manual';selectedTerrain=$('terrain-choice').value==='three_bridges'?'three_bridges':'plain';selectedHandicap=$('handicap-choice').value;selectedAllyFormation=$('ally-formation').value;selectedFormation=$('formation-choice').value;selectedArmyPiece=$('piece-choice').value;selectedTeamStats=syncEquipmentStats();selectedTeamTactics=E.normalizeTeamTactics(Object.fromEntries(['ally','enemy'].map(team=>[team,{cellSize:Number($(team+'-cell-size').value),focus:$(team+'-focus').value}])));selectedStrategies=E.normalizeStrategies({ally:$('ally-strategy').value,enemy:$('enemy-strategy').value});selectedKingPersonalities=E.normalizeKingPersonalities({ally:$('ally-king-personality').value,enemy:$('enemy-king-personality').value});}if(mission)selectedMissionPiece=$('piece-choice').value;selectedPiece=selectedScenario==='army'?(mission?selectedMissionPiece:selectedArmyPiece):drills[selectedScenario].piece;if(mission){selectedCapabilities=null;selectedFollowups=[];}if(DEVELOPMENT_OPTIONS&&selectedScenario==='army'&&!mission&&selectedControlMode!=='spectator'){selectedCapabilities=stagedAbilityManifest();selectedFollowups=E.CapabilityRuntime?[...stagedFollowups].filter(action=>baseAbilities(selectedPiece).includes(action)&&!stagedDisabled.has(action)):[];}try{reset();}catch(error){paused=true;inLobby=true;clearInput();$('hero-adjustment').textContent=error?.code==='HANDICAP_DEPLOYMENT_INVALID'?'駒落ち分の敵を安全に配置できません。待機方式に戻して再試行してください。':'出撃を開始できませんでした。設定を確認して再試行してください。';return;}if(selectedControlMode==='spectator'||!selectedCapabilities&&!selectedFollowups.length)savePreferences(preferenceStorage,{...(selectedHandicapReserve?{handicapToEnemyReserve:true,handicapEnemyDeployment:selectedHandicapDeployment}:{}),...(selectedAutomaticAllyReturn===false?{automaticAllyReturn:false}:{}),...(selectedControlMode==='spectator'?{controlMode:'spectator'}:{}),...(selectedBattleScenario!=='free'?{battleScenario:selectedBattleScenario,missionPiece:selectedMissionPiece}:{}),terrain:selectedTerrain,scenario:selectedScenario,difficulty:selectedDifficulty,piece:selectedArmyPiece,strategies:selectedStrategies,teamTactics:selectedTeamTactics,kingPersonalities:selectedKingPersonalities,teamStats:selectedTeamStats,handicap:selectedHandicap,enemyFormation:selectedFormation,allyFormation:selectedAllyFormation});inLobby=false;$('lobby').hidden=true;$('start-menu').hidden=true;updateUI();window.BattleAudio.beginBattle?.();};
const lessonOrder=['duel','thrust_trial','slash_trial','charge_trial','jump_trial','guard_trial','awaken_trial','squad','switch_trial'];
$('retry-battle').onclick=()=>{if(inLobby||$('result').hidden||!E.battleEnded(g)&&!lessonEnded())return;reset();window.BattleAudio.beginBattle?.();};
function canOfferHeavyChallenge(){return !g.battleScenario&&!E.isSpectator(g)&&(!g.arena||E.isStandardArmyArena(g))&&!g.capabilityLoadout&&!followupActive()&&g.devEscortBrace!==true&&g.won&&selectedScenario==='army'&&['ally','enemy'].every(team=>selectedTeamTactics[team].cellSize===1&&selectedTeamTactics[team].focus==='balanced')&&selectedTerrain==='plain'&&selectedDifficulty==='normal'&&selectedHandicap==='solo'&&selectedArmyPiece==='king'&&g.piece==='king'&&selectedAllyFormation==='initial'&&selectedTeamStats.ally.equipment==='light'&&selectedTeamStats.enemy.equipment==='light'&&selectedStrategies.ally==='balanced'&&selectedStrategies.enemy==='defensive'&&selectedKingPersonalities.ally==='defensive'&&selectedKingPersonalities.enemy==='defensive';}
function prepareMainCampaign(){selectedBattleScenario='first_sortie';selectedMissionPiece=E.battleScenarioDefinition('first_sortie').pieces[0];openLobby('preparation');}
function canOfferFinalChallenge(){return selectedScenario==='army'&&!g.battleScenario&&g.won&&!E.isSpectator(g)&&!!E.battleScenarioDefinition('final_siege');}
$('final-challenge').onclick=()=>{if(inLobby||$('result').hidden||!canOfferFinalChallenge())return;selectedBattleScenario='final_siege';selectedMissionPiece='king';openLobby('preparation');};
function nextBattleScenario(){const m=g.battleScenario&&E.battleScenarioDefinition(g.battleScenario.id);return m?(Object.values(E.BATTLE_SCENARIOS).find(n=>n.order===m.order+1)||(m.id==='final_siege'?{id:'free',pieces:[selectedArmyPiece]}:null)):null;}
$('next-lesson').onclick=()=>{if(inLobby)return;if(g.battleScenario){const next=nextBattleScenario();if($('result').hidden||!g.won||!next)return;selectedBattleScenario=next.id;selectedMissionPiece=next.pieces[0];openLobby('preparation');return;}if(actionLessonEnded()){if($('result').hidden||actionLesson.status!=='complete')return;selectedScenario=lessonOrder[lessonOrder.indexOf(selectedScenario)+1]||'army';if(selectedScenario==='army')prepareMainCampaign();else openLobby('tutorial');return;}if(selectedScenario==='squad'&&recruitEnded()){if($('result').hidden||recruitLesson.status!=='complete')return;selectedScenario='switch_trial';openLobby('tutorial');return;}if(!g.won)return;if(selectedScenario==='army'){if($('result').hidden||!canOfferHeavyChallenge())return;openLobby('preparation');heavyChallengeStaged=true;$('enemy-equipment').value='heavy';$('match-options').open=true;lobbySummary();return;}const next=lessonOrder[lessonOrder.indexOf(selectedScenario)+1];if(!next){selectedScenario='army';prepareMainCampaign();return;}selectedScenario=next;openLobby('tutorial');};
$('formation-open').onclick=()=>openLobby('preparation');$('practice-open').onclick=()=>openLobby('tutorial');
function togglePace(){if(E.isSpectator(g))return;if(g.teamStats?.ally.equipment==='heavy')return;walking=!walking;$('pace').textContent=walking?'移動：歩く':'移動：走る';$('pace').setAttribute('aria-pressed',String(walking));}
$('pace').addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;e.preventDefault();togglePace();});$('pace').onclick=e=>{if(!e||e.detail===0)togglePace();};
function getInput(){if(E.isSpectator(g)){input.x=input.z=0;input.maxDistance=undefined;return input;}syncGuardIntent();input.moveSpeed=E.movementSpeed(g,'ally',!(walking||keys.has('Shift')));let x=pad.x,z=pad.z;input.maxDistance=undefined;const lastKey=[...keys].filter(k=>keyDirections[k]).at(-1);if(lastKey)[x,z]=keyDirections[lastKey];if(destination&&!x&&!z){const dx=destination.x-g.player.x,dz=destination.z-g.player.z;if(Math.abs(dx)<.001&&Math.abs(dz)<.001)destination=null;else{const next=E.direction(g,dx,dz);x=next.x;z=next.z;
 // The last path step must end at the target, even on a slow frame. Use
 // full cardinal input so a short remaining distance is not a dead zone.
 if(!x&&!z){if(E.pieceKey(g)==='rook'){if(Math.abs(dx)>=Math.abs(dz))x=Math.sign(dx);else z=Math.sign(dz);}else{destination=null;input.x=input.z=0;return input;}}
 input.maxDistance=x&&z?Math.hypot(dx,dz):Math.abs(x?dx:dz);}}if(E.pieceKey(g)==='knight'){x=z=0;}input.x=x;input.z=z;return input;}
// Idle, grounded facing responds before the next render, so a short released
// tap still directs the next attack. Committed actions and movement stay in
// engine.step; this neither queues an attack nor changes an in-flight wave.
function faceMovementInput(){if(E.isSpectator(g))return;getInput();if(g.guarding||g.mode!=='ready'||Math.abs(g.player.y||0)>1e-9)return;E.aim(g,input.x,input.z);renderDirty=true;updateUI();}
// Choose only existing abilities. Direction is sampled on the press edge, never
// queued by a held attack button; release cannot transform an admitted action.
function attackDirection(){let x=pad.x,z=pad.z;if(!x&&!z&&assistiveAttackDirection)({x,z}=assistiveAttackDirection);const key=[...keys].filter(k=>keyDirections[k]).at(-1);if(key)[x,z]=keyDirections[key];return {x,z};}
function unifiedAttackChoice(){
 const {x,z}=attackDirection(),directed=!!(x||z),key=E.pieceKey(g),has=action=>E.heroHasAbility(g,action);
 if(key==='knight'&&has('jump'))return {kind:'jump',x,z};
 if(directed&&E.capabilityInfo(g).forwardHop&&has('jump'))return {kind:'jump',x,z};
 if(directed&&E.isStepDirection(g,x,z)&&E.allowed(g,x,z)&&has('step_attack'))return {kind:'dragon',x,z};
 if(directed&&has('charge')&&E.allowed(g,x,z)&&!E.isStepDirection(g,x,z))return {kind:'charge',x,z};
 const kind=['thrust','sweep','jump','charge'].find(has);return {kind:kind||null,x,z};
}
// One fresh ordinary ground press may bridge only the final100ms of recovery.
// Explicit follow-up combos keep their separate existing queue and rules.
function ordinaryBufferWindow(kind){
 if(!['thrust','sweep','charge'].includes(kind)||followupActive()||followupOffer(kind).enabled||followup.attackLock(g)>0||inLobby||paused||settingsOpen||tacticalOpen||E.battleEnded(g)||lessonEnded()||g.hp<=0||g.guarding||guardHeld()||E.isSpectator(g))return false;
 if(!(g.mode==='ready'||kind!=='charge'&&g.mode===kind))return false;
 const r=actionReadiness(E,g,kind);return r.state==='cooldown'&&r.remaining>0&&r.remaining<=.1+1e-9;
}
function dispatchOrdinaryAttackBuffer(){
 const q=ordinaryAttackBuffer;if(!q)return;
 if(q.game!==g||q.actorId!==g.playerId||q.piece!==E.pieceKey(g)||q.hp!==g.hp||g.time>q.expires||![q.mode,'ready'].includes(g.mode)||inLobby||paused||settingsOpen||tacticalOpen||E.battleEnded(g)||lessonEnded()||g.guarding||guardHeld()||followupActive()||followupOffer(q.kind).enabled){ordinaryAttackBuffer=null;return;}
 if(actionReadiness(E,{...g,player:{...g.player,...q.face}},q.kind).state!=='ready')return;
 ordinaryAttackBuffer=null;const result=attack(q.kind,q.x,q.z,{token:q.token,bufferDispatch:true,face:q.face});
 if(result?.accepted)for(const [id,owner] of attackPointerOwners)if(owner===q.pointerOwner&&q.token==='pointer:'+id&&owner.game===g&&owner.actorId===g.playerId&&owner.epoch===attackInputEpoch)owner.visualSerial=ordinaryAttackCycle.view(g)?.actionSerial??null;
}
function unifiedAttack(edge=null){const choice=unifiedAttackChoice();return choice.kind?attack(choice.kind,choice.x,choice.z,edge):null;}
function attack(kind,x=0,z=0,edge=null){if(E.isSpectator(g))return;if(followup.attackLock(g)>0||paused||settingsOpen||E.battleEnded(g)||lessonEnded()||g.guarding||guardHeld())return;const ability=kind==='dragon'?(E.pieceKey(g)==='knight'?'jump':'step_attack'):kind;if(!E.heroHasAbility(g,ability))return;getInput();E.aim(g,edge?.bufferDispatch?edge.face.dx:input.x,edge?.bufferDispatch?edge.face.dz:input.z);
 const ground=['thrust','sweep','charge'].includes(kind),useFollowup=ground&&followupOffer(kind).enabled,token=edge?.token||'click:'+kind+':'+(++followupClickSerial);
 const request=useFollowup?followup.press(g,kind,{token,repeat:!!edge?.repeat}):null;
 const ok=useFollowup?request.accepted:kind==='thrust'?E.thrust(g):kind==='jump'?E.jump(g,x||input.x,z||input.z):kind==='sweep'?E.sweep(g):kind==='dragon'?(E.pieceKey(g)==='knight'?E.knightJump(g,x):E.dragonStep(g,x,z)):E.charge(g);
 if(!ok&&!useFollowup&&!edge?.bufferDispatch&&!edge?.repeat&&!ordinaryAttackBuffer&&ordinaryBufferWindow(kind)){
  ordinaryAttackBuffer={pointerOwner:[...attackPointerOwners].find(([id])=>token==='pointer:'+id)?.[1]||null,game:g,actorId:g.playerId,piece:E.pieceKey(g),hp:g.hp,mode:g.mode,kind,x,z,token,face:{dx:g.player.dx,dz:g.player.dz},expires:g.time+.12};renderDirty=true;updateUI();return {accepted:true,queued:true,tracked:false,buffered:true};
 }
 if(ok)ordinaryAttackBuffer=null;
 if(useFollowup&&!edge)followup.release(token);
 if(ok){if(!request?.queued){noteChallengeAction(challenge,kind);ordinaryAttackCycle.accepted(g,kind,{explicit:useFollowup||selectedScenario!=='army'});}if(!ground)followup.clearIntent(g,'other-action-admitted');window.BattleAudio.resume?.();if(g.mode==='jump')window.BattleAudio.action?.('jump');else if(g.mode==='dragon')window.BattleAudio.action?.('sweep');destination=null;renderDirty=true;$('hint').classList.add('hide');updateUI();}return {accepted:!!ok,queued:!!request?.queued,tracked:useFollowup,serial:useFollowup?followup.snapshot().chain?.serial:null};}
// A held request is owned by its pointer/keys and the current actor. It can
// wait for the existing engine gate, but never cancels or shortens an action.
function guardHeld(){return guardId!==null||guardKeys.size>0;}
function canRequestGuard(){return g.hp>0&&g.player?.alive!==false&&!E.isSpectator(g)&&!paused&&!settingsOpen&&!inLobby&&!E.battleEnded(g)&&!lessonEnded()&&E.heroHasAbility(g,'guard');}
function syncGuardIntent(){
 if(!guardHeld())return;
 if(!canRequestGuard()||guardActorId!==g.playerId){clearInput();return;}
 if(!g.guarding&&E.canGuard(g))E.setGuard(g,true);
}
function beginGuard(source,value){
 if(!canRequestGuard())return false;
 ordinaryAttackCycle.breakChain();
 // An assistive click keeps the existing immediate toggle, not a queued tap.
 if(!source){if(guardHeld()||!E.canGuard(g))return false;clearInput();E.setGuard(g,true);updateUI();return true;}
 if(!guardHeld()){clearInput();guardActorId=g.playerId;}
 if(source==='pointer')guardId=value;else guardKeys.add(value);
 syncGuardIntent();updateUI();return true;
}
function endGuard(){clearInput();updateUI();}
function releaseGuard(source,value){
 if(source==='pointer'){if(value!==guardId)return;guardId=null;}
 else{if(!guardKeys.delete(value))return;}
 if(!guardHeld())endGuard();else updateUI();
}
$('guard').addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0||guardId!==null&&guardId!==e.pointerId)return;e.preventDefault();if(beginGuard('pointer',e.pointerId))$('guard').setPointerCapture(e.pointerId);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('guard').addEventListener(type,e=>releaseGuard('pointer',e.pointerId));
$('guard').addEventListener('click',e=>{if(e.detail===0&&!guardHeld()){if(g.guarding)endGuard();else if(canRequestGuard())beginGuard();}});
$('guard').addEventListener('keydown',e=>{if(!ignoreGameKey(e)&&[' ','Enter'].includes(e.key)){showInputHints('keyboard');e.preventDefault();if(!e.repeat)beginGuard('key',e.key);}});
$('guard').addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();releaseGuard('key',e.key);}});
$('guard').addEventListener('blur',()=>{if(g.guarding||guardHeld())endGuard();});window.addEventListener('keyup',e=>{releaseGuard('key',e.key);if(e.key?.toLowerCase()==='f'||e.code==='KeyF')releaseGuard('key','shortcut:f');},true);
function charge(edge=null){attack('charge',0,0,edge);}
// Capture belongs to a physical press, not to every later event with its ID.
// W3C Pointer Events 3: pointerup/pointercancel normally precede implicit loss.
function clearAttackPointerOwners(){const previous=[...attackPointerOwners];attackPointerOwners.clear();for(const [id,owner] of previous)try{if(owner.node.hasPointerCapture?.(id))owner.node.releasePointerCapture?.(id);}catch{}}
function ownedAttackIntent(owner){const chain=followup.snapshot().chain;return !!(owner?.ownsIntent&&owner.game===g&&owner.actorId===g.playerId&&owner.epoch===attackInputEpoch&&owner.serial===chain?.serial);}
function finishAttackPointer(pointerId,reason,node=null){
 const owner=attackPointerOwners.get(pointerId),token='pointer:'+pointerId;
 if(node&&(!owner||owner.node!==node))return;
 // Remove ownership before implicit/explicit release can deliver a later loss.
 if(owner)attackPointerOwners.delete(pointerId);
 if(reason!=='up'&&owner&&ordinaryAttackBuffer?.pointerOwner===owner&&ordinaryAttackBuffer?.token===token)ordinaryAttackBuffer=null;
 const cancel=reason!=='up'&&ownedAttackIntent(owner);
 if(reason!=='up'&&owner?.game===g&&owner.actorId===g.playerId&&owner.epoch===attackInputEpoch&&Number.isInteger(owner.visualSerial))ordinaryAttackCycle.breakChain(owner.visualSerial);
 if(cancel){ordinaryAttackCycle.breakChain();followup.clearIntent(g,reason==='lost'?'attack-capture-lost':'attack-pointer-cancel');}
 // A lost capture alone does not end an active stream. Its owning input stays
 // blocked until a real up/cancel; normal loss after up has no owner and is inert.
 // Admission advances serial, but it does not end the physical stream that
 // reserved it. Retain that held token through loss until a real up/cancel.
 const trackedLoss=reason==='lost'&&owner?.ownsIntent&&owner.game===g&&owner.actorId===g.playerId&&owner.epoch===attackInputEpoch;
 if(reason!=='lost'||!trackedLoss)followup.release(token);
 if(cancel)updateUI();
}
function releaseAttackButtonKey(key){const owner=attackButtonKeys.get(key);if(!owner)return;attackButtonKeys.delete(key);followup.release(owner.token);}
for(const [id,kind] of [['attack','unified']]){
 const node=$(id),invoke=edge=>unifiedAttack(edge);
 node.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0||attackPointerOwners.has(e.pointerId))return;e.preventDefault();const owner={node,game:g,actorId:g.playerId,epoch:attackInputEpoch,ownsIntent:false,serial:null};attackPointerOwners.set(e.pointerId,owner);try{node.setPointerCapture(e.pointerId);}catch{}const result=invoke({token:'pointer:'+e.pointerId});owner.ownsIntent=!!(result?.accepted&&result.tracked);owner.serial=result?.serial??null;owner.visualSerial=result?.accepted&&!result.tracked&&!result.buffered?ordinaryAttackCycle.view(g)?.actionSerial??null:null;});
 node.addEventListener('pointerup',e=>finishAttackPointer(e.pointerId,'up',node));
 node.addEventListener('pointercancel',e=>finishAttackPointer(e.pointerId,'cancel',node));
 node.addEventListener('lostpointercapture',e=>finishAttackPointer(e.pointerId,'lost',node));
 node.addEventListener('keydown',e=>{if(!ignoreGameKey(e)&&[' ','Enter'].includes(e.key)){showInputHints('keyboard');e.preventDefault();if(e.repeat||attackButtonKeys.has(e.key))return;const token='button-key:'+id+':'+e.key;attackButtonKeys.set(e.key,{node,token});invoke({token});}});
 node.addEventListener('keyup',e=>releaseAttackButtonKey(e.key));
 node.addEventListener('click',e=>{if(e.detail===0)invoke();});
}
// Capture-phase cleanup also catches a mouse release outside the button and a
// focused-button key release after focus has moved. Local handlers are idempotent.
window.addEventListener('pointerup',e=>finishAttackPointer(e.pointerId,'up'),true);
window.addEventListener('pointercancel',e=>finishAttackPointer(e.pointerId,'cancel'),true);
// A jump disables its pressed arrow immediately. Its release may be retargeted
// outside that button, so movement ownership also ends at the window boundary.
function releaseMovementPointer(e){if(e.pointerId!==padId)return;padId=null;pad.x=pad.z=0;showPad();updateUI();}
window.addEventListener('pointerup',releaseMovementPointer,true);
window.addEventListener('pointercancel',releaseMovementPointer,true);
window.addEventListener('keyup',e=>releaseAttackButtonKey(e.key),true);
// Prefer actual input capability/use over a device-name guess. Touch controls
// remain available in both modes; hints never participate in button layout.
const keyboardPointer=matchMedia('(hover:hover) and (pointer:fine)');
function showInputHints(mode){$('game').setAttribute('data-input',mode);}
showInputHints(keyboardPointer.matches?'keyboard':'touch');
keyboardPointer.addEventListener?.('change',e=>showInputHints(e.matches?'keyboard':'touch'));
window.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.pointerType==='pen')showInputHints('touch');else if(e.pointerType==='mouse')showInputHints('keyboard');},true);
// Remember the admitted key label by physical key, so layout/IME changes
// before keyup cannot leave movement or an attack token held.
function rememberGameKey(e,k){if(e.code&&!e.repeat)keyCodes.set(e.code,k);}
function releaseGameKey(e){const k=keyCodes.get(e.code)??(e.key.length===1?e.key.toLowerCase():e.key);if(e.code)keyCodes.delete(e.code);if([...keyCodes.values()].includes(k))return;keys.delete(k);followup.release('key:'+k);updateUI();}
function ignoreGameKey(e){return e.defaultPrevented||e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey||e.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||!!e.target?.closest?.('[contenteditable]:not([contenteditable="false"])');}
window.addEventListener('keydown',e=>{if(ignoreGameKey(e))return;showInputHints('keyboard');if(E.isSpectator(g)||inLobby||settingsOpen||paused||E.battleEnded(g)||lessonEnded())return;const k=e.key.length===1?e.key.toLowerCase():e.key;if(k==='Shift'){rememberGameKey(e,k);keys.add(k);return;}if([' ','Enter'].includes(k)&&(e.target.tagName==='BUTTON'||e.target.closest?.('button,[role=button]')))return;if(k==='f'){if(!e.repeat&&canRequestGuard()){e.preventDefault();beginGuard('key','shortcut:f');}return;}if(keyDirections[k]){e.preventDefault();const [x,z]=keyDirections[k];if(!E.allowed(g,x,z)&&!(E.pieceKey(g)==='knight'&&x&&z<0))return;if(!e.repeat){rememberGameKey(e,k);const fresh=!keys.has(k);assistiveAttackDirection=null;keys.delete(k);keys.add(k);destination=null;faceMovementInput();if(fresh&&E.pieceKey(g)==='knight'&&x&&z<0)attack('jump',x,z);}}else if([' ','j','k','l'].includes(k)){e.preventDefault();if(!e.repeat){rememberGameKey(e,k);unifiedAttack({token:'key:'+k});}}});
window.addEventListener('keyup',releaseGameKey);
for(const [id,x,z] of moveButtons){const el=$(id);el.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;e.preventDefault();if(E.isSpectator(g)||paused||settingsOpen||E.battleEnded(g)||lessonEnded()||padId!==null&&padId!==e.pointerId)return;if(!E.allowed(g,x,z)&&!(E.pieceKey(g)==='knight'&&x&&z<0))return;if(E.pieceKey(g)==='knight'&&padId!==null)return;assistiveAttackDirection=null;padId=e.pointerId;try{el.setPointerCapture(e.pointerId);}catch{}pad={x,z};destination=null;faceMovementInput();showPad();$('hint').classList.add('hide');if(E.pieceKey(g)==='knight'&&x&&z<0)attack('jump',x,z);});el.addEventListener('pointermove',e=>{if(e.pointerId!==padId)return;e.preventDefault();const r=$('dpad').getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dz=e.clientY-r.top-r.height/2;pad=Math.hypot(dx,dz)>r.width*.15?(E.pieceKey(g)==='knight'?{x:Math.sign(dx),z:dz<0?-1:0}:E.direction(g,dx,dz)):{x:0,z:0};if(E.pieceKey(g)==='knight'&&(!pad.x||pad.z>=0))pad={x:0,z:0};faceMovementInput();showPad();});for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,releaseMovementPointer);el.addEventListener('click',e=>{if(e.detail===0&&!E.isSpectator(g)&&!paused&&!settingsOpen&&!E.battleEnded(g)&&!lessonEnded()){if(E.pieceKey(g)==='knight'&&x&&z<0){assistiveAttackDirection={x,z};attack('jump',x,z);updateUI();return;}if(!E.allowed(g,x,z))return;assistiveAttackDirection=E.isStepDirection(g,x,z)?{x,z}:null;setDestination(g.player.x+x*2.4,g.player.z+z*2.4);}});}
// The battlefield never starts movement: missed buttons are inert.
$('reset').onclick=()=>selectedScenario==='army'?openMenu():openLobby('tutorial');$('again').onclick=openMenu;$('resume').onclick=()=>{if(inLobby||settingsOpen||tacticalOpen||!$('result').hidden||$('paused').hidden)return;if(lessonEnded()){showEndedLesson(true);$('paused').hidden=true;return;}window.BattleAudio.resume?.();paused=false;$('paused').hidden=true;last=performance.now();};let settingsWasPaused=false;function options(open){if(inLobby||E.battleEnded(g)||lessonEnded()||open===settingsOpen)return;closeCapturedReturn();if(open)settingsWasPaused=tacticalOpen?tacticalWasPaused:paused;settingsOpen=open;$('settings').hidden=!open;$('options').setAttribute('aria-expanded',String(open));clearInput();if(open){advanceSimulation.reset(g);hideTactics();paused=true;$('paused').hidden=true;$('close-settings').focus();}else{paused=settingsWasPaused;$('paused').hidden=!paused;last=performance.now();$(paused?'resume':'options').focus({preventScroll:true});}}$('options').onclick=()=>{if(!inLobby)options(!settingsOpen);};$('close-settings').onclick=()=>options(false);$('intensity').onclick=()=>{intense=!intense;$('intensity').textContent=intense?'演出：通常':'演出：ひかえめ';$('intensity').setAttribute('aria-pressed',String(intense));if(!intense)$('battle-event').setAttribute('data-reward-tier','0');};$('shake').onclick=()=>{shake=!shake;$('shake').textContent=shake?'画面のゆれ：ON':'画面のゆれ：OFF';$('shake').setAttribute('aria-pressed',String(shake));};document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('blur',stop);window.addEventListener('pagehide',stop);$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();stop();showFailure('3D描画が一時停止しました。再読み込みすると、もう一度あそべます');});
// Keep capability/readiness labels independent of the temporary guard lock.
// Stable nodes receive only changed values, including while held intent queues.
let controlSnapshot='';
function syncControl(id,properties,attributes={}){
 const node=$(id);for(const [name,value] of Object.entries(properties))if(node[name]!==value)node[name]=value;
 for(const [name,value] of Object.entries(attributes))if(node.getAttribute(name)!==String(value))node.setAttribute(name,value);
}
function updateControls(key){
 const attackLocked=followup.attackLock(g)>0||actionLessonEnded(),capabilities=E.capabilityInfo(g),followupViews=Object.fromEntries(['thrust','sweep','charge'].map(action=>[action,followupOffer(action)]));
 const hopLanding=E.jumpLanding(g),leftLanding=E.jumpLanding(g,-1,-1),rightLanding=E.jumpLanding(g,1,-1);
 const choice=unifiedAttackChoice();const snapshot=[choice.kind,choice.x,choice.z,attackLocked,hopLanding.allowed,hopLanding.reason,leftLanding.allowed,leftLanding.reason,rightLanding.allowed,rightLanding.reason,g.playerId,JSON.stringify(capabilities),JSON.stringify(followupViews),key,g.promoted,g.scenario,g.guarding,guardHeld(),canRequestGuard(),E.pendingAwakening(g),!!g.promotionPulse,g.player.z<=E.ENEMY_ZONE_Z,g.moveBlocked,g.won,g.lost,g.lossReason,g.mode,g.player.dx,g.player.dz,Math.ceil(g.cooldown*10),Math.ceil(g.sweepCooldown*10),Math.ceil(g.jumpCooldown*10),Math.ceil(g.phase*10),g.stepCooldown>0,g.terrain==='three_bridges'&&key==='knight'?g.player.x+','+g.player.z:''].join('|');
 if(snapshot===controlSnapshot)return;controlSnapshot=snapshot;
 syncControl('battle-controls',{}, {'data-guarding':String(g.guarding)});
 syncControl('pad-piece',{textContent:E.pieceInfo(g).glyph});
 syncControl('move-label',{textContent:key==='knight'&&!capabilities.abilities.jump?'跳ぶ OFF：この桂馬は移動・攻撃不可':(['dragon','horse'].includes(key)&&!capabilities.abilities.step_attack)?(key==='dragon'?'斜め':'縦横')+'の攻撃 OFF（全方向へ移動可）':g.moveBlocked?'進路に駒があります':key==='knight'&&!leftLanding.allowed&&!rightLanding.allowed?'着地点が盤外です':key==='knight'?'↖・↗で跳ぶ（後退不可）':key==='dragon'?'全方向で移動・斜め＋攻撃で踏込':key==='horse'?'全方向で移動・縦横＋攻撃で踏込':'明るい矢印で移動'});
 const busy=['windup','charge','dragon','jump','thrust'].includes(g.mode)||g.cooldown>0||E.battleEnded(g);
 syncControl('charge',{disabled:attackLocked||guardHeld()||((busy||!E.canAction(g,'charge'))&&!followupViews.charge.canBuffer)});syncControl('charge-label',{textContent:followupViews.charge.enabled?'突撃':g.mode==='charge'?'突撃中':g.mode==='windup'?'構え':'突撃'});
 syncControl('charge-sub',{textContent:''});
 syncControl('sweep',{disabled:attackLocked||guardHeld()||((E.battleEnded(g)||g.sweepCooldown>0||g.mode==='dragon'||g.mode==='jump'||!E.canAction(g,'sweep'))&&!followupViews.sweep.canBuffer)});
 syncControl('thrust',{disabled:attackLocked||guardHeld()||((E.battleEnded(g)||g.sweepCooldown>0||['dragon','jump'].includes(g.mode)||!E.canAction(g,'thrust'))&&!followupViews.thrust.canBuffer)});
 syncControl('jump',{disabled:!capabilities.forwardHop||attackLocked||E.battleEnded(g)||g.jumpCooldown>0||g.mode!=='ready'||!E.canAction(g,'jump')||!hopLanding.allowed});
 // This read-only view is presentation only; native disabled and the engine
 // above still reject every attack while guarding. One guard cue is enough.
 const readinessGame=g.guarding?{...g,guarding:false}:g;
 for(const [id,action] of [['sweep','sweep'],['thrust','thrust'],['charge','charge'],['jump','jump']]){
  const info=action==='jump'&&!capabilities.forwardHop?{name:'跳ぶ',state:'unavailable',label:key==='knight'?(capabilities.abilities.jump?'↖・↗で跳ぶ':'設定で OFF'):'この駒では不可'}:actionReadiness(E,readinessGame,action),v=followupViews[id];
  // A fixed three-segment strip shows admission versus reservation. Detailed
  // state stays in the accessible name; visible action labels do not cycle.
  const label=attackLocked&&!['windup','charge','thrust','sweep'].includes(g.mode)?'構え直し':v?.enabled?(v.queued?(v.stage+1)+'段目 予約済':v.canBuffer?(v.stage+1)+'段目を予約':v.actualStage?(v.actualStage+'/'+v.stageLimit+(v.finisher?' · 終段':' · 攻撃中')):'3連撃 ON'):info.label;
  syncControl(id,{hidden:true},{'data-readiness':info.state,'aria-label':info.name+'、'+label});
  syncControl(id+'-readiness',{textContent:v?.enabled?'3連撃':info.label});
  if(v){
   syncControl(id,{}, {'data-followup':v.queued?'queued':v.canBuffer?'available':v.finisher?'finisher':'none','data-chain-stage':v.actualStage,'data-chain-limit':v.enabled?v.stageLimit:0});
   syncControl(id+'-chain',{hidden:!v.enabled});
   for(let stage=1;stage<=3;stage++)syncControl(id+'-chain-'+stage,{}, {'data-state':v.queued&&stage===v.stage+1?'queued':stage===v.actualStage?(attackLocked&&g.mode==='ready'?'recovery':'active'):stage<v.actualStage?'done':'idle'});
  }
 }
 const selected=choice.kind,view=followupViews[selected],info=selected&&selected!=='dragon'?actionReadiness(E,readinessGame,selected):{state:selected?'ready':'unavailable',label:selected?'1歩攻撃':'設定で OFF'};
 const landing=selected==='jump'?E.jumpLanding(g,choice.x,choice.z):null;
 const attackLabel=attackLocked&&!['windup','charge','thrust','sweep'].includes(g.mode)?'構え直し':view?.enabled?(view.queued?(view.stage+1)+'段目 予約済':view.canBuffer?(view.stage+1)+'段目を予約':view.actualStage?(view.actualStage+'/'+view.stageLimit+(view.finisher?' · 終段':' · 攻撃中')):'3連撃 ON'):info.label;
 const disabled=attackLocked||guardHeld()||g.guarding||E.battleEnded(g)||!selected||(selected==='dragon'?g.stepCooldown>0||g.mode==='jump':selected==='jump'?g.jumpCooldown>0||g.mode!=='ready'||!landing.allowed:$(selected).disabled&&!ordinaryBufferWindow(selected));
 syncControl('attack',{hidden:false,disabled},{'data-action':selected||'none','data-readiness':landing&&!landing.allowed?'blocked':info.state,'aria-label':'攻撃、'+(selected==='dragon'?'1歩攻撃':abilityNames[selected]||'使用不可')+'、'+(landing&&!landing.allowed?'着地点が盤外です':attackLabel),'aria-keyshortcuts':'Space J K L','data-followup':view?.queued?'queued':view?.canBuffer?'available':view?.finisher?'finisher':'none','data-chain-limit':view?.enabled?view.stageLimit:0});
 syncControl('attack-readiness',{textContent:landing&&!landing.allowed?'着地不可':view?.enabled?'3連撃':selected==='dragon'?'1歩攻撃':abilityNames[selected]||'使用不可'});
 syncControl('attack-chain',{hidden:!view?.enabled});for(let stage=1;stage<=3;stage++)syncControl('attack-chain-'+stage,{}, {'data-state':view?.queued&&stage===view.stage+1?'queued':stage===view?.actualStage?(attackLocked&&g.mode==='ready'?'recovery':'active'):stage<(view?.actualStage||0)?'done':'idle'});
 for(const [id,x,z] of moveButtons){
  const knight=key==='knight'&&x!==0&&z<0,step=E.isStepDirection(g,x,z),invalidTerrainJump=knight&&!(x<0?leftLanding:rightLanding).allowed,disabledAbility=knight&&!capabilities.abilities.jump,allowed=(knight||E.allowed(g,x,z))&&!invalidTerrainJump&&!disabledAbility,cooling=knight&&g.jumpCooldown>0;
  const state=E.battleEnded(g)?'ended':disabledAbility?'disabled':!allowed?'locked':cooling?'cooldown':'ready';
  syncControl(id,{disabled:g.guarding||state!=='ready'||attackLocked&&knight},{'data-state':state,'data-readiness':invalidTerrainJump?'blocked':state,'data-action':knight?'jump':'move','aria-label':(knight?(x<0?'左前':'右前')+'へ桂馬跳び。矢印だけで跳べます。後ろには戻れません':(z<0?'前':z>0?'後ろ':'')+(x<0?'左':x>0?'右':'')+'へ移動')+(disabledAbility?'。設定で OFF。移動もできません':invalidTerrainJump?'。着地点が場外になるため跳べません':cooling?'、再使用待ち':'')});
 }
 syncControl('guard',{hidden:false,disabled:!g.guarding&&!canRequestGuard()},{'aria-pressed':String(g.guarding)});
 syncControl('guard-readiness',{textContent:g.guarding?'防御中':!capabilities.abilities.guard&&!['pawn','lance','knight'].includes(key)?'設定で OFF':guardHeld()?'動作後に防御':!['pawn','lance','knight'].includes(key)?'長押し':'この駒では不可'});
 syncControl('ready-label',{textContent:g.guarding?'防御中：移動・攻撃不可':g.lost?(g.lossReason==='king'?'味方の王将が討たれました':'体力がなくなりました'):g.mode==='jump'?'着地の輪へジャンプ':''});
}
function scenarioMissionText(){if(g.won)return g.battleScenario?.objective==='protect'?'王将護衛、達成':'王将討ち取り';if(g.lost)return g.lossReason==='king'?'味方の王将が討ち取られた':'操作中の駒が倒れた';return g.battleScenario?.objective==='protect'?'王を守れ · あと '+Math.max(0,Math.ceil(g.battleScenario.duration-g.time))+'秒':'敵の王将を討ち取れ';}
function updateUI(){updateControlDiscovery();
 renderCapturedReturn();
 const spectator=E.isSpectator(g);syncControl('game',{}, {'data-control-mode':spectator?'spectator':'manual'});syncControl('battle-controls',{hidden:spectator});syncControl('health',{hidden:spectator});syncControl('hint',{hidden:spectator});
 if(spectator){for(const id of ['pace','attack','sweep','thrust','charge','jump','guard',...moveButtons.map(([id])=>id)])$(id).disabled=true;controlSnapshot='';$('reset').textContent='メニューへ';$('battle-time').textContent='時間 '+formatBattleTime(challenge.elapsed);$('army-status').textContent='味方 '+g.enemies.filter(e=>e.alive&&e.team==='ally').length+' ／ 敵 '+g.enemies.filter(e=>e.alive&&e.team==='enemy').length;$('reinforcement-status').textContent=reinforcementSummary(g);$('mission').textContent=g.draw?'引き分け':g.won?'味方の勝利':g.lost?'敵の勝利':'観戦（全員NPC）';$('status').textContent=$('mission').textContent;return;}
 if(g.battleScenario)$('mission').textContent=scenarioMissionText();
 $('reset').textContent=selectedScenario==='army'?'メニューへ':'練習メニュー';
 const timeText='時間 '+formatBattleTime(challenge.elapsed);if($('battle-time').textContent!==timeText)$('battle-time').textContent=timeText;
 const type=E.pieceInfo(g),key=E.pieceKey(g),base=E.PIECES[g.piece],canPromote=!!base.promote&&!g.promoted;
 const allies=g.enemies.filter(e=>e.alive&&e.team==='ally').length,foes=g.enemies.filter(e=>e.alive&&e.team==='enemy').length,waiting=g.enemies.filter(e=>!e.alive&&e.pendingTeam).length;
 updateControls(key);
 const snapshot=[actionLesson?.status,actionLesson?.awakened,actionLesson?.blocks,actionLesson?.hits,challenge.points,E.pendingAwakening(g),g.moveBlocked,waiting?Math.floor(g.time*2):0,reinforcementSummary(g),Math.ceil(g.cooldown*10),Math.ceil(g.sweepCooldown*10),Math.ceil(g.jumpCooldown*10),Math.ceil(g.phase*10),allies,foes,waiting,key,g.score,g.mode,g.player.dx,g.player.dz,g.promoted,g.won,g.lost,g.hp,g.cooldown>0,g.sweepCooldown>0,g.stepCooldown>0,g.jumpCooldown>0].join('|');if(snapshot===uiSnapshot)return;uiSnapshot=snapshot;
 $('formation-open').textContent='出撃準備';const heavy=g.teamStats?.ally.equipment==='heavy';$('pace').disabled=heavy;$('pace').textContent=heavy?'重装：歩くのみ':walking?'移動：歩く':'移動：走る';
 $('hp').textContent=g.hp+' / '+g.maxHp;$('hp-bar').style.width=g.hp/g.maxHp*100+'%';$('health').classList[g.hp<=2?'add':'remove']('critical');
 $('army-status').textContent='味方 '+(allies+(g.hp>0?1:0))+'（自分含む） ／ 敵 '+foes;$('reinforcement-status').textContent=reinforcementSummary(g);
 $('score').textContent=challenge.points;$('progress').style.width=Math.min(1,g.score/(selectedScenario==='army'?(g.battleScenario?.initialEnemies||E.COUNT):Math.max(1,g.enemies.filter(e=>e.team==='enemy').length)))*100+'%';
 $('promotion-progress').style.width=canPromote?(g.player.z<=E.ENEMY_ZONE_Z?'100%':'0%'):'100%';
 $('promotion-label').textContent=canPromote?(E.pendingAwakening(g)?'動作の後に自動覚醒':'敵陣で'+E.PIECES[base.promote].name+'に自動覚醒'):key==='knight'?'前方へ桂馬跳び':E.isStepDirection(g,1,1)?'全方向へ移動・斜め＋攻撃で踏込':key==='horse'?'全方向へ移動・縦横＋攻撃で踏込':'駒の方向で移動';
 $('promotion-label').hidden=selectedScenario!=='army';
 if(selectedScenario!=='army'){$('promotion-label').textContent='';$('mission').textContent=actionLesson?actionLessonMission(actionLesson,g):selectedScenario==='squad'?(recruitLesson?.status==='complete'?'仲間の一撃、命中。':drills.squad.title):g.won?'練習達成':g.lost?'体力がなくなった':g.score?'あと '+foes+'体':drills[selectedScenario].title;$('promotion-progress').style.width=(g.score/Math.max(1,g.enemies.filter(e=>e.team==='enemy').length)*100)+'%';}
 if(actionLesson){$('progress').style.width=$('promotion-progress').style.width=(actionLesson.status==='complete'?100:actionLesson.awakened?50:0)+'%';$('hint').textContent=actionLessonHint(actionLesson,g,E);$('hint').classList[actionLessonEnded()?'add':'remove']('hide');}
 $('piece-name').textContent=type.name;aura.material.color.set(g.promoted?'#ffe28a':'#47dfff');
 const statusText=selectedScenario==='switch_trial'?(g.won?'交代した仲間で敵を倒せました。':switchLessonHint()):g.battleScenario?.objective==='protect'?scenarioMissionText()+(E.battleEnded(g)?'。':'。王か操作中の駒が倒れると敗北。'):actionLesson?actionLessonMission(actionLesson,g)+'。'+actionLessonHint(actionLesson,g,E):selectedScenario==='squad'&&recruitLesson?(recruitLesson.status==='complete'?'仲間の攻撃が命中しました。':drills.squad.title+'。'+recruitHint(g,recruitLesson,E)):g.won?(selectedScenario==='army'?'敵の王将を討ち取り、勝利':'練習達成'):g.lost?'敗北。もう一度挑戦できます':type.name+'。体力'+g.hp+'。'+(selectedScenario==='army'?g.score+'体撃破。敵の王将を狙ってください。':'あと'+foes+'体。');if($('status').textContent!==statusText)$('status').textContent=statusText;
}
let tacticalOpen=false,tacticalWasPaused=false,lastTactics=-1,eventUntil=0,eventPriority=0;const mapCanvas=$('tactical-map'),mapContext=mapCanvas.getContext('2d');const tacticalControls=createTacticalControlMap($('tactical-map-controls'),E,id=>{if(!tacticalOpen||!E.canSwitchControl(g,id))return;$('control-choice').value=String(id);$('control-switch').onclick();},document);
function hideTactics(){if(tacticalOpen&&!inLobby&&!settingsOpen&&!E.battleEnded(g))paused=tacticalWasPaused;tacticalOpen=false;$('tactics-panel').hidden=true;$('tactics-toggle').setAttribute('aria-expanded','false');}
$('tactics-toggle').onclick=()=>{if(inLobby||settingsOpen||E.battleEnded(g)||lessonEnded())return;if(tacticalOpen){$('tactics-close').onclick();return;}closeCapturedReturn();tacticalWasPaused=paused;tacticalOpen=true;advanceSimulation.reset(g);paused=true;clearInput();$('paused').hidden=true;$('tactics-panel').hidden=false;$('tactics-toggle').setAttribute('aria-expanded','true');lastTactics=-1;updateTactics();(tacticalControls.focusable()[0]||$('tactics-close')).focus();};
function closeTactics(){if(!tacticalOpen)return;hideTactics();$('paused').hidden=!paused;last=performance.now();$(paused?'resume':'tactics-toggle').focus({preventScroll:true});}
$('tactics-close').onclick=closeTactics;
$('tactics-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();$('tactics-close').onclick();}else if(e.key==='Tab'){e.preventDefault();const items=(controlSwitchScenario()?[...tacticalControls.focusable(),$('control-choice'),$('control-switch'),$('tactics-close')]:[$('tactics-close')]).filter(n=>!n.disabled&&!n.hidden),index=items.indexOf(document.activeElement),next=e.shiftKey?(index<=0?items.length-1:index-1):(index+1)%items.length;items[next]?.focus();}});
const switchMessages={'protected-king':'護衛対象の王は自動操作です。護衛の味方を選んでください。','hero-busy':'一度戦場へ戻り、自分の動作が終わってから開いてください。','target-busy':'この味方は動作中。別の味方を選ぶか、一度戦場へ戻ってください。','invalid-target':'操作する味方を選んでください。','target-missing':'操作する味方を選んでください。','battle-ended':'戦闘は終了しています。'};
function actorCapabilityText(id){const record=E.CapabilityRuntime?.record(g,id);if(!record)return '';const disabled=abilityIds.filter(ability=>record.disabled.includes(ability)||(ability==='step_attack'&&record.disabled.includes('sweep')&&['dragon','horse'].includes(record.basePiece)));return ' · 技の設定変更'+(disabled.length?'：'+disabled.map(ability=>abilityNames[ability]).join('・')+' OFF':'')+(record.forwardHop?' · 前方跳躍（操作中のみ）':'');}
function chosenActorId(){return $('control-choice').value===''?null:Number($('control-choice').value);}
function controlSwitchScenario(){return ['army','switch_trial'].includes(g.scenario)&&!E.isSpectator(g);}
function availableControlAlly(){return controlSwitchScenario()&&g.enemies.some(e=>E.canSwitchControl(g,e.id));}
function updateControlDiscovery(){const available=availableControlAlly();$('tactics-toggle').textContent=available?'戦況・交代':'戦況';$('tactics-toggle').setAttribute('aria-label',available?'戦況を開く・操作する味方を交代':'戦況を開く');$('control-instruction').hidden=!available;}
function updateControlChoice(){const panel=$('control-panel');if(E.isSpectator(g)){panel.hidden=true;$('control-choice').value='';$('map-legend').innerHTML='◆ 王将<br>青：味方／朱赤：敵'+(g.terrain==='three_bridges'?'<br>濃い青：川／黄土色：橋':'');mapCanvas.setAttribute('aria-label','観戦の戦況。青が味方、朱赤が敵。ひし形は王将');return;}$('map-legend').innerHTML=(controlSwitchScenario()?'▲ 自分　◆ 王将　□ 切替先':'▲ 自分')+'<br>青：味方／朱赤：敵'+(g.terrain==='three_bridges'?'<br>濃い青：川／黄土色：橋':'');mapCanvas.setAttribute('aria-label',(g.scenario==='army'?'青が味方、朱赤が敵。白い三角は自分、ひし形は王将':'青が味方、朱赤が敵。白い三角は自分')+(g.terrain==='three_bridges'?'。濃い青が川、黄土色が橋':''));panel.hidden=!controlSwitchScenario();if(panel.hidden)return;const select=$('control-choice'),previous=chosenActorId(),units=g.enemies.filter(e=>e.alive&&e.team==='ally'&&!e.trainingGuard).sort((a,b)=>Math.hypot(a.x-g.player.x,a.z-g.player.z)-Math.hypot(b.x-g.player.x,b.z-g.player.z)||a.id-b.id);select.innerHTML='<option value="">'+(units.length?'近い味方から表示':'味方がいません')+'</option>'+units.map((e,i)=>'<option value="'+e.id+'">'+(i+1)+'. '+E.PIECES[e.piece].name+(e.id===g.battleScenario?.protectedId?' · 護衛対象（切替不可）':'')+' · 体力 '+e.hp+'/'+e.maxHp+(e.attack!=='idle'||e.stagger>0?' · 動作中':'')+actorCapabilityText(e.id)+'</option>').join('');select.value=units.some(e=>e.id===previous)?String(previous):'';select.disabled=!units.length;const id=chosenActorId(),reason=E.switchControlReason(g,id);$('control-switch').disabled=!!reason;$('control-status').textContent=units.length?(reason?(switchMessages[reason]||'この駒には切り替えられません。'):'四角の味方へ操作を切り替えます。'+actorCapabilityText(id)):'操作できる味方がいません。';}
$('control-choice').onchange=()=>{lastTactics=-1;updateTactics();};
$('control-switch').onclick=()=>{const id=chosenActorId();if(!tacticalOpen||!E.switchControl(g,id))return;advanceSimulation.reset(g);heroHitFeedback.reset();clearInput();actions.reset();heroPose=null;uiSnapshot='';lastTactics=-1;$('control-choice').value='';closeTactics();eventNotice(E.pieceInfo(g).name+' を操作');renderDirty=true;last=performance.now();updateUI();draw(0);};
function switchLessonHint(){return g.playerId===g.switchLesson?.allyActorId?'②金将で正面の敵に近づき「攻撃」で倒す':'①「戦況・交代」で金将を選び、操作を切り替える';}
function showSwitchResult(){if(inLobby||g.scenario!=='switch_trial'||!E.battleEnded(g)||!$('result').hidden)return;hideTactics();clearInput();paused=true;$('paused').hidden=true;$('result-kicker').textContent=g.won?'練習クリア':'再挑戦';$('result-title').textContent=g.won?'仲間の操作で撃破！':'金将に交代してから倒そう。';$('result-reason').hidden=g.won;$('result-reason').textContent='先に敵が倒れました。同じ練習をやり直せます。';$('result-score').textContent='—';$('result-metrics').textContent=g.won?'交代した金将を操作して、敵の歩兵を倒しました。':'';$('result-points-detail').textContent='';$('result-record').textContent='練習の得点・タイムは保存しません。';$('result-detail').textContent='①金将に交代　②金将で敵を倒す';setSortieVictorySummary(g.won,true);$('next-lesson').hidden=!g.won;$('next-lesson').textContent='本戦の準備へ';$('result').hidden=false;revealBattleAudioResult();$('result').scrollTop=0;$(g.won?'next-lesson':'retry-battle').focus({preventScroll:true});}

function updateTactics(){if(g.time>=lastTactics&&g.time-lastTactics<.12)return;lastTactics=g.time;const guide=kingGuide(g);if($('king-guide').textContent!==guide.text)$('king-guide').textContent=guide.text;if($('king-guide').getAttribute('data-danger')!==String(guide.danger))$('king-guide').setAttribute('data-danger',String(guide.danger));if(!tacticalOpen)return;updateControlChoice();$('tactics-summary').textContent=E.isSpectator(g)?'観戦（全員NPC） · 味方 '+g.enemies.filter(e=>e.alive&&e.team==='ally').length+' · 敵 '+g.enemies.filter(e=>e.alive&&e.team==='enemy').length:'操作中：'+E.pieceInfo(g).name+actorCapabilityText(g.playerId)+' · 体力 '+g.hp+' / '+g.maxHp+' · 味方 '+(g.enemies.filter(e=>e.alive&&e.team==='ally').length+1)+' · 敵 '+g.enemies.filter(e=>e.alive&&e.team==='enemy').length;if(g.invasion){const progress=E.Invasion.invasionSummary(g.invasion);$('tactics-summary').textContent+=' · 敵陣に味方'+progress.allyInEnemyTerritory+'体／自陣に敵'+progress.enemyInAlliedTerritory+'体';}drawTacticalMap(mapContext,tacticalMapState(E,g),mapCanvas.width,mapCanvas.height,chosenActorId());tacticalControls.update(g,tacticalMapState(E,g),controlSwitchScenario());$('tactical-map-help').textContent=tacticalControls.focusable().length?'青い味方をタップすると、その位置から操作を交代します。数字は体力。':E.isSpectator(g)?'観戦中です。数字は体力。':'今は交代できる味方がいません。数字は体力。';}
function eventNotice(text,priority=0,rewardTier=0){
 if(E.battleEnded(g)||g.time<eventUntil&&priority<eventPriority)return false;
 $('battle-event').textContent=text;$('battle-event').setAttribute('data-reward-tier',String(quiet()?0:rewardTier));$('battle-event').hidden=false;eventUntil=g.time+2.1;eventPriority=priority;return true;
}
const camTarget=new THREE.Vector3(),camPosition=new THREE.Vector3();let viewWidth=390,viewHeight=844,chargePoseViewKey=null;
const lerp=(a,b,t)=>a+(b-a)*t,ease=t=>t*t*(3-2*t);
function slashPose(t){if(t<.27){const a=ease(t/.27);return {body:lerp(0,-.48,a),yaw:lerp(0,-1.18,a),tilt:lerp(.3,Math.PI/2,a),roll:lerp(.52,0,a)};}if(t<.6){const a=ease((t-.27)/.33);return {body:lerp(-.48,.75,a),yaw:lerp(-1.18,1.18,a),tilt:Math.PI/2,roll:0};}const a=ease((t-.6)/.4);return {body:lerp(.75,0,a),yaw:lerp(1.18,0,a),tilt:lerp(Math.PI/2,.3,a),roll:lerp(0,.52,a)};}
// A presentation-only anchor, never registered as an engine actor or collider.
function viewAnchor(){const a=E.arenaBounds(g);return g.player||{x:(a.minX+a.maxX)/2,y:0,z:(a.minZ+a.maxZ)/2,dx:0,dz:-1};}
function draw(dt,poseDt=g.hitstop>0?0:dt){
 renderDirty=false;const p=viewAnchor(),spectator=E.isSpectator(g);hero.visible=!spectator;aura.visible=!spectator;
 const portrait=viewHeight>viewWidth;backdrop.scale.y=1;backdrop.position.y=3;camTarget.set(p.x,1.45,p.z-5.8);camPosition.set(p.x,portrait?13.8:10.8,p.z+(portrait?19.4:18.8));if(spectator){const a=boardArt.top,tan=Math.tan(camera.fov*Math.PI/360),horizontal=tan*camera.aspect*.88,vertical=tan*.68;let distance=1;camTarget.set(p.x,1.5,p.z);for(const x of [a.minX,a.maxX])for(const z of [a.minZ,a.maxZ])for(const y of [0,E.ENEMY_HEIGHT+1]){const dx=x-p.x,dy=y-1.5,dz=z-p.z,depth=dy*.8+dz*.6;distance=Math.max(distance,depth+Math.abs(dx)/horizontal,depth+Math.abs(dy*.6-dz*.8)/vertical);}camPosition.set(p.x,1.5+distance*.8,p.z+distance*.6);camera.far=distance+80;camera.updateProjectionMatrix();}else if(camera.far!==150){camera.far=150;camera.updateProjectionMatrix();}camera.position.copy(camPosition);camera.lookAt(camTarget);if(shake&&!quiet()&&shakePower>.001){camera.position.x+=(random()-.5)*shakePower;camera.position.y+=(random()-.5)*shakePower*.65;}shakePower*=Math.exp(-dt*15);camera.updateMatrixWorld(true);
 const chargeCamera={matrixWorld:camera.matrixWorld.toArray(),projectionMatrix:camera.projectionMatrix.toArray()};
 npcHitReactions.sync(g);
 updateTactics();if(g.time>eventUntil)$('battle-event').hidden=true;const drawArena=E.arenaBounds(g);enemyBoundary.visible=(g.scenario==='army'||g.scenario==='awaken_trial')&&E.ENEMY_ZONE_Z>=drawArena.minZ&&E.ENEMY_ZONE_Z<=drawArena.maxZ;enemyBoundary.position.x=(drawArena.minX+drawArena.maxX)/2;enemyBoundary.scale.x=(drawArena.maxX-drawArena.minX)/38;guardShell.visible=g.guarding;guardShell.position.set(p.x,(p.y||0)+1.9,p.z);guardShell.material.opacity=.15+(g.guardFlash||0)*1.4;
 const time=g.time,charging=g.mode==='charge'||g.mode==='dragon',winding=g.mode==='windup',sweeping=g.mode==='sweep';const moving=Math.hypot(input.x,input.z)>.08||destination;
 const stroke=sweeping?Math.max(0,Math.min(1,1-g.phase/E.SWEEP_DURATION)):0;
 const facing=(sweeping||g.mode==='thrust')?g.sweepDirection:p;
 hero.position.set(p.x,p.y||0,p.z);hero.rotation.set(0,Math.atan2(facing.dx,facing.dz),0);const heroHurt=heroHitFeedback.apply(hero,g,{quiet:quiet()});
 // A newly admitted step already has an active wave: never draw its sword
 // from a cached crossed guard, including a zero-time pause redraw.
 const currentChargeViewKey=viewWidth+':'+viewHeight,chargeViewChanged=currentChargeViewKey!==chargePoseViewKey;chargePoseViewKey=currentChargeViewKey;
 const stepGuardAdmission=g.mode==='dragon'&&heroPose?.name!=='charge'&&(heroPose?.guarding||heroPose?.guardTransitionActive);
 // A guard release begins its authored arm/draw handoff even on a paused admission.
 const chargeGuardAdmission=g.mode==='windup'&&heroPose?.name!=='charge_windup'&&(heroPose?.guarding||heroPose?.guardTransitionActive);
 if(poseDt>0||!heroPose||stepGuardAdmission||chargeGuardAdmission||chargeViewChanged&&(heroPose?.sharedSpearFrame?.action==='charge'||g.mode==='windup'||g.mode==='charge'))heroPose=actions.sample({...samuraiMotionProfile(E.pieceKey(g),'original-samurai',E.capabilityInfo(g)),mode:g.mode,phase:g.phase,cooldown:g.cooldown,chargeCamera,attackPresentation:renderAttackPresentation(),thrustTiming:E.thrustTiming(g),authoritativeThrustTip:g.mode==='thrust'?E.thrustPoint(p,facing.dx,facing.dz,E.thrustTiming(g)?.canonicalElapsed??(.4-g.phase)):null,x:p.x,z:p.z,walking:g.teamStats?.ally.equipment==='heavy'||walking||keys.has('Shift'),dt:poseDt,guard:{active:!!g.guarding,piece:E.pieceKey(g),alive:g.hp>0&&!E.battleEnded(g),grounded:(p.y||0)<=1e-6}});else actions.refreshAnchors?.();
 const transform=Math.max(0,(g.transformUntil||0)-g.time),strength=transform>0?Math.sin(Math.PI*Math.min(1,transform/1.25)):0;transformShell.visible=transform>0;transformShell.position.set(p.x,(p.y||0)+1.9,p.z);transformShell.scale.set(1.2+strength*.45,2.05+strength*.3,1.2+strength*.45);transformShell.rotation.y=time*2;transformShell.material.opacity=(quiet()?.1:.32)*strength;for(const item of heroMaterials){item.material.emissive.copy(item.color).lerp(new THREE.Color('#ffb832'),strength);item.material.emissiveIntensity=item.intensity+strength*(quiet()?.2:.8);heroHitFeedback.tint(item.material,heroHurt,{quiet:quiet()});}
 heroSword.visible=['sweep','dragon'].includes(g.mode)&&!!heroPose;heroSpear.visible=g.mode==='windup'&&!!heroPose;if(heroSword.visible)weaponAssets.placeSword(heroSword,heroPose.handBase,heroPose.handTip,facing.dx,facing.dz);if(heroSpear.visible){weaponDirection.set(p.x+facing.dx*1.7,(p.y||0)+1.9,p.z+facing.dz*1.7);heroWeaponAssets.placeHeldSpear(heroSpear,heroPose.chargeGrip||heroPose.handBase,heroPose.chargeDisplayTip||weaponDirection,facing.dx,facing.dz);for(const n of heroSpear.children){n.material.color.setHex(n.material.userData.role==='core'?0xc3f7ff:0x70edff);n.material.opacity=n.material.userData.baseOpacity*(quiet()?.42:.62)*(heroPose.guardChargeDraw?.opacity??1);}}

 $('damage-vignette').style.opacity=quiet()?'0':String(heroHurt*.65);
 const npcHeadings=npcFacing.update(g.enemies,p,poseDt,{active:g.active,combatTargets:npcCombatFacingTargets(g)});
 const npcLocomotion=models.npcLocomotion?.update(g.enemies,poseDt,{active:g.active});
 const authoritativeThrusts=E.thrustPoses(g),npcThrustTips=new Map(authoritativeThrusts.filter(pose=>!pose.hero).map(pose=>[pose.id,pose]));
 escortBraceTelegraph.update(g);const animated=models.npcAnimations?.update(g.enemies,p,poseDt,{enabled:!quiet(),active:g.active,headings:npcHeadings,locomotion:npcLocomotion,chargeCamera,thrustTips:npcThrustTips,retainTutorialActors:selectedScenario!=='army',applyHitReaction:(root,e)=>npcHitReactions.apply(root,e,{quiet:quiet(),active:g.active})})||new Set(),staticCounts=[0,0];
 const chargeGrips=new Map(),chargeDisplayTips=new Map(),npcSpearSlots=new Map(),npcChargePreviews=[];for(const [index,slot]of (models.npcAnimations?.pool||[]).entries()){if(!slot.root.visible||slot.pose?.spearPresentationOwner!=='hero')continue;npcSpearSlots.set(slot.id,index);if(slot.pose.chargeDisplayTip)chargeDisplayTips.set(slot.id,slot.pose.chargeDisplayTip);const actor=g.enemies.find(e=>e.id===slot.id);if(actor?.attack==='windup'&&actor.actionKind==='charge')npcChargePreviews.push({actor,slot:index,grip:slot.pose.chargeGrip,displayTip:slot.pose.chargeDisplayTip});}if(charging&&heroPose?.chargeDisplayTip)chargeDisplayTips.set(g.playerId,heroPose.chargeDisplayTip);if(charging&&heroPose)chargeGrips.set(g.playerId,heroPose.chargeGrip||heroPose.handBase);
 const thrusts=authoritativeThrusts.map(pose=>{const slot=pose.hero?null:models.npcAnimations?.pool.find(slot=>slot.id===pose.id&&slot.root.visible);return {...pose,npcSpearSlot:slot?.pose?.spearPresentationOwner==='hero'?models.npcAnimations.pool.indexOf(slot):null,attackPresentation:pose.hero?renderAttackPresentation():null,thrustPresentationFrame:pose.hero?heroPose?.thrustPresentationFrame:null,grip:pose.hero?(heroPose?.thrustGrip||heroPose?.handBase):(slot?.pose?.thrustGrip||slot?.pose?.handBase)};});
 dummy.position.set(0,0,0);dummy.rotation.set(0,0,0);dummy.scale.setScalar(0);dummy.updateMatrix();for(let i=0;i<E.MAX_NPCS;i++){pieceLabels[i].visible=false;shadows.setMatrixAt(i,dummy.matrix);teamMarkers.setMatrixAt(i,dummy.matrix);}
 const contactHeadsActive=handEffects.beginContactHeads(g.playerId,!spectator);
 for(const h of npcHpBars)h.group.visible=false;for(const e of g.enemies){const h=npcHpBars[e.id];h.group.visible=e.alive&&(e.maxHp||1)>1;h.group.position.set(e.x,(e.y||0)+E.ENEMY_HEIGHT+.08,e.z);h.group.quaternion.copy(camera.quaternion);h.fill.scale.x=Math.max(0,(e.hp??1)/(e.maxHp||1));h.fill.position.x=-(1-h.fill.scale.x)*.5;h.fill.material.color.set(g.active&&e.hurtFlash>0?'#ffffff':e.team==='ally'?'#45dfff':'#ff715f');const label=pieceLabels[e.id];label.visible=e.alive;const protectedLabel=e.spawnProtection>0,labelSize=e.piece==='king'?1.15:.85;label.scale.set(labelSize*(protectedLabel?1.5:1),labelSize,labelSize);label.center.set(protectedLabel?1/3:.5,.5);label.material.opacity=1;label.material.map=pieceMaps[(e.team||'enemy')+'_'+e.piece+(protectedLabel?'_protected':'')];label.position.set(e.x,e.y+E.ENEMY_HEIGHT+.45,e.z);label.quaternion.copy(camera.quaternion);const gone=!e.alive&&e.age>2.4;const lifeScale=e.alive?1:e.age<1.7?1:Math.max(.001,(2.4-e.age)/.7);rootDummy.position.set(e.x,e.y,e.z);rootDummy.rotation.set(e.alive?0:e.angle*.55,e.alive?npcHeadings.get(e.id):e.phase,e.alive?0:e.angle);rootDummy.scale.setScalar(gone?0:lifeScale);if(!e.alive){rootDummy.position.y+=(E.ENEMY_HEIGHT/2)*lifeScale;rootDummy.translateY(-(E.ENEMY_HEIGHT/2)*lifeScale);}npcHitReactions.apply(rootDummy,e,{quiet:quiet(),active:g.active});rootDummy.updateMatrix();if(contactHeadsActive&&!gone)handEffects.addContactHead(e,rootDummy.matrix,models.npcAnimations?.pool.find(slot=>slot.id===e.id&&slot.root.visible));if(e.alive&&e.attack==='charge'){const slot=models.npcAnimations?.pool.find(slot=>slot.id===e.id&&slot.root.visible),palm=slot?.pose?.chargeGrip||slot?.pose?.handBase;const staticGrip=models.staticNpcGrips?.[e.id%2];if(palm)chargeGrips.set(e.id,palm);else if(staticGrip)chargeGrips.set(e.id,(models.npcLocomotion?.palm(e,staticGrip)||staticGrip).clone().applyMatrix4(rootDummy.matrix));}if(!gone&&!animated.has(e.id)){const thrust=thrusts.find(pose=>!pose.hero&&pose.id===e.id),grip=models.staticNpcGrips?.[e.id%2];if(thrust&&!thrust.grip&&grip)thrust.grip=(models.npcLocomotion?.palm(e,grip)||grip).clone().applyMatrix4(rootDummy.matrix);const index=staticCounts[e.id%2]++;for(const inst of models.groups[e.id%2]){inst.setMatrixAt(index,rootDummy.matrix);models.npcLocomotion?.apply(inst,index,e);inst.setColorAt(index,npcBodyColor(npcBodyTint,e.team,e.alive&&g.active?e.hurtFlash:0));if(inst.instanceColor)inst.instanceColor.needsUpdate=true;}}dummy.position.set(e.x,.015,e.z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(gone?0:(e.alive?1:Math.max(.1,1-e.y*.06)*lifeScale)*(E.ENEMY_HEIGHT/2.8));dummy.updateMatrix();shadows.setMatrixAt(e.id,dummy.matrix);const awakeningGlow=e.alive?Math.sin(Math.PI*Math.max(0,Math.min(1,((e.transformUntil||0)-g.time)/1.25))):0;dummy.scale.setScalar(e.alive?1+awakeningGlow*(quiet()?.1:.35):0);dummy.position.y=.05;dummy.updateMatrix();teamMarkers.setMatrixAt(e.id,dummy.matrix);teamMarkers.setColorAt(e.id,npcColors[e.team||'enemy']);}
 models.npcLocomotion?.finish();
 // Static palm sockets must use this frame's final instance matrix, including lean/scale.
 handEffects.update({swordCombo:!spectator&&heroPose?{actorId:g.playerId,sword:heroSword,guardSwordOpacity:heroPose.guarding&&g.mode==='sweep'?0:heroPose.guardSwordOpacity,mode:g.mode,phase:g.phase,presentation:renderAttackPresentation(),handBase:heroPose.handBase,handTip:heroPose.handTip,actorX:p.x,actorZ:p.z}:null,dt,waves:g.waves,enemies:g.enemies,arena:g.arena,promotionPulse:g.promotionPulse,quiet:quiet(),cameraQuaternion:camera.quaternion,cameraPosition:camera.position,thrusts,chargeGrips,chargeDisplayTips,npcSpearSlots,npcChargePreviews,controlledActorId:g.player?g.playerId:null,chargePreview:heroSpear.visible?{spear:heroSpear,actor:p,displayTip:heroPose?.chargeDisplayTip,opacity:heroPose.guardChargeDraw?.opacity??1}:null,occluders:g.player?g.enemies.concat(g.player):g.enemies,thrustSpec:E.THRUST});
 teamMarkers.instanceMatrix.needsUpdate=true;if(teamMarkers.instanceColor)teamMarkers.instanceColor.needsUpdate=true;
 for(let v=0;v<models.groups.length;v++)for(const inst of models.groups[v]){inst.count=staticCounts[v];inst.instanceMatrix.needsUpdate=true;}dummy.position.set(p.x,.017,p.z);dummy.scale.set(spectator?0:1.6,spectator?0:1,spectator?0:1.6);dummy.rotation.set(0,0,0);dummy.updateMatrix();shadows.setMatrixAt(E.MAX_NPCS,dummy.matrix);shadows.instanceMatrix.needsUpdate=true;
 landing.visible=g.mode==='jump';if(landing.visible)landing.position.set(g.jumpEnd.x,.04,g.jumpEnd.z);
 aura.position.set(p.x,.035,p.z);aura.material.opacity=charging?.95:.48;aura.scale.setScalar(winding?1+(.18-g.phase)*1.1:1);
 path.position.set(p.x,.028,p.z);path.rotation.y=Math.atan2(p.dx,p.dz);path.visible=!spectator&&!g.won&&!sweeping&&g.mode!=='dragon';pathMat.opacity=winding?.3:charging?.2:.055;slash.position.set(p.x,heroPose.handTip.y,p.z);slash.rotation.set(-Math.PI/2,0,Math.atan2(facing.dx,facing.dz));slash.visible=false;slash.material.opacity=(quiet()?.12:.34)*Math.max(0,1-(stroke-.27)/.45);slash.scale.setScalar(.8+Math.min(1,Math.max(0,(stroke-.27)/.33))*.2);path.scale.z=g.mode==='dragon'?.26:1;

 for(let i=0;i<PARTICLES;i++){const d=particles[i];if(d)d.age+=dt;if(!d||d.age>d.life||quiet()){dummy.scale.setScalar(0);}else{d.x+=d.vx*dt;d.z+=d.vz*dt;d.y+=d.vy*dt;d.vy-=2*dt;dummy.position.set(d.x,Math.max(.2,d.y),d.z);dummy.rotation.set(i,i*.7,time);dummy.scale.setScalar(d.size*(1+d.age*2)*Math.max(0,1-d.age/d.life));}dummy.updateMatrix();dust.setMatrixAt(i,dummy.matrix);}dust.instanceMatrix.needsUpdate=true;
 trails.forEach((trail,i)=>{trail.visible=false;trail.material.opacity=charging&&!quiet()?.35:0;const side=(i%2?1:-1)*(.7+(i%3)*.6);trail.position.set(p.x-p.dx*(i*.35+1)-p.dz*side,.3+(i%4)*.42,p.z-p.dz*(i*.35+1)+p.dx*side);trail.rotation.z=-Math.atan2(p.dx,p.dz);});
 // Rigid translation: target and position use the SAME player anchor.
 // Movement, release, hitstop and reversal cannot change FOV, pitch or distance.
 terrainArt?.update(g.time,quiet());renderer.render(scene,camera);
}
function resize(){renderDirty=true;const r=$('world').getBoundingClientRect();viewWidth=Math.max(1,r.width);viewHeight=Math.max(1,r.height);renderer.setSize(viewWidth,viewHeight,false);camera.aspect=viewWidth/viewHeight;camera.fov=47;camera.zoom=1;camera.updateProjectionMatrix();}
let resizeScheduled=false;
function scheduleResize(){if(resizeScheduled)return;resizeScheduled=true;const enqueue=window.requestAnimationFrame?.bind(window)||((fn)=>fn());enqueue(()=>{resizeScheduled=false;resize();updateViewportStatus();});}
function viewportInfo(){const v=window.visualViewport,r=$('world').getBoundingClientRect(),box=$('game').getBoundingClientRect();return {scale:v?.scale||1,width:v?.width||r.width,height:v?.height||r.height,offsetLeft:v?.offsetLeft||0,offsetTop:v?.offsetTop||0,innerWidth:window.innerWidth||viewWidth,innerHeight:window.innerHeight||viewHeight,clientWidth:document.documentElement?.clientWidth||viewWidth,scrollWidth:document.documentElement?.scrollWidth||viewWidth,canvas:{width:r.width,height:r.height},game:{width:box.width,height:box.height}};}
function updateViewportStatus(){const v=viewportInfo();$('viewport-status').textContent='表示倍率 '+Math.round(v.scale*100)+'% · 画面 '+Math.round(v.width)+' × '+Math.round(v.height)+(v.scale>1.05?' · 2本指で縮小できます':'');}
window.addEventListener('resize',()=>{clearInput();scheduleResize();});window.addEventListener('orientationchange',()=>{clearInput();scheduleResize();});window.addEventListener('pageshow',()=>{clearInput();scheduleResize();});window.visualViewport?.addEventListener('resize',scheduleResize);window.visualViewport?.addEventListener('scroll',updateViewportStatus);if(typeof ResizeObserver!=='undefined')new ResizeObserver(scheduleResize).observe($('game'));resize();updateViewportStatus();

function finishActionLesson(){
 if(!challenge.finished){challenge.finished=true;challenge.won=actionLesson.status==='complete';challenge.finishMs=Math.round(challenge.elapsed*1000);finishChallengeRecord();}
 // Freeze immediately after the demonstrated contact, before releasing guard.
 // No engine win, health, hit, score or enemy state is fabricated.
 paused=true;advanceSimulation.reset(g);clearInput();uiSnapshot='';renderDirty=true;
}
function showActionLessonResult(){
 if(inLobby||!actionLessonEnded()||!$('result').hidden)return;
 const result=actionLessonResult(actionLesson),completed=actionLesson.status==='complete';
 $('result-kicker').textContent=completed?'練習クリア':'再挑戦';$('result-title').textContent=result.title;
 $('result-reason').hidden=completed;$('result-reason').textContent=result.reason;
 $('result-score').textContent=challenge.points;$('result-detail').textContent=result.detail;
 $('result-metrics').textContent='練習時間 '+formatBattleTime(challenge.elapsed)+' · 被弾 '+g.playerHits+'回';
 $('result-points-detail').textContent=challengeBreakdown(challenge);$('result-record').textContent='練習の得点・タイムは保存しません。';
 $('next-lesson').hidden=!completed;$('next-lesson').textContent='次の課題へ';
 setSortieVictorySummary(completed,true);
 hideTactics();clearInput();paused=true;$('paused').hidden=true;$('result').hidden=false;revealBattleAudioResult();$('result').scrollTop=0;$(completed?'next-lesson':'retry-battle').focus({preventScroll:true});
}
function finishRecruitRecord(){
 if(!challenge.finished){challenge.finished=true;challenge.won=recruitLesson.status==='complete';challenge.finishMs=Math.round(challenge.elapsed*1000);finishChallengeRecord();}
 clearInput();uiSnapshot='';
}
function showRecruitResult(force=false){
 if(inLobby||selectedScenario!=='squad'||!recruitEnded()||!$('result').hidden||!force&&g.time-recruitLesson.endedAt<.8)return;
 const completed=recruitLesson.status==='complete',exhausted=recruitLesson.status==='exhausted';
 $('result-kicker').textContent=completed?'練習クリア':'再挑戦';$('result-title').textContent=completed?'仲間の一撃、命中。':exhausted?'仲間の出番を残そう。':'もう一度、挑もう。';
 $('result-reason').hidden=completed;$('result-reason').textContent=exhausted?'敵がいなくなりました。仲間の命中はまだ0回です。':completed?'':g.lossReason==='king'?'味方の王将が倒れたため敗北。':'操作中の駒の体力がなくなりました。';
 $('result-score').textContent=challenge.points;$('result-detail').textContent='加入 '+recruitLesson.joined.size+'体 · 仲間の命中 '+recruitLesson.hits+'回';
 $('result-metrics').textContent='戦闘時間 '+formatBattleTime(challenge.elapsed)+' · 自分の撃破 '+g.score+'体 · 被弾 '+g.playerHits+'回';$('result-points-detail').textContent=challengeBreakdown(challenge);$('result-record').textContent=g.arena&&!E.isStandardArmyArena(g)?(selectedScenario==='army'?'小さな盤面：標準記録とは比較せず、保存しません。':'練習の得点・タイムは保存しません。'):'';
 setSortieVictorySummary(completed,true);
 $('next-lesson').hidden=false;$('next-lesson').textContent='9. 仲間と交代へ';hideTactics();clearInput();paused=true;$('paused').hidden=true;$('result').hidden=false;revealBattleAudioResult();$('result').scrollTop=0;$(completed?'next-lesson':'retry-battle').focus({preventScroll:true});
}
function tutorialResultText(state,record){
 const kind=state.scenario;
 if(kind==='slash_trial')return record.bestSlash>=2?'一振りで最大'+record.bestSlash+'体に命中。':state.won?'全て撃破。次は一振りで2体以上を狙おう。':'敵が重なる向きから、一振りでまとめて狙おう。';
 if(kind==='thrust_trial')return record.bestThrust>=2?'突きで最大'+record.bestThrust+'連続命中。':state.won?'1体ずつ撃破。次は間を空けずに次の敵を狙おう。':'手前の敵を倒したら、次の敵との間合いを詰めよう。';
 if(kind==='jump_trial')return state.won?'着地の衝撃波で撃破。前衛を越えて奥を狙おう。':'跳ぶ方向を確かめてから、右前の敵を狙おう。';
 if(kind==='charge_trial')return state.won?'突撃で撃破。味方を避け、空いた進路を選ぼう。':'突撃は味方の駒でも止まる。横へ回って進路を空けよう。';
 if(kind==='switch_trial')return '仲間へ操作を交代できました。本戦でも、交代できる味方がいる時に使えます。';
 if(kind==='squad')return '仲間の攻撃を1回当てよう。';
 return state.won?'正面の敵を撃破。突きが当たるのは最初の1体。':'敵の正面に向き直り、槍の先で狙おう。';
}
// Read settled lesson/game outcomes only; audio never changes game state.
function syncBattleAudioResult(){
 if(inLobby)return;
 if(actionLesson){if(actionLessonEnded())window.BattleAudio.finish?.(actionLesson.status==='complete'?'tutorial_success':actionLesson.status==='exhausted'?'tutorial_retry':'tutorial_defeat');return;}
 if(recruitLesson){if(recruitEnded())window.BattleAudio.finish?.(recruitLesson.status==='complete'?'tutorial_success':recruitLesson.status==='exhausted'?'tutorial_retry':'tutorial_defeat');return;}
 if(!E.battleEnded(g))return;
 const outcome=g.draw?'draw':selectedScenario==='army'?(g.won?'victory':'defeat'):g.won?'tutorial_success':g.hp<=0||g.lossReason==='king'?'tutorial_defeat':'tutorial_retry';
 window.BattleAudio.finish?.(outcome);
}
function revealBattleAudioResult(){
 if(inLobby||$('result').hidden)return;
 syncBattleAudioResult();window.BattleAudio.revealResult?.();
}
function personalImpactSound(game){const contacts=game.events.filter(ev=>ev.type==='hit'||ev.type==='npc_damage'&&ev.personal);const ranked=contacts.map(ev=>{const source=ev.sourceId==null?game.player:ev.sourceId===game.playerId?game.player:game.enemies.find(actor=>actor.id===ev.sourceId);return {heavy:source?.equipment==='heavy',action:ev.action,waveId:ev.waveId,sourceId:ev.sourceId};});return ranked.sort((a,b)=>Number(b.heavy)-Number(a.heavy)+((b.action==='burst'||b.action==='charge')? .1:0)-((a.action==='burst'||a.action==='charge')?.1:0))[0]||{heavy:false,action:null};}
function tick(now){requestAnimationFrame(tick);const realDt=Math.min(.25,Math.max(0,(now-last)/1000));last=now;if(!paused){getInput();const wasTime=g.time;const simulationDt=advanceSimulation(followupEngine,g,realDt,getInput,selectedScenario);syncGuardIntent();const challengeUpdate=updateChallenge(challenge,g);if(challengeUpdate.completed){finishChallengeRecord();}if(recruitLesson&&updateRecruitRecord(recruitLesson,g))finishRecruitRecord();if(actionLesson&&updateActionLessonRecord(actionLesson,g))finishActionLesson();const mastery=selectMasteryFeedback(masteryFeedback,challengeUpdate.bonuses),promotedNow=g.events.some(e=>e.type==='promote'),personalImpact=g.events.some(e=>e.type==='hit'||e.type==='npc_damage'&&e.personal),rewardSoundTier=mastery?.first&&!quiet()&&!E.battleEnded(g)&&g.time>=promotionUntil&&!(g.time<eventUntil&&eventPriority>0)&&!g.events.some(e=>['player_hit','win','lose'].includes(e.type))?mastery.tier:0;if(promotedNow)window.BattleAudio.impact?.('promotion');if(personalImpact){const contact=personalImpactSound(g);window.BattleAudio.impact?.('impact',rewardSoundTier,contact.heavy,contact);}else if(!promotedNow&&!g.events.some(e=>['player_hit','win','lose'].includes(e.type))&&g.events.some(e=>e.type==='guard_block'))window.BattleAudio.guard?.();for(const ev of g.events){if(ev.type==='attack_release'&&ev.kind!=='burst')window.BattleAudio.action?.(ev.kind);if(ev.type==='thrust_contact')handEffects.hit(ev.x,ev.z,{enemy:ev.team==='ally',y:ev.y,lethal:false,kind:ev.blocked?'guard':'thrust',compact:ev.blocked,targetId:ev.targetId,sourceId:ev.sourceId,sourceAction:'thrust',comboStage:contactPresentationStage(ev),priority:ev.targetId===g.playerId?3:ev.personal?2:0});if(ev.type==='hit'){if(ev.action!=='thrust'){handEffects.hit(ev.x,ev.z,{stone:ev.id%2===1,y:E.ENEMY_HEIGHT/2,kind:ev.action==='charge'?'charge':'damage',targetId:ev.id,priority:2,comboStage:contactPresentationStage(ev)});if(!quiet())burst(ev.x,ev.z,12);}shakePower=ev.action==='thrust'?.04:.18;$('combo-count').textContent=g.combo;$('combo').hidden=false;$('combo').classList.add('show');comboUntil=g.time+1.6;if(selectedScenario==='army')$('mission').textContent=g.combo>=10?'軍勢を、切りひらく':'敵の王将を狙え · 味方 '+(g.enemies.filter(e=>e.alive&&e.team==='ally').length+(g.hp>0?1:0))+'体';}if(ev.type==='combo_tier'&&g.time>promotionUntil){$('impact').textContent=ev.combo>=20?'一 騎 当 千':ev.combo>=10?'一 網 打 尽':'5連続撃破';$('impact').classList.add('show');impactUntil=g.time+.65;}if(ev.type==='guard_block'&&ev.action!=='thrust'){handEffects.hit(ev.x,ev.z,{lethal:false,kind:'guard',priority:3,y:(ev.y||0)+1.9});}if(ev.type==='npc_damage'){npcHitReactions.note(g,ev);if(ev.action!=='thrust')handEffects.hit(ev.x,ev.z,{enemy:ev.team==='ally',stone:ev.id%2===1,y:(ev.y||0)+E.ENEMY_HEIGHT/2,lethal:false,kind:ev.action==='charge'?'charge':'damage',targetId:ev.id,priority:ev.personal?2:0,comboStage:contactPresentationStage(ev)});}if(ev.type==='npc_hit'&&ev.action!=='thrust'){handEffects.hit(ev.x,ev.z,{enemy:ev.team==='ally',stone:ev.id%2===1,y:E.ENEMY_HEIGHT/2,kind:ev.action==='charge'?'charge':'damage',targetId:ev.id});}if(ev.type==='reinforce'){eventNotice((ev.team==='ally'?'味方に':'敵に')+' '+E.PIECES[g.enemies.find(e=>e.id===ev.id)?.piece||'pawn'].name+' が加入');if(!quiet())handEffects.hit(ev.x,ev.z,{enemy:ev.team==='enemy',y:.6});}if(ev.type==='player_hit'){heroHitFeedback.note(g,ev);window.BattleAudio.action?.(g.player?.equipment==='heavy'?'hurtHeavy':'hurt');if(ev.action!=='thrust')handEffects.hit(ev.x,ev.z,{enemy:true,y:(ev.y||0)+1.7,lethal:ev.hp===0,kind:ev.action==='charge'?'charge':'damage',targetId:g.playerId,priority:3});$('status').textContent='被弾。体力'+g.hp;shakePower=.22;}if(ev.type==='lose'){clearInput();$('mission').textContent=g.lossReason==='king'?'味方の王将が討ち取られた':'体力がなくなった';$('status').textContent='もう一度挑戦できます';}if(ev.type==='land'){if(!quiet()){burst(ev.x,ev.z,12);handEffects.hit(ev.x,ev.z,{y:.35});}window.BattleAudio.action?.('landing');shakePower=.1;}if(ev.type==='promote'){promotionUntil=g.time+1.6;impactUntil=promotionUntil;$('impact').textContent=E.pieceInfo(g).name+' に 自 動 覚 醒';$('impact').classList.add('show');$('mission').textContent=E.pieceKey(g)==='dragon'?'斜めの一歩で、包囲を破れ':E.pieceKey(g)==='horse'?'縦横の一歩も、使える':'金の動きで、切りひらけ';}if(ev.type==='win'){$('impact').textContent=g.battleScenario?.objective==='protect'?'王 将 護 衛':selectedScenario==='army'?'王 将 討 取':'練 習 達 成';$('impact').classList.add('show');impactUntil=g.time+1.2;$('mission').textContent=selectedScenario==='army'?'王将討ち取り':'練習達成';$('status').textContent=selectedScenario==='army'?'敵の王将を討ち取り、勝利':'練習達成';}}
 window.BattleAudio.battlefield?.(g);
 syncBattleAudioResult();
 if(E.battleEnded(g)){$('battle-event').hidden=true;eventUntil=0;eventPriority=0;}
 // Personal mastery replaces the existing impact's timbre, never adds a voice.
 if(selectedScenario==='army'&&challengeUpdate.bonuses.length&&!g.events.some(e=>['player_hit','win','lose'].includes(e.type))){
  if(mastery)eventNotice(bonusText(mastery.bonus),0,g.time>=promotionUntil?mastery.tier:0);
  else{const latest=challengeUpdate.bonuses.at(-1),same=challengeUpdate.bonuses.filter(b=>b.type===latest.type&&b.time===latest.time);eventNotice(bonusText({...latest,points:same.reduce((n,b)=>n+b.points,0),tier:latest.type==='invasion'&&same.length>1?'army':latest.tier}));}
 }
 if(g.time>impactUntil)$('impact').classList.remove('show');if(comboUntil&&g.time>comboUntil)hideCombo();if(selectedScenario==='switch_trial')showSwitchResult();if(recruitLesson)showRecruitResult();if(actionLesson)showActionLessonResult();if(!recruitLesson&&!actionLesson&&((g.won&&g.time-g.winTime>1.5)||(g.lost&&g.time-g.lossTime>.7)||(g.draw&&g.time-g.drawTime>.7))&&$('result').hidden){$('result-kicker').textContent=selectedScenario==='army'?campaignTitle(g.battleScenario?.id||'free')+(g.lost?' · 再挑戦':''):g.lost?'再挑戦':'練習クリア';$('result-title').textContent=g.lost?'もう一度、挑もう。':selectedScenario==='army'?'王将、討ち取った。':selectedScenario==='switch_trial'?'仲間と交代、成功。':'命中、撃破。';$('result-reason').hidden=!g.lost;$('result-reason').textContent=g.lost?(g.lossReason==='king'?'味方の王将が倒れたため敗北。':E.isSpectator(g)?'味方の駒が全て倒れました。':'操作中の駒の体力がなくなりました。'):'';$('result-score').textContent=challenge.points;$('next-lesson').hidden=!g.won||(selectedScenario==='army'&&!(g.battleScenario?nextBattleScenario():canOfferHeavyChallenge()));$('final-challenge').hidden=!canOfferFinalChallenge();$('next-lesson').textContent=g.battleScenario?(nextBattleScenario()?campaignTitle(nextBattleScenario().id)+'の準備へ':'次のシナリオへ'):selectedScenario==='army'?'重装の敵に挑む（体力3）':selectedScenario==='switch_trial'?'本戦の準備へ':'次の課題へ';$('result-metrics').textContent='戦闘時間 '+formatBattleTime(challenge.elapsed)+' · 撃破 '+g.score+'体 · 被弾 '+g.playerHits+'回';const best=challengeRecord(challengeRecords,challenge.key);$('result-points-detail').textContent=challengeBreakdown(challenge);$('result-record').textContent=g.arena&&!E.isStandardArmyArena(g)?(selectedScenario==='army'?'小さな盤面：標準記録とは比較せず、保存しません。':'練習の得点・タイムは保存しません。'):g.capabilityLoadout||followupActive()||g.devEscortBrace===true?('設定変更あり：'+(followupActive()?'標準記録とは比較せず、保存しません。':'得点・タイム記録は保存しません。')):best?'同じ設定の最高 '+best.bestScore+'点 · 最速 '+(best.bestTimeMs==null?'—':formatBattleTime(best.bestTimeMs/1000))+(challengeResult?.newTime?'（最速更新）':challengeResult?.newScore?'（得点更新）':'')+(challengeSaved?'':' · 記録は今回のみ（保存できません）'):'';$('result-detail').textContent=selectedScenario!=='army'?tutorialResultText(g,challenge):'最大 '+g.best+' 連続撃破 · 斬 '+g.sweeps+' / 突撃 '+g.charges+' / 突 '+g.thrusts+' / 跳 '+g.jumps+' / 踏込 '+g.steps;if(E.isSpectator(g)){$('result-kicker').textContent=campaignTitle(g.battleScenario?.id||'free')+' · 観戦終了';$('result-title').textContent=g.draw?'引き分け':g.won?'味方の勝利':'敵の勝利';$('result-reason').hidden=!g.draw&&!g.lost;if(g.draw)$('result-reason').textContent=g.drawReason==='mutual-terminal'?'敵の王将と最後の味方が同時に倒れました。':'両軍の王将が同時に倒れました。';$('result-metrics').textContent='戦闘時間 '+formatBattleTime(challenge.elapsed);$('result-points-detail').textContent='';$('result-detail').textContent='味方 '+g.enemies.filter(e=>e.alive&&e.team==='ally').length+' ／ 敵 '+g.enemies.filter(e=>e.alive&&e.team==='enemy').length;$('result-record').textContent='観戦の得点・タイム記録は保存しません。';}if(g.battleScenario?.objective==='protect'&&g.won){$('result-kicker').textContent=campaignTitle(g.battleScenario.id);$('result-title').textContent='王将、守り抜いた。';$('result-detail').textContent=g.scenarioOutcome==='royal-clear'?'敵を全て退け、王の安全を確保。':g.battleScenario.duration+'秒、王を守り抜いた。';}setSortieVictorySummary(g.won&&!E.isSpectator(g)&&(selectedScenario!=='army'||((!g.arena||E.isStandardArmyArena(g))&&!g.capabilityLoadout&&!followupActive()&&g.devEscortBrace!==true)),selectedScenario!=='army');hideTactics();$('result').hidden=false;revealBattleAudioResult();$('result').scrollTop=0;clearInput();$(g.lost&&!E.isSpectator(g)?'retry-battle':g.won&&selectedScenario!=='army'?'next-lesson':'again').focus({preventScroll:true});}if(recruitLesson){$('hint').textContent=recruitHint(g,recruitLesson,E);$('hint').classList[recruitEnded()?'add':'remove']('hide');}else if(actionLesson){$('hint').textContent=actionLessonHint(actionLesson,g,E);$('hint').classList[actionLessonEnded()?'add':'remove']('hide');}else if(selectedScenario==='switch_trial'){$('hint').textContent=switchLessonHint();$('hint').classList[g.won?'add':'remove']('hide');}else if(g.active&&(selectedScenario!=='army'||input.x||input.z||g.guarding||g.sweeps||g.thrusts||g.charges||g.jumps||g.steps||g.promoted))$('hint').classList.add('hide');updateUI();if(simulationDt>0)draw(simulationDt,selectedScenario==='army'?advanceSimulation.motionElapsed(g):undefined);else if(renderDirty)draw(0);}else{advanceSimulation.reset(g);updateUI();if(renderDirty)draw(0);}
 if(!paused&&realDt>.034)slowFrames+=realDt;else slowFrames=Math.max(0,slowFrames-realDt*2);if(slowFrames>2.5&&renderer.getPixelRatio()>1){renderer.setPixelRatio(1);resize();slowFrames=0;}
}
const saved=loadPreferences(preferenceStorage);selectedHandicapReserve=saved.handicapToEnemyReserve===true;stagedHandicapReserve=selectedHandicapReserve;selectedHandicapDeployment=saved.handicapEnemyDeployment==='promoted-start'?'promoted-start':'reserve';stagedHandicapDeployment=selectedHandicapDeployment;selectedAutomaticAllyReturn=saved.automaticAllyReturn!==false;stagedAutomaticAllyReturn=selectedAutomaticAllyReturn;if(E.battleScenarioDefinition(saved.battleScenario)){selectedBattleScenario=saved.battleScenario;const m=E.battleScenarioDefinition(selectedBattleScenario);selectedMissionPiece=m.pieces.includes(saved.missionPiece)?saved.missionPiece:m.pieces[0];}if(saved.version===1&&saved.scenario==='army'&&!saved.battleScenario)selectedBattleScenario='free';if(saved.battleScenario==='free')selectedBattleScenario='free';if(saved.controlMode==='spectator')selectedControlMode='spectator';selectedTeamTactics=E.normalizeTeamTactics(saved.teamTactics);const own=(object,key)=>typeof key==='string'&&Object.prototype.hasOwnProperty.call(object,key);if(saved.terrain==='three_bridges')selectedTerrain='three_bridges';if(saved.scenario==='army'||own(drills,saved.scenario))selectedScenario=saved.scenario;if(saved.kingPersonalities&&typeof saved.kingPersonalities==='object')selectedKingPersonalities=E.normalizeKingPersonalities(saved.kingPersonalities);if(saved.strategies&&typeof saved.strategies==='object')selectedStrategies=E.normalizeStrategies(saved.strategies);if(saved.teamStats&&typeof saved.teamStats==='object')selectedTeamStats=E.equipmentTeamStats(saved.teamStats);if(own(E.DIFFICULTIES,saved.difficulty))selectedDifficulty=saved.difficulty;if(own(E.PIECES,saved.piece))selectedArmyPiece=saved.piece;if(own(E.HANDICAPS,saved.handicap))selectedHandicap=saved.handicap;else if(saved.allies>0)selectedHandicap='even';if(!E.handicapAllows(selectedHandicap,selectedArmyPiece))selectedArmyPiece='king';if(own(E.FORMATIONS,saved.enemyFormation))selectedFormation=saved.enemyFormation;if(own(E.FORMATIONS,saved.allyFormation))selectedAllyFormation=saved.allyFormation;
updateUI();draw(0);openMenu(true);window.battleReady=true;requestAnimationFrame(tick);
// A read-only inspection surface for diagnostics. No automatic demo or autoplay.
window.shogiBattle={state:()=>({...(g.capturedReturnPolicy?{capturedReturn:{...E.capturedReturnSummary(g),panelOpen:capturedReturnOpen}}:{}),...(g.arena?{arena:g.arena,arenaRuleset:E.isStandardArmyArena(g)?E.ARMY_ARENA_RULESET:'authored-arena-v1'}:{}),capabilities:E.capabilityInfo(g),capabilityCanonical:g.capabilityLoadout?.canonical||null,lesson:actionLesson?{kind:actionLesson.kind,status:actionLesson.status,blocks:actionLesson.blocks,awakened:actionLesson.awakened,hits:actionLesson.hits}:recruitLesson?{status:recruitLesson.status,joined:recruitLesson.joined.size,hits:recruitLesson.hits}:null,...(g.battleScenario?{battleScenario:{...g.battleScenario}}:{}),terrain:g.terrain||'plain',scenario:g.scenario,controlMode:E.isSpectator(g)?'spectator':'manual',draw:!!g.draw,playerId:g.playerId,guarding:!!g.guarding,automaticAwakening:E.automaticAwakening(g),awakeningPending:E.pendingAwakening(g),mode:g.mode,score:g.score,points:challenge.points,battleTime:challenge.elapsed,thrustBonus:challenge.thrustBonus,slashBonus:challenge.slashBonus,invasionPoints:challenge.invasionPoints,kingPersonalities:g.kingPersonalities,invasion:g.invasion?E.Invasion.invasionSummary(g.invasion):null,total:g.battleScenario?.initialEnemies||E.COUNT,formation:g.formationKey,piece:E.pieceKey(g),hp:g.hp,maxHp:g.maxHp,lost:g.lost,playerHits:g.playerHits,waves:g.waves.map(w=>({id:w.id,team:w.team,kind:w.kind,x:w.x,y:w.y,z:w.z,rx:w.rx,ry:w.ry,rz:w.rz})),enemyWindups:g.enemies.filter(e=>e.alive&&e.attack==='windup').length,moveBlocked:!!g.moveBlocked,position:g.player?{x:g.player.x,y:g.player.y||0,z:g.player.z}:null,direction:g.player?{x:g.player.dx,z:g.player.dz}:null,charges:g.charges,sweeps:g.sweeps,steps:g.steps,thrusts:g.thrusts,jumps:g.jumps,turns:g.turns,promoted:g.promoted,awakeningZoneZ:E.ENEMY_ZONE_Z,sweepCooldown:g.sweepCooldown,stepCooldown:g.stepCooldown,combo:g.combo,remaining:g.enemies.filter(e=>e.alive&&e.team==='enemy').length,allies:g.enemies.filter(e=>e.alive&&e.team==='ally').length,strategies:g.strategies,teamStats:g.teamStats,handicap:g.handicap,initialAllies:g.allyCount,initialArmy:g.allyCount+(g.player?1:0),heroSlotKey:g.heroSlotKey,allyFormation:g.allyFormation,reinforcements:g.reinforcements,inLobby,difficulty:g.difficulty,paused,won:g.won,camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z,targetX:camTarget.x,targetZ:camTarget.z,fov:camera.fov,zoom:camera.zoom,aspect:camera.aspect,offsetX:g.player?camera.position.x-g.player.x:null,offsetZ:g.player?camera.position.z-g.player.z:null,width:viewWidth,height:viewHeight},animation:{stroke:g.mode==='sweep'?1-g.phase/E.SWEEP_DURATION:0,torsoYaw:torso.rotation.y,rigged:true,clip:heroPose?.name,clipTime:heroPose?.time,walking:g.teamStats?.ally.equipment==='heavy'||walking||keys.has('Shift'),heroTriangles:models.heroTriangles,enemyTriangles:models.enemyTriangles,runCalibration:models.runCalibration,npcRigState:models.npcRigState,npcAnimated:models.npcAnimations?.selected.size||0,npcAnimationCap:models.npcAnimations?.capacity||0},viewport:viewportInfo(),background:{state:backdropState},renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio()}})};
