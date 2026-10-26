import {SCHEMA_VERSION,REGISTRY_VERSION,PIECES,ABILITIES,ABILITY_IDS,TEMPLATES,RIGS,own,freeze,defaultAbilities} from './registry.mjs';
import {ACTOR_SCHEMA,MATCH_SCHEMA,validateSchema,parseConfig} from './schema.mjs';
export const standardActor=piece=>({schemaVersion:SCHEMA_VERSION,registryVersion:REGISTRY_VERSION,basePiece:piece});
const copy=value=>structuredClone(value);
const problem=(path,code,message)=>({path,code,message});
export function resolveActor(config,{piece,promoted=false,role='hero',team='ally'}={}) {
  if(piece===undefined&&config&&typeof config==='object')piece=Object.getOwnPropertyDescriptor(config,'basePiece')?.value;
  const errors=[];
  if(!own(PIECES,piece))errors.push(problem('$.context.piece','unknown-piece','基礎駒が未登録です'));
  if(!['hero','npc'].includes(role)||!['ally','enemy'].includes(team)||typeof promoted!=='boolean')errors.push(problem('$.context','context','実行対象の状態が不正です'));
  const source=config===undefined&&own(PIECES,piece)?standardActor(piece):config;
  errors.push(...validateSchema(source,ACTOR_SCHEMA));
  if(errors.length)return freeze({ok:false,errors});
  if(source.basePiece!==piece)return freeze({ok:false,errors:[problem('$.basePiece','piece-mismatch','実体の基礎駒と設定が一致しません。別駒への変化は専用処理が必要です')]});
  const effectivePiece=promoted&&PIECES[piece].promote?PIECES[piece].promote:piece;
  const native=defaultAbilities(effectivePiece,role),overrides=source.abilities||{};
  const requested=Object.fromEntries(ABILITY_IDS.map(id=>[id,own(overrides,id)?overrides[id]:native[id]]));
  const character={templateId:source.character?.templateId||'standard',presentation:{sex:source.character?.presentation?.sex||'unspecified'}};
  character.rigId=source.character?.rigId||TEMPLATES[character.templateId].defaultRig;
  const bindings=source.input?.bindings||{},customInput=source.input?.profile==='custom';
  const inputErrors=[];
  if(Object.keys(bindings).length&&!customInput)inputErrors.push(problem('$.input.profile','explicit-input-profile','入力変更はcustomを明示してください'));
  // Distinct actions cannot share a physical trigger. Double jump/follow-up use
  // the existing semantic action's new press edge and have no separate binding.
  const occupied={keyboard:new Map(),touch:new Map()};
  for(const [id,binding] of Object.entries(bindings))for(const channel of ['keyboard','touch']){
    const previous=occupied[channel].get(binding[channel]);
    if(previous)inputErrors.push(problem(`$.input.bindings.${id}.${channel}`,'input-conflict',`${previous}と入力が重複しています`));
    else occupied[channel].set(binding[channel],id);
  }
  // Native keyboard shortcuts remain reserved unless that semantic action is
  // deliberately rebound too. A new jump cannot silently steal charge's Space.
  const nativeKeys={thrust:'KeyK',sweep:'KeyJ',charge:'Space',jump:'KeyL'};
  for(const [id,binding] of Object.entries(bindings))for(const [other,key] of Object.entries(nativeKeys)){
    if(other!==id&&requested[other]&&!own(bindings,other)&&binding.keyboard===key)inputErrors.push(problem(`$.input.bindings.${id}.keyboard`,'reserved-input',`${other}の既存キーと衝突しています`));
  }
  if(requested.jump&&effectivePiece!=='knight'&&role==='hero'&&(!customInput||!own(bindings,'jump')))inputErrors.push(problem('$.input.bindings.jump','jump-input-required','歩行駒のジャンプには専用キーとタッチボタンを明示してください'));
  errors.push(...inputErrors.filter(e=>e.code!=='jump-input-required'));
  const jumpProfile=source.abilityParameters?.jump?.airProfile||(effectivePiece==='knight'?'knight-l-v1':null);
  const capabilities={};
  for(const id of ABILITY_IDS){
    const definition=ABILITIES[id],reasons=[];
    if(!requested[id])reasons.push('disabled');
    if(requested[id]){
      if(definition.implementation==='contract-only')reasons.push('not-implemented');
      if(id==='double_jump'&&!source.abilityParameters?.double_jump?.airProfile)reasons.push('air-profile-required');
      if(id==='jump'&&!jumpProfile)reasons.push('air-profile-required');
      if(id==='jump'&&native.jump&&jumpProfile!=='knight-l-v1')reasons.push('jump-profile-adapter-missing');
      if(id==='double_jump'&&source.abilityParameters?.double_jump?.airProfile&&({ 'knight-l-chain-v1':'knight-l-v1','forward-hop-chain-v1':'forward-hop-v1' }[source.abilityParameters.double_jump.airProfile]!==jumpProfile))reasons.push('air-profile-mismatch');
      else if(!native[id])reasons.push('cross-piece-or-role-adapter-missing');
      if(RIGS[character.rigId].status!=='native-v50')reasons.push('rig-not-implemented');
      if(id==='jump'&&effectivePiece!=='knight'&&role==='hero'&&inputErrors.some(e=>e.code==='jump-input-required'))reasons.push('input-unbound');
      if(customInput&&own(bindings,id))reasons.push('custom-input-adapter-missing');
      for(const dependency of definition.requires)if(!requested[dependency])reasons.push(`requires:${dependency}`);
    }
    capabilities[id]={id,label:definition.label,enabled:requested[id],nativeDefault:native[id],origin:own(overrides,id)?'explicit':'piece-default',executable:requested[id]&&reasons.length===0,reasons,cooldownGroup:definition.cooldownGroup,adapter:native[id]?definition.adapter:null};
  }
  // Availability propagates through dependencies, regardless of registry order.
  for(let pass=0;pass<ABILITY_IDS.length;pass++)for(const id of ABILITY_IDS){
    const cap=capabilities[id];if(!cap.enabled)continue;
    for(const dependency of ABILITIES[id].requires)if(!capabilities[dependency].executable){const reason=`dependency-unavailable:${dependency}`;if(!cap.reasons.includes(reason))cap.reasons.push(reason);cap.executable=false;}
  }
  const warnings=inputErrors.filter(e=>e.code==='jump-input-required');
  if(effectivePiece==='knight'&&!requested.jump)warnings.push(problem('$.abilities.jump','stationary-knight','桂馬のジャンプOFFでは、通常移動もありません'));
  if(requested.thrust&&!native.thrust)warnings.push(problem('$.abilities.thrust','animation-coverage','追加の突きは移動方向・攻撃モーションの検証が必要です'));
  const modifiers={equipment:source.equipment?.profile||'inherit-team',hp:source.stats?.hp??null,speedMultiplier:source.stats?.speedMultiplier??1};
  const unsupportedModifiers=modifiers.equipment!=='inherit-team'||modifiers.hp!==null||modifiers.speedMultiplier!==1;
  if(unsupportedModifiers)warnings.push(problem('$.stats','stat-adapter-missing','個体別ステータスの適用は未接続です。数値は設定としてのみ保持します'));
  const movement={profile:'piece-default',groundDirections:copy(PIECES[effectivePiece].dirs),padMode:effectivePiece==='knight'?'knight-leap':['horse','dragon'].includes(effectivePiece)?'piece-walk-and-step':'piece-walk',jumpProfile};
  const unresolved=ABILITY_IDS.filter(id=>capabilities[id].enabled&&!capabilities[id].executable);
  const semanticChange=ABILITY_IDS.some(id=>requested[id]!==native[id])||customInput||unsupportedModifiers||(source.progression?.promotion??'piece-default')!=='piece-default';
  return freeze({ok:errors.length===0,errors,warnings,source:copy(source),schemaVersion:SCHEMA_VERSION,registryVersion:REGISTRY_VERSION,basePiece:piece,effectivePiece,role,team,character,movement,capabilities,modifiers,
    input:{profile:source.input?.profile||'piece-default',bindings:copy(bindings),separateJumpButton:role==='hero'&&effectivePiece!=='knight'&&requested.jump},
    abilityParameters:copy(source.abilityParameters||{}),
    progression:{promotion:source.progression?.promotion||'piece-default',onPromotion:source.progression?.onPromotion||'preserve-overrides',onConversion:source.progression?.onConversion||'preserve-character'},
    animation:{forwardThrustGait:character.rigId==='samurai-v50'&&['pawn','lance'].includes(effectivePiece)&&native.thrust&&requested.thrust,allDirectionThrust:false,usesCurrentAuthoredClips:character.rigId==='samurai-v50'},
    allEnabledAbilitiesImplemented:errors.length===0&&!unresolved.length,engineIntegration:semanticChange?'required':'legacy-pass-through',productionPlayable:errors.length===0&&!unresolved.length&&!semanticChange,unresolved});
}
/** Eligibility only, matching v50 canAction. Admission/mode/cooldown remain engine-owned. */
export function nativeCanAction(resolved,g,action){
  if(!resolved?.ok||!own(resolved.capabilities,action)||!resolved.capabilities[action].executable||g.guarding)return false;
  if(!['thrust','sweep','charge','jump'].includes(action))return false;
  const k=resolved.effectivePiece,step=(k==='dragon'&&g.player.dx!==0&&g.player.dz!==0)||(k==='horse'&&(g.player.dx===0||g.player.dz===0));
  return action!=='charge'||!step;
}
export function canUse(resolved,id){return !!(resolved?.ok&&own(resolved.capabilities,id)&&resolved.capabilities[id].executable);}
export function resetToStandard(resolved){return standardActor(resolved.basePiece);}
export function loadSavedActor(text,piece){
  const parsed=parseConfig(text),resolved=parsed.ok?resolveActor(parsed.value,{piece}):null;
  if(resolved?.ok)return {value:resolved.source,recovered:false,errors:[]};
  return {value:standardActor(piece),recovered:true,errors:parsed.ok?resolved.errors:parsed.errors};
}
export function resolveMatch(config,actors=[]){
  const errors=validateSchema(config,MATCH_SCHEMA);if(errors.length)return freeze({ok:false,errors});
  const scenario={preset:'standard',initialAllies:'inherit',capturedReinforcements:'inherit',abilityScope:'actor',...config.scenario};
  if(scenario.preset==='solo-king-custom'&&(config.hero?.basePiece!=='king'||scenario.initialAllies!=='solo'))errors.push(problem('$.scenario','solo-king-contract','特別設定は王将かつ初期味方単騎を明示してください'));
  if(scenario.preset==='solo-king-custom'&&scenario.capturedReinforcements==='inherit')errors.push(problem('$.scenario.capturedReinforcements','explicit-reinforcement-policy','初期単騎とは別に、捕獲後の増援をallow/noneで決めてください'));
  const templates=new Map();for(const t of config.npcTemplates||[]){if(templates.has(t.id))errors.push(problem('$.npcTemplates','duplicate-template','テンプレートIDが重複しています'));templates.set(t.id,t.actor);}
  const assignments=new Map(),npcs=[];
  for(const a of config.npcAssignments||[]){
    if(assignments.has(a.actorId))errors.push(problem('$.npcAssignments','duplicate-actor','同じ実体を二重指定しています'));
    assignments.set(a.actorId,a.templateId);
    if(!templates.has(a.templateId)){errors.push(problem('$.npcAssignments','unknown-template','未登録のNPCテンプレートです'));continue;}
    const matches=actors.filter(unit=>unit.id===a.actorId);
    if(matches.length!==1){errors.push(problem('$.npcAssignments','actor-missing-or-duplicate','NPC実体が一意に見つかりません'));continue;}
    const unit=matches[0],resolved=resolveActor(templates.get(a.templateId),{piece:unit.basePiece||unit.piece,promoted:unit.promoted||false,role:'npc',team:unit.team});
    npcs.push({actorId:unit.id,resolved});if(!resolved.ok)errors.push(...resolved.errors);
  }
  const hero=config.hero?resolveActor(config.hero):null;if(hero&&!hero.ok)errors.push(...hero.errors);
  // Disabling future captures' reinforcements has no v50 engine adapter yet.
  const scenarioImplemented=scenario.capturedReinforcements!=='none';
  return freeze({ok:errors.length===0,errors,scenario,hero,npcs,scenarioImplemented,productionPlayable:errors.length===0&&scenarioImplemented&&(!hero||hero.productionPlayable)&&npcs.every(n=>n.resolved.productionPlayable)});
}
/** Compact menu model. Authoring data stays detailed; combat UI stays contextual. */
export function compactPanel(resolved){
  if(!resolved?.ok)return {label:'能力設定を確認',errors:resolved?.errors||[]};
  const changed=Object.values(resolved.capabilities).filter(c=>c.origin==='explicit');
  return {label:changed.length?`能力カスタム ${changed.length}件`:'駒の標準能力',resetLabel:'駒の標準に戻す',rows:changed.map(c=>({id:c.id,label:c.label,on:c.enabled,available:c.executable,status:!c.enabled?'OFF':c.executable?'使用可能':'未対応',reason:c.reasons.join(', ')})),jumpButton:{visible:resolved.input.separateJumpButton,disabled:!canUse(resolved,'jump'),label:'ジャンプ',reason:resolved.capabilities.jump.reasons.join(', ')}};
}
