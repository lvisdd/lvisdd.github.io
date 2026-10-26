/** Browser-safe resolver bridge. Registry remains contract-only; only the
 * executable local ground-follow-up adapter consumes these explicit requests. */
import {resolveActor,standardActor} from './followup-policy/resolver.mjs';
export function createUiFollowupPolicy(E,getConfiguration){
 const cache=new WeakMap();
 return {resolve(g){const config=getConfiguration(),active=config.game===g&&g.scenario==='army'&&config.actorId===g.playerId;
   const stageLimit=config.stageLimit??2,chargeStageLimit=config.chargeStageLimit??stageLimit;
   const info=E.capabilityInfo(g),key=JSON.stringify([g.playerId,g.piece,g.promoted,info,active?config.actions:[],stageLimit,chargeStageLimit]);
   const prior=cache.get(g);if(prior?.key===key)return prior.resolved;
   const source=standardActor(g.piece);source.abilities={};source.abilityParameters={};
   for(const action of ['thrust','sweep','charge','guard'])source.abilities[action]=!!info.abilities[action];
   for(const action of ['thrust','sweep','charge']){const id=action+'_followup';source.abilities[id]=!!(active&&config.actions.includes(action)&&info.abilities[action]);source.abilityParameters[id]={stageLimit:action==='charge'?chargeStageLimit:stageLimit};}
   const resolved=resolveActor(source,{piece:g.piece,promoted:g.promoted,role:'hero',team:'ally'});cache.set(g,{key,resolved});return resolved;
 }};
}
