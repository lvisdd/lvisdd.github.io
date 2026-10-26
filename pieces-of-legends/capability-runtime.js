/* Narrow, opt-in runtime manifest. All absent/default paths retain v51 rules. */
(function(root){'use strict';
const VERSION='poe-runtime-capabilities/1',STYLE='original-samurai';
const IDS=Object.freeze(['thrust','sweep','charge','jump','guard','step_attack']);
const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const exact=(o,keys)=>plain(o)&&Object.keys(o).every(k=>keys.includes(k)&&own(Object.getOwnPropertyDescriptor(o,k),'value'));
function fail(message){throw new TypeError('Capability config: '+message);}
function normalizeActor(v,E,actor){
 if(!exact(v,['basePiece','disabled','forwardHop','rig']))fail('unknown actor field');
 if(!own(E.PIECES,v.basePiece)||v.basePiece!==(actor.basePiece||actor.piece))fail('base piece mismatch');
 if(!Array.isArray(v.disabled)||v.disabled.length>IDS.length||Object.keys(v.disabled).length!==v.disabled.length||Object.keys(v.disabled).some((key,i)=>key!==String(i)||!own(Object.getOwnPropertyDescriptor(v.disabled,key),'value'))||v.disabled.some(id=>!IDS.includes(id))||new Set(v.disabled).size!==v.disabled.length)fail('unknown/duplicate disabled ability');
 if(typeof v.forwardHop!=='boolean'||v.rig!==STYLE)fail('unsupported rig or grant');
 if(v.forwardHop&&(v.basePiece!=='pawn'||v.disabled.includes('jump')))fail('forward-hop requires a pawn and enabled jump');
 return Object.freeze({basePiece:v.basePiece,disabled:Object.freeze([...v.disabled].sort()),forwardHop:v.forwardHop,rig:v.rig});
}
function install(g,input,E){
 if(input===undefined)return null;
 if(g.time!==0||g.active||g.mode!=='ready'||g.guarding||g.won||g.lost||g.capabilityLoadout)fail('prebattle creation only');
 if(!exact(input,['version','hero','actors'])||input.version!==VERSION||!Array.isArray(input.actors)||input.actors.length>40)fail('invalid runtime manifest');
 const actors=Object.create(null);
 if(input.hero!==undefined){const value=normalizeActor(input.hero,E,{piece:g.piece});if(value.disabled.length||value.forwardHop)actors[g.playerId]=value;}
 const ids=new Set([g.playerId]);
 for(const item of input.actors){
  if(!exact(item,['actorId','config'])||!Number.isInteger(item.actorId)||ids.has(item.actorId))fail('duplicate/invalid actor identity');ids.add(item.actorId);
  const matches=g.enemies.filter(e=>e.id===item.actorId);if(matches.length!==1)fail('actor not found');
  const value=normalizeActor(item.config,E,matches[0]);if(value.forwardHop)fail('forward-hop is a controlled-hero adapter; NPC grants not implemented');
  if(value.disabled.length)actors[item.actorId]=value;
 }
 if(!Object.keys(actors).length)return null;
 const entries=Object.keys(actors).map(Number).sort((a,b)=>a-b).map(id=>[id,actors[id]]);
 // The full canonical serialization is retained for records; no short-hash collision can merge loadouts.
 const canonical=JSON.stringify([VERSION,entries]);
 const state=Object.freeze({version:VERSION,actors:Object.freeze(actors),canonical,experimental:true});
 Object.defineProperty(g,'capabilityLoadout',{value:state,enumerable:true,writable:false,configurable:false});return state;
}
function record(g,id){return g?.capabilityLoadout&&own(g.capabilityLoadout.actors,id)?g.capabilityLoadout.actors[id]:null;}
function has(g,id,piece,ability,role,E){
 if(!IDS.includes(ability)||!own(E.PIECES,piece))return false;
 const r=record(g,id);if(r?.disabled.includes(ability))return false;
 if(ability==='guard')return role==='hero'&&!['pawn','lance','knight'].includes(piece);
 if(ability==='step_attack')return role==='hero'&&['dragon','horse'].includes(piece)&&!r?.disabled.includes('sweep');
 if(ability==='jump'&&r?.forwardHop&&role==='hero'&&['pawn','tokin'].includes(piece))return true;
 return E.ACTIONS[piece].includes(ability);
}
function forwardHop(g){const r=record(g,g.playerId);return !!(r?.forwardHop&&!r.disabled.includes('jump')&&r.rig===STYLE&&['pawn','tokin'].includes(g.promoted?'tokin':g.piece));}
const API={VERSION,STYLE,IDS,install,record,has,forwardHop};if(typeof module!=='undefined')module.exports=API;root.PieceCapabilities=API;
})(typeof globalThis!=='undefined'?globalThis:this);
