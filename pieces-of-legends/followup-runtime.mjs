import {createOrdinaryAttackPresentation} from './ordinary-attack-presentation.mjs';
/** Isolated executable input adapter. Never edits engine functions or g.combo.
 * Only the controlled actor uses deliberate follow-up inputs; NPC AI is unchanged.
 * Registry contract-only status stays unchanged: this local adapter supplies the
 * implementation for the three exact IDs below only when explicitly enabled. */
export const FOLLOWUP_ADAPTER=Object.freeze({id:'ground-followup-v1',implemented:Object.freeze(['thrust_followup','sweep_followup','charge_followup'])});
const IDS=Object.freeze({thrust:'thrust_followup',sweep:'sweep_followup',charge:'charge_followup'});
const ACTIONS=Object.keys(IDS),EPS=1e-9;
const positive=v=>Number.isFinite(v)&&v>0?v:0;
const face=g=>({dx:g.player.dx,dz:g.player.dz});
const sameFace=(a,b)=>Math.abs(a.dx-b.dx)<EPS&&Math.abs(a.dz-b.dz)<EPS;
const copy=x=>x==null?x:structuredClone(x);
export function compileFollowups(resolved,{enabled=false,bufferSeconds=.18,queueLifetime=.40,queueWindow='late',queueStart=.08}={}) {
  if(!['late','after-start'].includes(queueWindow)||!Number.isFinite(queueStart)||queueStart<.05||queueStart>.2||!Number.isFinite(bufferSeconds)||bufferSeconds<.05||bufferSeconds>.25||!Number.isFinite(queueLifetime)||queueLifetime<bufferSeconds||queueLifetime>(queueWindow==='late'?.75:1.5))throw new TypeError('Invalid explicit follow-up timing');
  const result={enabled:enabled===true,adapter:queueWindow==='after-start'?'ground-combo-v2':FOLLOWUP_ADAPTER.id,bufferSeconds,queueLifetime,queueWindow,queueStart,actions:{}};
  for(const action of ACTIONS){const id=IDS[action],cap=resolved?.capabilities?.[id],base=resolved?.capabilities?.[action];
    const parameters=resolved?.abilityParameters?.[id],limit=parameters&&Object.hasOwn(parameters,'stageLimit')?parameters.stageLimit:2;
    const supported=!!(result.enabled&&resolved?.ok&&resolved.role==='hero'&&base?.enabled&&base.executable&&cap?.enabled&&Number.isInteger(limit)&&limit>=2&&limit<=3);
    result.actions[action]={id,enabled:supported,stageLimit:supported?limit:1};
  }
  return result;
}
export function createFollowupRuntime(E,{enabled=false,resolveActorFor=()=>null,bufferSeconds=.18,queueLifetime=.40,traceLimit=256,finisherRecovery=0,maxCharges=2,queueWindow='late',queueStart=.08,thrustTimingProfile=null}={}) {
  if(thrustTimingProfile!==null&&thrustTimingProfile!=='three-hit-thrust-v1')throw new TypeError('Invalid optional thrust timing profile');
  if(thrustTimingProfile&&typeof E.thrustTiming!=='function')throw new TypeError('Thrust timing engine is required');
  if(!E?.step||!E?.thrust||!E?.charge||!E?.sweep)throw new TypeError('A real engine API is required');
  if(!Number.isInteger(traceLimit)||traceLimit<16||traceLimit>4096)throw new TypeError('Invalid bounded trace size');
  if(!Number.isInteger(maxCharges)||maxCharges<2||maxCharges>3)throw new TypeError('Invalid charge stage bound');
  if(!Number.isFinite(finisherRecovery)||finisherRecovery<0||finisherRecovery>.3)throw new TypeError('Invalid finisher recovery');
  let chain=null,queue=null,identity=null,guardIntent=false,sequence=0,chainSequence=0,lastGame=null,lastHits=0,lastHp=null,presentation=null,latestAccepted=null;
  // Recovery belongs to the actor, separately from disposable input intent.
  // Clearing a queue, pausing, guarding or changing capabilities cannot erase it.
  const recoveries=new Map(),wavePresentation=new Map();let contactPresentation=new WeakMap();
  const countKey={thrust:'thrusts',sweep:'sweeps',charge:'charges'};
  const actionLive=(g,action)=>action==='charge'?['windup','charge'].includes(g.mode):g.mode===action;

  const held=new Set(),blockedUntilRelease=new Set(),observedCancels=new WeakSet(),traces=[];
  const now=g=>Number.isFinite(g?.time)?g.time:0;
  const log=(g,type,detail={})=>{const row={time:now(g),type,...detail};traces.push(row);if(traces.length>traceLimit)traces.shift();return row;};
  const resolved=g=>resolveActorFor(g);
  const config=g=>compileFollowups(resolved(g),{enabled,bufferSeconds,queueLifetime,queueWindow,queueStart});
  function actorIdentity(g){const r=resolved(g);return JSON.stringify([g.playerId,E.pieceKey(g),g.player?.team||'ally',r?.source||null]);}
  function clear(g,reason){latestAccepted=null;if(queue)log(g,'queue_cleared',{reason,action:queue.action,stage:chain?.stage});else if(chain)log(g,'chain_cleared',{reason,stage:chain.stage});chain=null;queue=null;}
  function cancelEdges(){for(const token of held)blockedUntilRelease.add(token);held.clear();}
  function settleRecovery(g){
    for(const [actorId,r] of recoveries){
      if(r.pending){
        const controlled=actorId===g.playerId;
        // A legal control transfer can happen during charge's native ready-mode
        // cooldown. The old actor keeps that timer in heroCooldowns; switching
        // is not permission to start or consume the added recovery early.
        const stored=controlled?null:g.enemies.find(actor=>actor.id===actorId)?.heroCooldowns;
        const left=controlled?remaining(g,r):stored?.[r.action==='charge'?'cooldown':'sweepCooldown'];
        if(Number.isFinite(left)){
          const gate=now(g)+positive(left);
          // A truly canceled timed thrust has no extra adapter recovery. Its
          // actual native gate wins over an earlier phase-end prediction.
          r.nativeUntil=controlled&&r.seconds===0&&g.mode==='ready'?gate:Math.max(r.nativeUntil??now(g),gate);
        }
        const ready=controlled?!actionLive(g,r.action)&&left<=EPS:Number.isFinite(r.nativeUntil)&&now(g)>=r.nativeUntil-EPS;
        if(ready){r.pending=false;r.until=Math.max(now(g),r.nativeUntil??now(g))+r.seconds;
          log(g,'finisher_recovery',{actorId,stage:r.stage,seconds:r.seconds,until:r.until});
        }
      }
      if(!r.pending&&now(g)>=r.until-EPS)recoveries.delete(actorId);
    }
  }
  function attackLock(g){
    if(lastGame!==g)return 0;
    const r=recoveries.get(g.playerId);return r?(r.pending?Infinity:Math.max(0,r.until-now(g))):0;
  }
  function admittedProfile(g,p=presentation){
    const t=E.thrustTiming?.(g);return !!(lastGame===g&&p&&p.action==='thrust'&&t&&t.actorId===p.actorId&&t.actionCount===p.actionCount&&t.stage===p.stage&&p.actorId===g.playerId);
  }
  function presentationView(g){
    if(!presentation||lastGame!==g||presentation.actorId!==g.playerId||presentation.piece!==E.pieceKey(g)||presentation.identity!==actorIdentity(g)&&!admittedProfile(g)||g.won||g.lost||g.hp<=0||!actionLive(g,presentation.action)||g[countKey[presentation.action]]!==presentation.actionCount)return null;
    const {identity:_,...visible}=presentation,timing=visible.action==='thrust'?E.thrustTiming?.(g):null;return Object.freeze({...visible,...(timing?{thrustTiming:timing}:{})});
  }
  function sync(g){const key=actorIdentity(g);if(lastGame&&lastGame!==g){clear(g,'reset');guardIntent=false;cancelEdges();identity=null;presentation=null;recoveries.clear();wavePresentation.clear();contactPresentation=new WeakMap();}

    if(identity!==null&&identity!==key){const keepProfile=admittedProfile(g);clear(g,'actor-or-capability-change');guardIntent=false;cancelEdges();if(!keepProfile)presentation=null;}
    if(lastGame===g&&(g.playerHits>lastHits||lastHp!=null&&g.hp<lastHp))clear(g,'damage');
    identity=key;lastGame=g;lastHits=g.playerHits||0;lastHp=g.hp;
    if(g.won||g.lost||g.hp<=0){clear(g,'terminal');guardIntent=false;}
    for(const event of g.events||[])if(event.type==='cancel'&&!observedCancels.has(event)){observedCancels.add(event);clear(g,'action-cancel');}
    if(chain&&g.guarding)clear(g,'guard');
    if(chain&&!(chain.action==='charge'?['ready','windup','charge']:['ready',chain.action]).includes(g.mode))clear(g,'other-action');
    if(chain&&!config(g).actions[chain.action].enabled)clear(g,'capability-off');
    settleRecovery(g);if(presentation&&!presentationView(g))presentation=null;
  }
  function remaining(g,c=chain){if(!c)return 0;
    if(c.action==='charge'){
      // Contact and arena clipping determine charge duration. Never predict the
      // end while travelling or use the next action's independent cooldown.
      if(g.mode==='windup'||g.mode==='charge')return Infinity;
      return g.mode==='ready'?positive(g.cooldown):Infinity;
    }
    if(g.mode===c.action)return Math.max(positive(g.phase),positive(g.sweepCooldown));
    return g.mode==='ready'?positive(g.sweepCooldown):Infinity;
  }
  function baseAllowed(g,action){const r=resolved(g);return !r||!!(r.ok&&r.capabilities?.[action]?.executable);}
  function directionLegal(g,action,f){return E.allowed(g,f.dx,f.dz)&&!(action==='charge'&&E.isStepDirection(g,f.dx,f.dz));}
  function windowOpen(g,cfg,left){const timing=thrustTimingProfile&&chain?.action==='thrust'?E.thrustTiming(g):null;return left>0&&(cfg.queueWindow==='after-start'?(timing?timing.elapsed:now(g)-chain.startedAt)>=cfg.queueStart-EPS:Number.isFinite(left)&&left<=cfg.bufferSeconds+EPS);}
  function final(c){return c.stage>=c.stageLimit||c.charges>=maxCharges;}
  function start(g,action,stage=1,previous=null){
    if(!baseAllowed(g,action)||!directionLegal(g,action,face(g)))return {accepted:false,reason:'capability-or-direction'};
    // This is the authoritative action call. No timer write, cancel, extra wave,
    // damage multiplier, target lookup, or immunity write is performed here.
    const planned=config(g),profiled=thrustTimingProfile&&action==='thrust'&&stage>1&&planned.actions[action].enabled;
    const accepted=profiled?E.thrust(g,{profile:thrustTimingProfile,stage}):E[action](g);
    if(!accepted){log(g,'engine_rejected',{action,stage,mode:g.mode,phase:g.phase,cooldown:g.cooldown,sweepCooldown:g.sweepCooldown});return {accepted:false,reason:'engine-rejected'};}
    const cfg=config(g),policy=cfg.actions[action];
    if(policy.enabled){chain={actorId:g.playerId,piece:E.pieceKey(g),identity,stage,stageLimit:previous?Math.min(previous.stageLimit,policy.stageLimit):policy.stageLimit,charges:(previous?.charges||0)+(action==='charge'?1:0),action,lockedFacing:face(g),startedAt:now(g),serial:++sequence,chainId:previous?.chainId??++chainSequence};}
    else chain=null;
    if(chain){presentation={version:'ground-combo-v2',enabled:true,actorId:g.playerId,sourceTeam:g.player?.team||'ally',piece:E.pieceKey(g),identity,action,stage,stageLimit:chain.stageLimit,chainId:chain.chainId,actionSerial:chain.serial,actionCount:g[countKey[action]],finisher:final(chain)};
      latestAccepted={...presentation};
      if(final(chain)&&(finisherRecovery>0||profiled))recoveries.set(g.playerId,{action,stage,pending:true,until:null,nativeUntil:null,seconds:profiled?0:finisherRecovery});
    }else {presentation=null;latestAccepted=null;}
    queue=null;log(g,'accepted',{action,stage,actorId:g.playerId,phase:g.phase,cooldown:g.cooldown,sweepCooldown:g.sweepCooldown,finisher:chain?final(chain):false});
    return {accepted:true,action,stage,queued:false};
  }
  function dispatch(g){
    if(!chain)return;const cfg=config(g);
    if(queue&&(queue.profileClock?queue.progress>queueLifetime+EPS:now(g)>queue.expiresAt+EPS)){log(g,'expired',{action:queue.action,stage:chain.stage,reason:'lifetime'});queue=null;}
    if(g.mode!=='ready'||remaining(g)>0||g.hitstop>0)return;
    const old=chain,pending=queue;queue=null;
    if(!pending){log(g,'chain_end',{stage:old.stage,finisher:final(old),reason:'no-followup'});chain=null;return;}
    if(pending.identity!==identity||pending.actorId!==g.playerId||!cfg.actions[pending.action].enabled||!sameFace(pending.face,face(g))||!directionLegal(g,pending.action,pending.face)){
      log(g,'blocked',{action:pending.action,reason:'changed-capability-or-facing'});chain=null;return;
    }
    if(guardIntent||g.guarding||g.won||g.lost||g.hp<=0){log(g,'blocked',{action:pending.action,reason:'defense-or-terminal'});chain=null;return;}
    const result=start(g,pending.action,old.stage+1,old);if(!result.accepted){log(g,'blocked',{action:pending.action,reason:result.reason});chain=null;}
  }
  function press(g,action,{token,repeat=false}={}){
    sync(g);
    if(typeof token!=='string'||!token||repeat||held.has(token)||blockedUntilRelease.has(token))return {accepted:false,reason:'not-fresh'};
    held.add(token);
    if(!ACTIONS.includes(action))return {accepted:false,reason:'unsupported-action'};
    if(g.won||g.lost||g.hp<=0||guardIntent||g.guarding){log(g,'rejected',{action,reason:'defense-or-terminal'});return {accepted:false,reason:'defense-or-terminal'};}
    if(!enabled)return start(g,action);
    // Resolve completed work first, but never invent an automatic input.
    dispatch(g);
    const cfg=config(g);
    if(attackLock(g)>0){log(g,'rejected',{action,reason:'finisher-recovery'});return {accepted:false,reason:'finisher-recovery'};}
    if(!chain)return start(g,action);
    const policy=cfg.actions[action],left=remaining(g);
    let reason=null;
    if(!policy.enabled||!baseAllowed(g,action)||!directionLegal(g,action,face(g)))reason='capability-or-direction';
    else if(final(chain)||chain.stage>=policy.stageLimit)reason='stage-limit';
    else if(queue)reason='one-slot-full';
    else if(!windowOpen(g,cfg,left))reason='outside-window';
    if(reason){log(g,'rejected',{action,reason,stage:chain.stage,remaining:Number.isFinite(left)?left:null});return {accepted:false,reason};}
    const timing=thrustTimingProfile&&chain.action==='thrust'?E.thrustTiming(g):null;
    queue={action,actorId:g.playerId,identity,face:face(g),pressedAt:now(g),expiresAt:now(g)+cfg.queueLifetime,...(timing?{expiresAt:null,profileClock:true,progress:0,sourceActionCount:timing.actionCount}: {})};
    log(g,'queued',{action,stage:chain.stage,nextStage:chain.stage+1,remaining:left,expiresAt:queue.expiresAt,...(queue.profileClock?{clock:'source-action-phase',lifetime:queueLifetime}:{})});return {accepted:true,queued:true,stage:chain.stage+1};
  }
  function release(token){held.delete(token);blockedUntilRelease.delete(token);}
  function interrupt(g,reason='input-cancel'){sync(g);clear(g,reason);cancelEdges();guardIntent=false;E.setGuard(g,false);}
  function guard(g,on){sync(g);if(!on){guardIntent=false;E.setGuard(g,false);return true;}
    const r=resolved(g);if(r?!r.capabilities?.guard?.executable:!E.canGuard({...g,mode:'ready'}))return false;
    // A pending guard is owned by the input loop. It waits for the original
    // ready gate and never calls cancel to shorten the current action.
    clear(g,'guard-intent');guardIntent=true;E.setGuard(g,true);return true;
  }
  function noteContacts(g,acceptedFrame){
    for(const event of g.events||[]){
      if(event.type==='attack_release'&&Number.isSafeInteger(event.waveId))wavePresentation.delete(event.waveId);
      if(event.type==='attack_release'&&event.personal===true&&acceptedFrame&&event.sourceId===acceptedFrame.actorId&&acceptedFrame.sourceTeam==='ally'&&event.kind===acceptedFrame.action&&Number.isSafeInteger(event.waveId)){
        wavePresentation.set(event.waveId,{...acceptedFrame,sourceId:event.sourceId,action:event.action});
        if(wavePresentation.size>128)wavePresentation.delete(wavePresentation.keys().next().value);
      }
    }
    const damage=(g.events||[]).filter(event=>['hit','npc_damage'].includes(event.type)&&event.personal===true);
    for(const event of g.events||[]){
      const meta=wavePresentation.get(event.waveId);
      if(!meta||event.sourceId!==meta.sourceId||event.action!==meta.action||event.personal!==true||event.team!=='enemy')continue;
      const damaging=['hit','npc_damage'].includes(event.type)||event.type==='thrust_contact'&&!event.blocked&&damage.some(hit=>hit.waveId===event.waveId&&hit.sourceId===event.sourceId&&hit.id===event.targetId);
      if(damaging)contactPresentation.set(event,{game:g,stage:meta.stage,waveId:event.waveId,sourceId:event.sourceId,action:event.action,team:event.team});
    }
  }
  function step(g,dt,input={x:0,z:0}){
    sync(g);const prior=chain&&{...chain},beforeMode=g.mode,beforeTurns=g.turns;
    if(chain){const d=E.direction(g,input.x,input.z);if((d.x||d.z)&&d.x*chain.lockedFacing.dx+d.z*chain.lockedFacing.dz<-.01)clear(g,'legal-retreat');}
    if(guardIntent&&E.canGuard(g))E.setGuard(g,true);
    const acceptedFrame=presentationView(g),phaseBefore=g.phase,profileQueue=queue?.profileClock?queue:null;E.step(g,dt,input);
    if(profileQueue&&queue===profileQueue)profileQueue.progress+=Math.max(0,phaseBefore-g.phase);
    noteContacts(g,acceptedFrame);sync(g);
    if(g.events.some(e=>e.type==='cancel')||g.turns!==beforeTurns)clear(g,'action-cancel');
    if(chain&&!(chain.action==='charge'?['ready','windup','charge']:['ready',chain.action]).includes(g.mode))clear(g,'other-action');
    if(prior?.action==='charge'&&['windup','charge'].includes(beforeMode)&&g.mode==='ready')log(g,'charge_stop',{stage:prior.stage,reason:g.events.some(e=>e.type==='endcharge')?'travel-end':'contact-or-body',x:g.player.x,z:g.player.z,cooldown:g.cooldown});
    if(guardIntent){const r=resolved(g);if(r&&!r.capabilities?.guard?.executable)guardIntent=false;else if(E.canGuard(g))E.setGuard(g,true);}
    dispatch(g);lastHits=g.playerHits||0;lastHp=g.hp;return g;
  }
  return {ordinaryPresentation:createOrdinaryAttackPresentation(E),press,release,step,guard,interrupt,
    clearIntent(g,reason='input-cancel'){sync(g);clear(g,reason);cancelEdges();},
    presentation:presentationView,attackLock,
    chargeRecovery(g){const p=latestAccepted;if(lastGame!==g||!p||p.action!=='charge'||p.stage<2||p.actorId!==g.playerId||p.piece!==E.pieceKey(g)||p.identity!==actorIdentity(g)||g.charges!==p.actionCount||g.mode!=='ready'||g.cooldown<=0||g.guarding||g.won||g.lost||g.hp<=0||g.waves.some(w=>w.sourceId===p.actorId&&w.kind==='charge'&&w.age<w.life))return null;const {identity:_,...visible}=p;return Object.freeze({...visible,recovery:Object.freeze({duration:.4,remaining:g.cooldown,elapsed:Math.max(0,.4-g.cooldown)})});},
    contactStage(g,event){const c=event&&contactPresentation.get(event);return c?.game===g&&c.waveId===event.waveId&&c.sourceId===event.sourceId&&c.action===event.action&&c.team===event.team&&event.personal===true&&!event.blocked?c.stage:0;},
    view(g,action){const cfg=config(g),policy=cfg.actions[action],same=lastGame===g&&chain&&chain.identity===actorIdentity(g),left=same?remaining(g):0,recovery=attackLock(g),shown=presentationView(g),r=lastGame===g?recoveries.get(g.playerId):null;return {actualStage:shown?.stage||(r?.stage??0),enabled:!!policy?.enabled,stage:same?chain.stage:0,stageLimit:same?chain.stageLimit:policy?.stageLimit||1,currentAction:same?chain.action:null,finisher:!!(same&&final(chain)),recovery:recovery===Infinity?'action':recovery,queued:!!(same&&queue?.action===action),canBuffer:!!(same&&policy?.enabled&&!queue&&!final(chain)&&chain.stage<policy.stageLimit&&windowOpen(g,cfg,left)&&!guardIntent&&!g.guarding&&!g.won&&!g.lost&&g.hp>0&&directionLegal(g,action,face(g))) };},
    cancel(g){interrupt(g,'action-cancel');return E.cancel(g);},
    awaken(g){const ok=E.awaken(g);if(ok)interrupt(g,'promotion');return ok;},
    switchControl(g,id){const ok=E.switchControl(g,id);if(ok)interrupt(g,'control-change');return ok;},
    snapshot(){return {enabled,chain:copy(chain),queue:copy(queue),guardIntent,presentation:copy(presentation),recoveries:copy([...recoveries]),held:[...held],blockedUntilRelease:[...blockedUntilRelease]};},
    trace(){return copy(traces);},remaining:g=>remaining(g),clearTrace(){traces.length=0;}};
}
