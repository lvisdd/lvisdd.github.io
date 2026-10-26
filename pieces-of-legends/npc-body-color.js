import * as THREE from './vendor/three.module.min.js';

const base={ally:new THREE.Color('#20cfff'),enemy:new THREE.Color('#ff4935')};
const light={ally:new THREE.Color('#b6f3ff'),enemy:new THREE.Color('#ffd0bf')};

// A single, monotonic fade uses the authoritative existing hurtFlash timer.
// No new timer, blink cycle, pose change, or combat response is introduced.
// Both LODs use the same faction-preserving tint, including reduced effects.
export function npcBodyColor(target,team,hurtFlash=0){
 const side=team==='ally'?'ally':'enemy';
 const strength=Number.isFinite(hurtFlash)?Math.min(1,Math.max(0,hurtFlash/.22))*.65:0;
 return target.copy(base[side]).lerp(light[side],strength);
}
