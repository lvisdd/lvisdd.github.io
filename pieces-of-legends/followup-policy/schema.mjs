import {SCHEMA_VERSION,REGISTRY_VERSION,PIECES,ABILITIES,TEMPLATES,RIGS,own,freeze} from './registry.mjs';
const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const en=(...values)=>({enum:values});
const num=(minimum,maximum)=>({type:'number',minimum,maximum});
const int=(minimum,maximum)=>({type:'integer',minimum,maximum});
const binding=obj({keyboard:en('Space','KeyJ','KeyK','KeyL','KeyU','KeyI','ShiftLeft'),touch:en('jump','thrust','sweep','charge','guard','step')},['keyboard','touch']);
const actorProperties={
  schemaVersion:en(SCHEMA_VERSION),registryVersion:en(REGISTRY_VERSION),basePiece:en(...Object.keys(PIECES)),
  movement:obj({profile:en('piece-default')}),
  abilities:obj(Object.fromEntries(Object.keys(ABILITIES).map(id=>[id,{type:'boolean'}]))),
  abilityParameters:obj({jump:obj({airProfile:en('knight-l-v1','forward-hop-v1')},['airProfile']),double_jump:obj({airProfile:en('knight-l-chain-v1','forward-hop-chain-v1')},['airProfile']),thrust_followup:obj({stageLimit:int(2,3)}),sweep_followup:obj({stageLimit:int(2,3)}),charge_followup:obj({stageLimit:int(2,3)})}),
  character:obj({templateId:en(...Object.keys(TEMPLATES)),rigId:en(...Object.keys(RIGS)),presentation:obj({sex:en('unspecified','female','male')})}),
  equipment:obj({profile:en('inherit-team','light','heavy')}),
  stats:obj({hp:int(1,99),speedMultiplier:num(.1,3)}),
  input:obj({profile:en('piece-default','custom'),bindings:obj(Object.fromEntries(['thrust','sweep','charge','jump','guard','step_attack'].map(id=>[id,binding])))}),
  progression:obj({promotion:en('piece-default','disabled'),onPromotion:en('preserve-overrides','clear-overrides'),onConversion:en('preserve-character','clear-overrides')})
};
const ACTOR_BODY=obj(actorProperties,['schemaVersion','registryVersion','basePiece']);
export const ACTOR_SCHEMA=freeze({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:poe:actor-capabilities:1',...ACTOR_BODY});
export const MATCH_SCHEMA=freeze({$schema:ACTOR_SCHEMA.$schema,$id:'urn:poe:match-capabilities:1',...obj({
  schemaVersion:en(SCHEMA_VERSION),registryVersion:en(REGISTRY_VERSION),hero:ACTOR_BODY,
  scenario:obj({preset:en('standard','solo-king-custom'),initialAllies:en('inherit','solo'),capturedReinforcements:en('inherit','allow','none'),abilityScope:en('actor')}),
  npcTemplates:{type:'array',maxItems:40,items:obj({id:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},actor:ACTOR_BODY},['id','actor'])},
  npcAssignments:{type:'array',maxItems:40,items:obj({actorId:int(0,39),templateId:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'}},['actorId','templateId'])}
},['schemaVersion','registryVersion'])});
/** Dependency-free validation for the deliberately small published JSON Schema subset. */
export function validateSchema(value,schema=ACTOR_SCHEMA,path='$',errors=[]) {
  const fail=(code,message)=>errors.push({path,code,message});
  if (own(schema,'enum') && !schema.enum.some(v=>Object.is(v,value))) {fail('enum','値が許可リストにありません');return errors;}
  if(schema.type) {
    const type=schema.type;
    const valid=type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)):
      type==='array'?Array.isArray(value):type==='integer'?Number.isSafeInteger(value):type==='number'?Number.isFinite(value):typeof value===type;
    if(!valid){fail('type',`型 ${type} が必要です`);return errors;}
  }
  if(schema.type==='object') {
    for(const key of schema.required||[])if(!own(value,key))errors.push({path:`${path}.${key}`,code:'required',message:'必須項目です'});
    for(const key of Object.keys(value)) {
      if(!own(schema.properties,key)){errors.push({path:`${path}.${key}`,code:'unknown-key',message:'未登録の設定項目です'});continue;}
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!own(descriptor,'value')){errors.push({path:`${path}.${key}`,code:'accessor',message:'JSONの値のみ対応します'});continue;}
      validateSchema(descriptor.value,schema.properties[key],`${path}.${key}`,errors);
    }
  }
  if(schema.type==='array'){
    if(value.length>(schema.maxItems??Infinity)){fail('maxItems','項目数が多すぎます');return errors;}
    value.forEach((item,i)=>validateSchema(item,schema.items,`${path}[${i}]`,errors));
  }
  if(typeof value==='number' && ((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))fail('range','数値が許容範囲外です');
  if(schema.pattern && !new RegExp(schema.pattern).test(value))fail('pattern','識別子の形式が不正です');
  return errors;
}
export function parseConfig(text,kind='actor') {
  if(typeof text!=='string'||text.length>65536)return {ok:false,errors:[{path:'$',code:'size',message:'設定は64KiB以下のJSON文字列にしてください'}]};
  let value;try{value=JSON.parse(text);}catch{return {ok:false,errors:[{path:'$',code:'json',message:'JSONが壊れています'}]};}
  const errors=validateSchema(value,kind==='match'?MATCH_SCHEMA:ACTOR_SCHEMA);
  return errors.length?{ok:false,errors}:{ok:true,value};
}
