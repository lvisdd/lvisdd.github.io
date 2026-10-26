(function(){'use strict';
const $=id=>document.getElementById(id),FILES={music:'battle_loop',sweep:'umi_swing_sweep',thrust:'umi_swing_thrust',charge:'swing_charge',dragon:'swing_charge',jump:'umi_takeoff',landing:'umi_ground',guard:'umi_guard',impact:'impact_light',impactThrust:'umi_thrust',impactSlash:'umi_slash',impactCharge:'umi_charge',impactJump:'umi_jump',hurt:'impact_light',impactHeavy:'impact_heavy',hurtHeavy:'hurt_heavy',promotion:'umi_awaken',test:'start_test'};
const RESULT_FILES={victory:'result_victory',defeat:'result_defeat',tutorial_success:'result_tutorial_success',tutorial_retry:'result_tutorial_retry',tutorial_defeat:'result_tutorial_defeat'},RESULT_DELAY=.03,MUSIC_FADE=.35;
let scene='preparation',sceneEpoch=0,resultOutcome=null,resultSource=null,resultPending=null,resultRevealAllowed=false,resultRevealed=false,resultNotBefore=0;
let enabled=false,musicEnabled=true,phase='off',automaticStart=false,volume='normal',context,master,musicGain,sfxGain,compressor,musicSource=null,request=0,pending=null,guardPending=null,lastImpact=-Infinity,lastGuard=-Infinity,lastHurt=-Infinity,priorityUntil=0,suspension=null,startDeadline=null,audioSession=null,previousSessionType=null;const buffers=new Map(),voices=new Set(),retiring=new Set(),gainRamps=new WeakMap(),contactTimes=new Map();
const MAX_VOICES=6,MAX_RETIRING=2,MAX_LOW_PRIORITY=3,VOICE_GAIN=.6,VOICE_ATTACK=.003,TAIL_RELEASE=.012;
const PRIORITY={guard:0,sweep:1,thrust:1,charge:1,dragon:1,jump:1,landing:1,test:1,impact:2,impactThrust:2,impactSlash:2,impactCharge:2,impactJump:2,impactHeavy:2,hurt:3,hurtHeavy:3,promotion:4};
function running(){return context?.state==='running'&&audioSession?.state!=='interrupted'&&!document.hidden;}
function ui(message){const ready=enabled&&phase==='ready'&&running();$('sound').setAttribute('aria-pressed',String(ready));$('sound').textContent=!enabled?'♪ 音を開始':ready?'♪ 音 ON':phase==='starting'&&!automaticStart?'♪ 準備中':phase==='error'?'♪ 音を再試行':'♪ 音を再開';$('music').textContent=musicEnabled?'BGM：ON':'BGM：OFF';$('music').setAttribute('aria-pressed',String(musicEnabled));if(message)$('sound-status').textContent=message;}
// Explicit opt-in is media playback on iOS, where ambient Web Audio can be
// silent even while its AudioContext is running. No silent media/keepalive loop.
// This optional standard API is absent in some browsers and embedded webviews.
function claimSession(){try{const session=window.navigator?.audioSession;if(!session)return;if(audioSession!==session){audioSession=session;session.addEventListener?.('statechange',()=>{if(enabled&&(phase==='ready'||phase==='starting')&&session.state==='interrupted')pause('音声が中断されました。音ボタンで再開できます');});}if(previousSessionType===null){const previous=session.type;session.type='playback';previousSessionType=previous;}}catch{}}
function releaseSession(){if(previousSessionType===null)return;const previous=previousSessionType;previousSessionType=null;try{if(audioSession?.type==='playback')audioSession.type=previous;}catch{}}
function clearStartDeadline(){if(startDeadline!==null){clearTimeout(startDeadline);startDeadline=null;}}
function suspendContext(){if(!context||context.state==='closed')return;try{const ctx=context,attempt={context:ctx};attempt.promise=Promise.resolve(ctx.suspend()).catch(()=>{}).finally(()=>{if(suspension===attempt)suspension=null;});suspension=attempt;}catch{}}
// All mixer changes use short linear ramps. Retarget from the scheduled value
// at this audio time, not the previous target, including repeated same-frame cues.
function rampGain(param,target,seconds){const now=context.currentTime,previous=gainRamps.get(param);let value=param.value;if(previous){const progress=previous.end>previous.start?Math.min(1,Math.max(0,(now-previous.start)/(previous.end-previous.start))):1;value=previous.from+(previous.to-previous.from)*progress;}param.cancelScheduledValues(now);param.setValueAtTime(value,now);param.linearRampToValueAtTime(target,now+seconds);gainRamps.set(param,{start:now,end:now+seconds,from:value,to:target});}
function gain(){if(master)rampGain(master.gain,{soft:.35,normal:.65,loud:.9}[volume],.02);}
function mixSfx(){if(!sfxGain)return;const target=1/Math.sqrt(Math.max(1,voices.size+retiring.size)),previous=gainRamps.get(sfxGain.gain)?.to??sfxGain.gain.value;rampGain(sfxGain.gain,target,target<previous ? .006 : .08);}
function setup(){if(context&&context.state!=='closed')return context;if(context){stopAll();context.onstatechange=null;pending=null;guardPending=null;suspension=null;}const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('このブラウザでは音声を開始できません');const ctx=context=new Audio();master=context.createGain();compressor=context.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=6;compressor.ratio.value=8;compressor.attack.value=.003;compressor.release.value=.12;master.connect(compressor);compressor.connect(context.destination);musicGain=context.createGain();musicGain.gain.value=.317731;musicGain.connect(master);sfxGain=context.createGain();sfxGain.gain.value=1;sfxGain.connect(master);gain();ctx.onstatechange=()=>{if(ctx===context&&enabled&&((phase==='ready'&&!running())||(phase==='starting'&&ctx.state==='interrupted')))pause('音声が中断されました。音ボタンで再開できます');};return ctx;}
function load(ctx){if(pending?.context===ctx)return pending.promise;const attempt={context:ctx};pending=attempt;attempt.promise=Promise.all([...new Set(Object.values(FILES))].filter(name=>name!==FILES.guard).map(async name=>{if(buffers.has(name))return;const r=await fetch('audio/action/'+name+'.wav');if(!r.ok)throw Error('音声の読み込みに失敗しました');const data=await r.arrayBuffer();buffers.set(name,await ctx.decodeAudioData(data));})).catch(e=>{if(pending===attempt)pending=null;throw e});return attempt.promise;}
// Optional guard never delays or fails the original audio load. One pending
// fetch/decode is shared by explicit starts; the latest explicit start can adopt
// its result. Pause/mute invalidates that permission; completion never retries.
function loadOptionalGuard(id){if(buffers.has(FILES.guard))return;if(guardPending){guardPending.request=id;return;}const ctx=context,attempt=guardPending={request:id};(async()=>{const r=await fetch('audio/action/'+FILES.guard+'.wav');if(!r.ok)return;const data=await r.arrayBuffer(),buffer=await ctx.decodeAudioData(data);if(attempt.request===request&&enabled)buffers.set(FILES.guard,buffer);})().catch(()=>{}).finally(()=>{if(guardPending===attempt)guardPending=null;});}
// Optional result downloads never block audio opt-in or play from a completion.
function loadResults(){if(resultPending||Object.values(RESULT_FILES).every(name=>buffers.has(name)))return;const ctx=context,attempt={};resultPending=attempt;attempt.promise=Promise.all(Object.values(RESULT_FILES).map(async name=>{if(buffers.has(name))return;try{const r=await fetch('audio/action/'+name+'.wav');if(!r.ok)return;const buffer=await ctx.decodeAudioData(await r.arrayBuffer());buffers.set(name,buffer);}catch{}})).finally(()=>{if(resultPending===attempt)resultPending=null;});}
function stopMusic(seconds=0){const node=musicSource;if(!node)return;if(seconds>0&&running()){rampGain(musicGain.gain,0,seconds);try{node.stop(context.currentTime+seconds);return;}catch{}}musicSource=null;node.onended=null;try{node.stop()}catch{}node.disconnect();}
function playMusic(){if(scene!=='combat'||musicSource||!musicEnabled||!enabled||phase!=='ready'||!running())return;const buffer=buffers.get(FILES.music);if(!buffer)return;const node=musicSource=context.createBufferSource();node.buffer=buffer;node.loop=true;node.connect(musicGain);node.onended=()=>{node.disconnect();if(musicSource===node)musicSource=null;};rampGain(musicGain.gain,.317731,.08);node.start();}
function stopResult(){const node=resultSource;if(!node)return;resultSource=null;node.onended=null;try{node.stop()}catch{}node.disconnect();node.resultGain.disconnect();}
// Ending combat and showing its result are separate UI events.
function finishBattle(outcome){
 if(scene!=='combat'||!(outcome==='draw'||Object.hasOwn(RESULT_FILES,outcome)))return;
 scene='result';resultOutcome=outcome;++sceneEpoch;stopMusic(MUSIC_FADE);stopResult();
 resultRevealed=false;resultRevealAllowed=enabled&&musicEnabled&&phase==='ready'&&running();
 resultNotBefore=(context?.currentTime||0)+MUSIC_FADE;
}
function revealResult(){
 if(scene!=='result'||resultRevealed)return;
 resultRevealed=true;
 // A hidden/muted/interrupted or unloaded result is consumed, never queued.
 const allowed=resultRevealAllowed;resultRevealAllowed=false;
 if(!allowed||!enabled||!musicEnabled||phase!=='ready'||!running())return;
 const outcome=resultOutcome,buffer=buffers.get(RESULT_FILES[outcome]);if(!buffer)return;
 const node=resultSource=context.createBufferSource(),resultGain=context.createGain();node.buffer=buffer;node.loop=false;node.resultGain=resultGain;node.resultKind=outcome;resultGain.gain.value=['victory','tutorial_success'].includes(outcome)?.516313:.65;node.connect(resultGain);resultGain.connect(master);
 node.onended=()=>{node.disconnect();resultGain.disconnect();if(resultSource===node)resultSource=null;};const at=Math.max(context.currentTime+RESULT_DELAY,resultNotBefore);node.start(at);node.stop(at+Math.min(buffer.duration,12));
}
function prepare(){scene='preparation';resultOutcome=null;++sceneEpoch;pause();}
function beginBattle(){if(scene==='combat')return;scene='combat';resultOutcome=null;++sceneEpoch;stopAll();lastImpact=lastGuard=lastHurt=-Infinity;priorityUntil=0;if(enabled&&(phase==='paused'||phase==='error'))start();else playMusic();}
// Six admitted SFX, no waiting queue. At most two additional old tails can
// retire for 12 ms; further replacements are dropped until a retirement ends.
// This bounds the brief crossfade rather than silently accumulating old nodes.
function finishVoice(node){voices.delete(node);retiring.delete(node);node.disconnect();node.voiceGain.disconnect();mixSfx();}
function retireVoice(node){voices.delete(node);retiring.add(node);rampGain(node.voiceGain.gain,0,TAIL_RELEASE);try{node.stop(context.currentTime+TAIL_RELEASE);}catch{finishVoice(node);}}
function replacement(kind,priority){const all=[...voices],family=['impactHeavy','hurtHeavy','impactCharge','impactJump'].includes(kind)?all.filter(n=>n.cueKind===kind):[];if(family.length>=2)return family.slice().sort((a,b)=>a.priority-b.priority)[0];const low=all.filter(n=>n.priority<=1),candidates=priority<=1&&low.length>=MAX_LOW_PRIORITY?low:all.length>=MAX_VOICES?all:[];return candidates.filter(n=>n.priority<=priority).sort((a,b)=>a.priority-b.priority)[0]||null;}
function cue(kind,rate=1,npc=null){
 if(!enabled||phase!=='ready'||!running()||(scene!=='combat'&&kind!=='test'))return;
 const buffer=buffers.get(FILES[kind]);if(!buffer)return;
 const now=Date.now(),priority=npc?(npc.group==='attack'?-1:0):PRIORITY[kind]??1,lowCount=[...voices].filter(n=>n.priority<=1).length;
 if(!npc&&kind==='guard'&&(now-lastGuard<110||now-lastImpact<110||now-lastHurt<110||now<priorityUntil||voices.size>=MAX_VOICES||lowCount>=MAX_LOW_PRIORITY||[...voices].some(n=>n.guardCue)))return;
 // Two active ambient voices reserve four hero slots. A real NPC hit may
 // retire an NPC swing, never a hero voice, within the existing two-tail cap.
 const npcVoices=[...voices].filter(n=>n.npcCue);
 if(npc&&(now-lastHurt<100||now-lastImpact<70||now<priorityUntil))return;
 const old=npc?(npcVoices.length>=NPC_VOICES||voices.size>=MAX_VOICES||lowCount>=MAX_LOW_PRIORITY?npcVoices.find(n=>n.priority<priority):null):replacement(kind,priority);
 if(npc&&!old&&npcVoices.length>=NPC_VOICES)return;
 if((old&&retiring.size>=MAX_RETIRING)||(!old&&(voices.size>=MAX_VOICES||(priority<=1&&lowCount>=MAX_LOW_PRIORITY))))return;
 if(old)retireVoice(old);
 // Let confirmed damage cut through the awakening tail, without suppressing either cue.
 if(!npc&&['impact','impactThrust','impactSlash','impactCharge','impactJump','impactHeavy','hurt','hurtHeavy'].includes(kind))for(const v of voices)if(v.cueKind==='promotion'){rampGain(v.voiceGain.gain,.10,.02);v.priority=1;}
 if(!npc&&kind==='guard')lastGuard=now;
 if(kind==='hurt'||kind==='hurtHeavy')lastHurt=now;
 const node=context.createBufferSource(),voiceGain=context.createGain();
 node.npcCue=!!npc;node.npcTeam=npc?.team;node.npcGroup=npc?.group;node.waveId=npc?.waveId;node.sourceId=npc?.sourceId;
 node.guardCue=kind==='guard'&&!npc;node.cueKind=kind;node.priority=priority;node.voiceGain=voiceGain;node.buffer=buffer;
 // Preserve the existing light-hurt pitch; contact-only light source is shared.
 node.playbackRate.value=kind==='hurt'?.68:kind==='impactJump'?rate*.82:rate;
 voiceGain.gain.value=0;node.connect(voiceGain);voiceGain.connect(sfxGain);voices.add(node);
 node.onended=()=>finishVoice(node);rampGain(voiceGain.gain,VOICE_GAIN*(npc?.level??1)*(kind==='landing'?.32:kind==='promotion'?.70:['charge','dragon','jump'].includes(kind)?.55:1),VOICE_ATTACK);mixSfx();node.start();return true;
}
// NPC sound is presentation-only: collect successful new engine waves per step,
// then consume once after hero cues. No input, timer, replay, or audio-start queue.
let npcFrameGame=null,npcLaunches=[];
const npcTimes=new Map(),NPC_VOICES=2,NPC_FRAME_CUES=2;
function clearNpcAudio(){npcFrameGame=null;npcLaunches=[];npcTimes.clear();}
function observeNpcWaves(game,firstWaveId){
 if(!enabled||phase!=='ready'||scene!=='combat'||!running())return;
 if(npcFrameGame!==game){npcFrameGame=game;npcLaunches=[];npcTimes.clear();}
 for(const w of game.waves||[])if(w.id>=firstWaveId&&w.ownerId!=null&&!w.personal&&w.sourceId!==game.playerId&&npcLaunches.length<32){
  const actor=game.enemies.find(e=>e.id===w.sourceId);if(!actor)continue;
  npcLaunches.push({group:'attack',action:w.kind,waveId:w.id,sourceId:w.sourceId,team:actor.team,x:w.sourceX,z:w.sourceZ,heavy:actor.equipment==='heavy'});
 }
}
function battlefield(game){
 const launches=npcFrameGame===game?npcLaunches:[];npcLaunches=[];
 if(!enabled||phase!=='ready'||scene!=='combat'||!running())return;
 const now=Date.now(),listener=game.player||{x:0,z:0},candidates=[...launches];
 // thrust_contact includes protected/invulnerable contacts. Only real damage
 // events authorize a hit sound; the hero's damage remains the existing hurt cue.
 for(const ev of game.events||[]){
  if((ev.type==='npc_hit'||ev.type==='npc_damage'&&!ev.personal)&&ev.sourceId!=null&&ev.sourceId!==game.playerId){
   const actor=game.enemies.find(e=>e.id===ev.sourceId);if(actor)candidates.push({...ev,group:'hit',team:actor.team,heavy:actor.equipment==='heavy'});
  }else if(ev.type==='escort_brace_block')candidates.push({...ev,group:'guard',action:'guard',sourceId:ev.id});
 }
 for(const [key,time] of npcTimes)if(now-time>=1000)npcTimes.delete(key);
 let admitted=0;const used=new Set();
 for(const c of candidates.map(c=>({...c,distance:Math.hypot(c.x-listener.x,c.z-listener.z)})).filter(c=>Number.isFinite(c.distance)&&c.distance<=34).sort((a,b)=>({hit:0,guard:1,attack:2}[a.group]-{hit:0,guard:1,attack:2}[b.group])||(npcTimes.get('team:'+a.team)||0)-(npcTimes.get('team:'+b.team)||0)||a.distance-b.distance)){
  if(admitted>=NPC_FRAME_CUES)break;
  const wave=c.group+':wave:'+c.sourceId+':'+c.waveId,cell=c.group+':cell:'+Math.floor(c.x/5)+':'+Math.floor(c.z/5),family='family:'+c.group+':'+c.team,interval=c.group==='attack'?105:c.group==='hit'?80:150;
  if(used.has(wave)||npcTimes.has(wave)||now-(npcTimes.get(cell)??-Infinity)<160||now-(npcTimes.get(family)??-Infinity)<interval)continue;
  used.add(wave);
  const kind=c.group==='guard'?'guard':c.group==='hit'?({thrust:'impactThrust',slash:'impactSlash',sweep:'impactSlash',charge:'impactCharge',burst:'impactJump',jump:'impactJump'})[c.action]:({slash:'sweep',sweep:'sweep',thrust:'thrust',charge:'charge',burst:'landing'})[c.action];
  if(!kind)continue;
  const distanceGain=1/(1+Math.max(0,c.distance-5)/14),level=(c.group==='attack'?.48:c.group==='guard'?.42:.58)*distanceGain;
  if(cue(kind,c.heavy?.9:1,{level,team:c.team,group:c.group,waveId:c.waveId,sourceId:c.sourceId})){
   admitted++;for(const key of [wave,cell,family,'team:'+c.team])npcTimes.set(key,now);
  }
 }
 // Bounded coalescing history, even under deliberately dense test fixtures.
 while(npcTimes.size>128)npcTimes.delete(npcTimes.keys().next().value);
}
function stopAll(){resultRevealAllowed=false;resultRevealed=true;clearNpcAudio();contactTimes.clear();stopMusic();stopResult();for(const node of [...voices,...retiring]){node.onended=null;try{node.stop()}catch{}node.disconnect();node.voiceGain.disconnect();}voices.clear();retiring.clear();if(sfxGain)mixSfx();}
function pause(message){++request;clearStartDeadline();if(enabled)phase='paused';stopAll();suspendContext();releaseSession();if(enabled)ui(typeof message==='string'?message:'音は一時停止中。音ボタンか攻撃操作で再開できます');}
function start(kind=null,retryGuard=true,automatic=false){if(document.hidden)return;enabled=true;phase='starting';automaticStart=automatic;const id=++request,epoch=sceneEpoch;clearStartDeadline();ui(automatic?'音声の再開を待っています。音ボタンで再試行できます':'アクション用の音を準備しています…');let resume,ctx,previousSuspend;try{claimSession();ctx=setup();previousSuspend=suspension?.context===ctx?suspension.promise:null;resume=ctx.resume();}catch(e){phase='error';stopAll();suspendContext();releaseSession();ui(e.message+'。音ボタンで再試行できます');return;}
 // Keep the first resume in the original gesture, before any fetch/await.
 // A prior asynchronous suspend may finish later; settle it before confirming
 // ON and retry resume once if needed. Stale starts never resume or play.
 if(retryGuard)loadOptionalGuard(id);loadResults();
 startDeadline=setTimeout(()=>{if(id!==request||!enabled)return;++request;startDeadline=null;pending=null;phase='error';stopAll();suspendContext();releaseSession();ui('音声の準備がタイムアウトしました。音ボタンで再試行できます');},10000);
 Promise.all([resume,previousSuspend,load(ctx)]).then(async()=>{if(id!==request||!enabled||document.hidden||ctx!==context)return;if(previousSuspend&&ctx.state==='suspended')await ctx.resume();if(id!==request||!enabled||document.hidden||ctx!==context)return;if(!running())throw Error('音声が中断されています');clearStartDeadline();phase='ready';playMusic();if(epoch===sceneEpoch)cue(kind);ui('音 ON。聞こえない場合は端末の音量・消音設定・Bluetoothの出力先を確認してください');}).catch(e=>{if(id!==request||!enabled||ctx!==context)return;clearStartDeadline();phase='error';stopAll();suspendContext();releaseSession();ui(e.message+'。音ボタンで再試行できます');});}
// A pending event retry is not a second user toggle: an explicit tap owns a new request.
$('sound').onclick=()=>{if(enabled&&(phase==='ready'||phase==='starting'&&!automaticStart)){enabled=false;phase='off';pause();ui('音 OFF');}else start();};
$('sound-test').onclick=()=>start('test');$('music').onclick=()=>{musicEnabled=!musicEnabled;if(!musicEnabled){resultRevealAllowed=false;resultRevealed=true;stopMusic();stopResult();}else playMusic();ui();};
$('volume').onchange=()=>{volume=$('volume').value;if(!['soft','normal','loud'].includes(volume))volume='normal';gain();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('pagehide',pause);
window.BattleAudio={observeNpcWaves,battlefield,prepare,beginBattle,finish:finishBattle,revealResult,guard(){cue('guard');},action(kind){if(kind==='guard'){this.guard();return;}if(!enabled||scene!=='combat'&&kind!=='test')return;if(phase==='paused'||phase==='error')start(kind,false,true);else cue(kind);},charge(){this.action('charge');},impact(kind='impact',tier=0,heavy=false,contact=null){if(!enabled||phase!=='ready')return;const now=Date.now(),confirmed=kind==='impact'&&contact&&['slash','sweep','thrust','charge','burst','jump'].includes(contact.action),action=confirmed?contact.action:null;for(const [key,time] of contactTimes)if(now-time>=110)contactTimes.delete(key);const key=confirmed?(contact.waveId!=null?String(contact.sourceId)+':'+String(contact.waveId):'action:'+action):null;if(kind!=='promotion'&&(confirmed?contactTimes.has(key):now-lastImpact<110||now<priorityUntil))return;const mapped=confirmed?({thrust:'impactThrust',slash:'impactSlash',sweep:'impactSlash',charge:'impactCharge',burst:'impactJump',jump:'impactJump'})[action]:null,rate=mapped?(heavy?.9:1):kind==='impact'&&Number.isInteger(tier)&&tier>=1&&tier<=3?[1,1.06,1.12,1.19][tier]:1;const played=cue(mapped||(kind==='impact'&&heavy?'impactHeavy':kind),mapped?rate:kind==='impact'&&heavy?1:rate);if(played){if(kind==='promotion')priorityUntil=now+700;else{lastImpact=now;if(confirmed){contactTimes.set(key,now);while(contactTimes.size>32)contactTimes.delete(contactTimes.keys().next().value);}}}},resume(){if(enabled&&(phase==='paused'||phase==='error'))start();},pause,state(){return {enabled,phase,musicEnabled,scene,resultOutcome,musicPlaying:!!musicSource,resultPlaying:!!resultSource,voices:voices.size,retiring:retiring.size};}};ui();
})();
