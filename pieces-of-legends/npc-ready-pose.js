// NPC-only ready arms, solved once on the real lightweight rig. The original
// pelvis, legs, translations, scales and breathing tracks remain unchanged.
// Both near NPCs and the offline static bake use these same clip values.
import {HERO_SPEAR_PALM_SOCKET} from './spear-hand-grip.js';
export const NPC_READY_VERSION=2;
export const NPC_READY_HAND_WEIGHT=.7;
const openPalm=[-.012,.042,-.020];
export const NPC_READY_PALM_OFFSET=Object.freeze(HERO_SPEAR_PALM_SOCKET.map((v,i)=>openPalm[i]+(v-openPalm[i])*NPC_READY_HAND_WEIGHT));
const rotations=Object.freeze({
  "upperarm_R": [
    -0.6353756077025825,
    0.5952916692050658,
    0.15069020465657812,
    0.46820735570063315
  ],
  "forearm_R": [
    -0.641797417638901,
    0.0013195737236283006,
    0.5200408784077278,
    0.5636060842664361
  ],
  "hand_R": [
    -0.07180465012788773,
    -0.634395956993103,
    0.1023242175579071,
    0.7628339529037476
  ],
  "upperarm_L": [
    -0.5150275539678489,
    -0.7222375665961485,
    -0.061055497900365706,
    0.4575934245892385
  ],
  "forearm_L": [
    -0.6505727412180626,
    -0.05181483766537957,
    -0.401828140461743,
    0.6423429586403075
  ],
  "hand_L": [
    -0.08631224930286407,
    0.6465474963188171,
    -0.06668772548437119,
    0.7550359964370728
  ]
});
export function createNpcReadyClips(clips){
 let found=false;
 const result=clips.map(base=>{
  if(base.name!=='idle')return base;
  found=true;const clip=base.clone(),remaining=new Set(Object.keys(rotations));
  for(const track of clip.tracks){const bone=track.name.endsWith('.quaternion')?track.name.slice(0,-11):'';const quaternion=rotations[bone];if(!quaternion)continue;for(let i=0;i<track.values.length;i+=4)track.values.set(quaternion,i);remaining.delete(bone);}
  if(remaining.size)throw Error('NPC ready arm tracks are missing: '+[...remaining].join(', '));
  clip.userData={...base.userData,npcReady:NPC_READY_VERSION};return clip;
 });
 if(!found)throw Error('NPC ready requires the idle clip');
 return result;
}
